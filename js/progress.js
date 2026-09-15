/**
 * MemoDeck · 题目学习进度
 * 挂载到 window.ExamProgress
 *
 * 职责：
 *  - 每道题（以 gid 为键）的学习状态持久化与查询
 *  - 间隔调度（scheduler）与状态转换（markPass / markFail / markMastered / markForgotten）
 *  - 到期复习 / 统计聚合
 *
 * 存储 key：examProgress:v1（与 migration.js 对齐）
 * 存储结构：
 *   { version: 1, progress: { [gid]: ProgressEntry } }
 *
 * 不依赖 Vue / DOM，可在 Node 里单测。
 * 依赖：无（自己读写 localStorage）。
 */
(function (global) {
  'use strict';

  const PROGRESS_KEY = 'examProgress:v1';

  // —— 间隔调度：根据连续答对次数 streak，计算下次复习间隔（天）——
  const INTERVAL_DAYS = [0, 1, 3, 7, 14, 30];
  // streak 0 → 0 天（立即复习）
  // streak 1 → 1 天
  // streak 2 → 3 天
  // streak 3 → 7 天
  // streak 4 → 14 天
  // streak 5+ → 30 天

  // —— ProgressEntry 默认模板 ——
  function defaultEntry() {
    return {
      status: 'new',            // 'new' | 'learning' | 'review' | 'mastered'
      attempts: 0,
      correct: 0,
      wrong: 0,
      lastReviewedAt: null,
      nextReviewAt: null,
      streak: 0,
      masteredAt: null
    };
  }

  // —— 时间工具 ——
  function now() { return new Date().toISOString(); }
  function fromISO(s) { return s ? new Date(s) : null; }
  function addDays(dateIso, days) {
    const d = new Date(dateIso);
    d.setDate(d.getDate() + days);
    return d.toISOString();
  }
  function computeNextReviewAt(streak, baseDateIso) {
    const idx = Math.min(streak, INTERVAL_DAYS.length - 1);
    const days = INTERVAL_DAYS[idx];
    return addDays(baseDateIso, days);
  }

  // —— 底层读写 ——
  function readStore() {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (!raw) return { version: 1, progress: {} };
      const obj = JSON.parse(raw);
      if (obj && obj.progress) return obj;
      return { version: 1, progress: {} };
    } catch (e) { return { version: 1, progress: {} }; }
  }
  function writeStore(store) {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(store)); return true; }
    catch (e) { return false; }
  }

  // —— CRUD ——

  /** 获取完整 store 对象 */
  function getStore() { return readStore(); }

  /** 保存完整 store 对象 */
  function saveStore(store) { return writeStore(store); }

  /**
   * 获取单个题目的进度条目。
   * @returns {ProgressEntry | undefined}
   */
  function get(gid) {
    if (!gid) return undefined;
    const store = readStore();
    return store.progress[gid];
  }

  /**
   * 获取或创建条目（保证返回非 undefined）。
   */
  function getOrCreate(gid) {
    if (!gid) return defaultEntry();
    const store = readStore();
    let entry = store.progress[gid];
    if (!entry) {
      entry = defaultEntry();
      store.progress[gid] = entry;
      writeStore(store);
    }
    return entry;
  }

  /**
   * 更新条目（深 merge partial）。返回更新后的条目。
   */
  function set(gid, partial) {
    if (!gid) return undefined;
    const store = readStore();
    let entry = store.progress[gid] || defaultEntry();
    store.progress[gid] = Object.assign({}, entry, partial);
    writeStore(store);
    return store.progress[gid];
  }

  /**
   * 获取所有进度条目的 progress map。
   * @returns {{ [gid]: ProgressEntry }}
   */
  function getAll() {
    return readStore().progress;
  }

  /** 删除某个 gid 的进度 */
  function remove(gid) {
    if (!gid) return false;
    const store = readStore();
    if (store.progress[gid]) {
      delete store.progress[gid];
      writeStore(store);
      return true;
    }
    return false;
  }

  /** 完全清空 progress */
  function clear() {
    writeStore({ version: 1, progress: {} });
  }

  // —— 状态转换（学习算法核心）——

  /**
   * 答对（记住了）：
   *   attempts++, correct++, streak++
   *   status: new → learning, learning → review, review → 继续 / mastered
   *   nextReviewAt 按 streak 计算
   */
  function markPass(gid, nowIso) {
    if (!gid) return undefined;
    const ts = nowIso || now();
    const store = readStore();
    let entry = store.progress[gid] || defaultEntry();
    entry.attempts++;
    entry.correct++;
    entry.streak++;
    entry.status = entry.status === 'mastered' ? 'mastered' : (entry.streak >= 3 ? 'review' : 'learning');
    entry.lastReviewedAt = ts;
    entry.nextReviewAt = computeNextReviewAt(entry.streak, ts);
    // streak 达到 5 次可自动掌握（可选）
    if (entry.streak >= 5 && entry.status !== 'mastered') {
      entry.status = 'mastered';
      entry.masteredAt = ts;
    }
    store.progress[gid] = entry;
    writeStore(store);
    return entry;
  }

  /**
   * 答错（没记住）：
   *   attempts++, wrong++, streak = 0
   *   status → learning（回退）
   *   nextReviewAt = 现在（立即复习）
   */
  function markFail(gid, nowIso) {
    if (!gid) return undefined;
    const ts = nowIso || now();
    const store = readStore();
    let entry = store.progress[gid] || defaultEntry();
    entry.attempts++;
    entry.wrong++;
    entry.streak = 0;
    entry.status = entry.status === 'mastered' ? 'review' : 'learning'; // 已经掌握的答错了降级到 review
    entry.lastReviewedAt = ts;
    entry.nextReviewAt = computeNextReviewAt(0, ts); // 立即复习
    entry.masteredAt = null;
    store.progress[gid] = entry;
    writeStore(store);
    return entry;
  }

  /** 手动标记掌握 */
  function markMastered(gid, nowIso) {
    if (!gid) return undefined;
    const ts = nowIso || now();
    const store = readStore();
    let entry = store.progress[gid] || defaultEntry();
    entry.status = 'mastered';
    entry.masteredAt = ts;
    entry.lastReviewedAt = ts;
    entry.streak = Math.max(entry.streak, 5);
    store.progress[gid] = entry;
    writeStore(store);
    return entry;
  }

  /** 手动标记遗忘（回退到 learning 状态，下次优先复习） */
  function markForgotten(gid, nowIso) {
    if (!gid) return undefined;
    const ts = nowIso || now();
    const store = readStore();
    let entry = store.progress[gid] || defaultEntry();
    entry.status = 'learning';
    entry.streak = 0;
    entry.lastReviewedAt = ts;
    entry.nextReviewAt = computeNextReviewAt(0, ts);
    entry.masteredAt = null;
    store.progress[gid] = entry;
    writeStore(store);
    return entry;
  }

  // —— 查询 / 统计 ——

  /**
   * 在给定 gid 范围内，找出到期需要复习的题目。
   * @param {string[]} allGids 题目全体 gid
   * @param {string}   [nowIso] 可选，默认 now()
   * @returns {string[]} 到期的 gid 数组（nextReviewAt <= now 或 entry 不存在/还没复习过）
   */
  function getDueQuestions(allGids, nowIso) {
    const ts = nowIso || now();
    const store = readStore();
    const progress = store.progress;
    const due = [];
    allGids.forEach(gid => {
      const e = progress[gid];
      if (!e) {
        // 从未创建过条目 → 视为 new，属于待复习（新题）
        due.push(gid);
      } else if (e.status !== 'mastered') {
        // 已掌握的不复习；其他状态看 nextReviewAt
        const nr = fromISO(e.nextReviewAt);
        if (!nr || nr.getTime() <= new Date(ts).getTime()) {
          due.push(gid);
        }
      }
    });
    return due;
  }

  /**
   * 基础统计：按 status 分组计数。
   * @param {string[]} allGids 题目全体 gid
   * @param {string}   [nowIso] 可选
   * @returns {{ total, new, learning, review, mastered, dueToday, attempted }}
   */
  function getStatistics(allGids, nowIso) {
    const ts = nowIso || now();
    const progress = readStore().progress;
    const result = {
      total: allGids.length,
      new: 0,
      learning: 0,
      review: 0,
      mastered: 0,
      dueToday: 0,
      attempted: 0
    };
    allGids.forEach(gid => {
      const e = progress[gid];
      if (!e) {
        result.new++;
      } else {
        result.attempted++;
        if (e.status === 'mastered') result.mastered++;
        else if (e.status === 'review') result.review++;
        else result.learning++; // learning（status 是 new 的但有 entry 也归 learning）
        const nr = fromISO(e.nextReviewAt);
        if (e.status !== 'mastered' && (!nr || nr.getTime() <= new Date(ts).getTime())) {
          result.dueToday++;
        }
      }
    });
    return result;
  }

  global.ExamProgress = {
    PROGRESS_KEY,
    INTERVAL_DAYS,

    // 底层
    getStore, saveStore,

    // CRUD
    get, getOrCreate, set, getAll, remove, clear,

    // 状态转换
    markPass, markFail, markMastered, markForgotten,

    // 查询
    getDueQuestions, getStatistics,

    // 工具（暴露供单测 / 外部计算用）
    _now: now,
    _fromISO: fromISO,
    _computeNextReviewAt: computeNextReviewAt,
    _addDays: addDays,
    _defaultEntry: defaultEntry
  };
})(window);
