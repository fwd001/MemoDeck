/**
 * MemoDeck · 学习会话 & 每日任务
 * 挂载到 window.ExamSession
 *
 * 职责：
 *  - 恢复点（resume point）：中途退出后下次打开能继续
 *  - 分段范围（segment）：自定义起止、每次学习数量
 *  - 每日任务生成（generateDailyTask）：到期复习 → 未掌握 → 新题，切到 dailyTarget
 *
 * 依赖：ExamProgress（getDueQuestions）。通过 global 引用，模块加载顺序敏感：
 *   migration.js → progress.js → session.js（必须在 progress 之后加载）
 *
 * 存储 key：
 *   examSession:v1   — 恢复点 & 当前分段
 *   examSettings:v1  — 每日学习量等设置
 *
 * 不依赖 Vue / DOM，可在 Node 里单测。
 */
(function (global) {
  'use strict';

  const SESSION_KEY = 'examSession:v1';
  const SETTINGS_KEY = 'examSettings:v1';

  // —— 读写辅助 ——
  function readJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  }

  function readSession() {
    const v = readJSON(SESSION_KEY);
    if (v && v.version === 1) return v;
    return { version: 1, resume: null };
  }
  function writeSession(session) { return writeJSON(SESSION_KEY, session); }

  function defaultSettings() {
    return {
      version: 1,
      dailyTarget: 20,
      defaultMode: 'study',
      enableDailyReminder: false
    };
  }
  function readSettings() {
    const v = readJSON(SETTINGS_KEY);
    if (v && v.version === 1 && typeof v.dailyTarget === 'number') return v;
    return defaultSettings();
  }
  function writeSettings(settings) { return writeJSON(SETTINGS_KEY, settings); }

  // =====================================================
  //  恢复点（resume）
  // =====================================================

  /**
   * 保存一个恢复点。
   * @param {object} params
   * @param {string} params.bankId       题库唯一标识（来自 cache.source / meta.title / url）
   * @param {string} params.paperId      当前卷 id
   * @param {string} params.mode         'study' | 'practice' | 'exam'
   * @param {string[]} params.queueGids  session 内题目顺序（gid 数组）
   * @param {number}   params.currentIndex  当前做到第几题（0-based）
   * @param {object}  [params.segment]   可选：分段范围 { start: 1, end: 500, perSession: 20 }
   * @param {string}  [params.startedAt] 可选：session 开始时间
   */
  function saveResumePoint(params) {
    const sess = readSession();
    sess.resume = {
      bankId: String(params.bankId || ''),
      paperId: String(params.paperId || ''),
      mode: String(params.mode || 'study'),
      queueGids: Array.isArray(params.queueGids) ? params.queueGids : [],
      currentIndex: Math.max(0, Number(params.currentIndex) || 0),
      startedAt: params.startedAt || new Date().toISOString(),
      lastTouchedAt: new Date().toISOString(),
      segment: params.segment || null
    };
    writeSession(sess);
    return sess.resume;
  }

  /**
   * 读取恢复点。
   * @param {string} [bankId] 可选：如果传了 bankId，只返回匹配这个题库的恢复点
   * @returns {object | null}
   */
  function loadResumePoint(bankId) {
    const sess = readSession();
    if (!sess.resume) return null;
    if (bankId && sess.resume.bankId !== String(bankId)) return null;
    return sess.resume;
  }

  /** 清除恢复点 */
  function clearResumePoint() {
    writeSession({ version: 1, resume: null });
  }

  /** 刷新恢复点的 lastTouchedAt（每做一题调用） */
  function touchResumePoint() {
    const sess = readSession();
    if (sess.resume) {
      sess.resume.lastTouchedAt = new Date().toISOString();
      writeSession(sess);
    }
  }

  // =====================================================
  //  设置（settings）
  // =====================================================

  function getSettings() { return readSettings(); }

  function updateSettings(partial) {
    const s = readSettings();
    const merged = Object.assign({}, s, partial);
    writeSettings(merged);
    return merged;
  }

  // =====================================================
  //  分段范围（segment）
  // =====================================================

  /**
   * 根据分段范围从 allGids 中切出题目。
   * 分段的 start / end 是题目序号（1-based，按 allGids 数组顺序）。
   * @param {string[]} allGids
   * @param {object}   segment { start, end } — start/end 为 1-based 闭区间
   * @returns {string[]}
   */
  function sliceSegment(allGids, segment) {
    if (!allGids || !allGids.length) return [];
    if (!segment) return allGids.slice();
    const s = Math.max(1, Number(segment.start) || 1);
    const e = Math.min(allGids.length, Number(segment.end) || allGids.length);
    if (s > e) return [];
    return allGids.slice(s - 1, e);
  }

  /**
   * 从 segment 范围内再按 perSession 切出一段（从 start 开始或从某个 offset 开始）。
   * 用于"每次学习 N 题"的场景。
   */
  function slicePerSession(allGids, perSession, offset) {
    if (!allGids || !allGids.length) return [];
    const n = Math.max(1, Number(perSession) || 20);
    const o = Math.max(0, Number(offset) || 0);
    return allGids.slice(o, o + n);
  }

  // =====================================================
  //  每日任务（daily task）生成
  // =====================================================

  /**
   * 生成今日学习队列。优先级：
   *   1. 到期复习题（ExamProgress.getDueQuestions）
   *   2. 未掌握题（status !== 'mastered'）
   *   3. 新题（progress 里不存在的）
   * 切到 dailyTarget 数量。
   *
   * 这是**核心调度函数**，负责回答"今天应该学什么"。
   *
   * @param {string[]} allGids      题库全体 gid（按题目顺序）
   * @param {number}   [dailyTarget] 每日目标（默认读取 settings）
   * @param {string[]} [scopeGids]  可选：只在这个范围内出题（配合 segment 使用）
   * @returns {{ queue: string[], stats: { due, unmastered, fresh, truncated } }}
   */
  function generateDailyTask(allGids, dailyTarget, scopeGids) {
    const Progress = global.ExamProgress;
    if (!Progress) throw new Error('ExamProgress not loaded');

    const target = dailyTarget || readSettings().dailyTarget;
    const pool = scopeGids && scopeGids.length ? scopeGids : allGids;

    const progress = Progress.getAll();
    const dueSet = new Set(Progress.getDueQuestions(pool));

    const due = [];       // 到期复习（含新题）
    const unmastered = []; // 未到期但未掌握
    const mastered = [];  // 已掌握（跳过）

    pool.forEach(gid => {
      const e = progress[gid];
      if (!e) {
        // 从未见过 → 归到 due（新题）
        due.push(gid);
      } else if (e.status === 'mastered') {
        mastered.push(gid);
      } else if (dueSet.has(gid)) {
        due.push(gid);
      } else {
        unmastered.push(gid);
      }
    });

    // 组装队列：due 优先，不够用 unmastered 补，最终截断到 target
    let queue = due.concat(unmastered);
    const truncated = queue.length > target;
    queue = queue.slice(0, target);

    return {
      queue,
      stats: {
        due: due.length,
        unmastered: unmastered.length,
        mastered: mastered.length,
        truncated: truncated,
        target: target
      }
    };
  }

  global.ExamSession = {
    SESSION_KEY, SETTINGS_KEY,

    // 恢复点
    saveResumePoint, loadResumePoint, clearResumePoint, touchResumePoint,

    // 设置
    getSettings, updateSettings,

    // 分段
    sliceSegment, slicePerSession,

    // 每日任务
    generateDailyTask
  };
})(window);
