/**
 * MemoDeck · 数据迁移
 * 挂载到 window.ExamMigration
 *
 * 职责：
 *  - wrongbook v1 → v2：旧错题本条目升级为含 firstWrongAt / wrongCount / status 的 v2 结构
 *  - 从 v1 错题本推断初始 progress（所有错题标记为 learning）
 *  - 幂等：runAll() 可安全重复执行
 *
 * 依赖：ExamStore（localStorage 读写）、ExamCore（makeGlobalId）
 * 不依赖 Vue / DOM，可在 Node 里单测。
 */
(function (global) {
  'use strict';

  const Store = global.ExamStore;
  const Core = global.ExamCore;

  // —— storage keys（和 store.js 对齐）——
  const WRONGBOOK_V2_KEY = 'examWrongbook:v2';
  const PROGRESS_KEY = 'examProgress:v1';

  // —— 读写辅助（本文件专用，不污染 ExamStore）——
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

  // ======== wrongbook v1 → v2 ========

  /**
   * 把 v1 错题条目升级为 v2 结构。
   * @param {object}  v1Entry    旧条目：{ id, source, item, userAnswer, correct, addedAt }
   * @param {string}  [paperId]  如果能拿到题目所属卷 id，就传过来（精确匹配用）
   * @returns {object} v2 条目
   */
  function upgradeWrongbookEntry(v1Entry, paperId) {
    const item = v1Entry.item || {};
    const pid = paperId != null ? String(paperId) : String(item.paperId || '');
    const qid = item.id != null ? String(item.id) : '';
    const gid = pid && qid ? Core.makeGlobalId(pid, qid) : '';

    const addedAt = v1Entry.addedAt || new Date().toISOString();

    return {
      // 保留旧字段（item 原样复制，因为它是 buildItems 的产物）
      id: v1Entry.id,
      source: v1Entry.source,
      item: item,
      userAnswer: v1Entry.userAnswer ?? null,
      correct: v1Entry.correct ?? null,

      // v2 新增：关联 & 统计
      gid: gid,
      paperId: pid,

      // v2 新增：时间戳
      firstWrongAt: addedAt,
      lastWrongAt: addedAt,
      wrongCount: 1,
      lastRightAt: null,

      // v2 新增：状态机
      consecutiveRight: 0,
      status: 'new'
    };
  }

  /**
   * 执行一次 wrongbook v1 → v2 迁移。幂等。
   * @param {object} [bank] 可选：当前 normalized bank，用于精确匹配题目 → paperId
   * @returns {{ migrated: number, skipped: number }}
   */
  function migrateWrongbook(bank) {
    const v2existing = readJSON(WRONGBOOK_V2_KEY);
    if (v2existing && Array.isArray(v2existing.entries) && v2existing.entries.length > 0) {
      // v2 已经有数据了，跳过 v1→v2 迁移（幂等）
      return { migrated: 0, skipped: 0 };
    }

    const v1 = Store.readWrongbook();
    if (!v1 || !Array.isArray(v1.entries) || v1.entries.length === 0) {
      return { migrated: 0, skipped: 0 };
    }

    // 如果有题库，先把每个 item 匹配到 paperId
    let paperMap = {}; // { "${item.id}::${item.rawType}": paperId }
    if (bank && bank.papers) {
      bank.papers.forEach(paper => {
        (paper.questions || []).forEach(q => {
          const key = String(q.id) + '::' + String(q.type);
          paperMap[key] = String(paper.id);
        });
      });
    }

    const v2entries = v1.entries.map(v1e => {
      const it = v1e.item || {};
      const pkey = String(it.id) + '::' + String(it.rawType);
      const pid = paperMap[pkey];
      return upgradeWrongbookEntry(v1e, pid);
    });

    writeJSON(WRONGBOOK_V2_KEY, { version: 2, entries: v2entries });

    return { migrated: v2entries.length, skipped: 0 };
  }

  // ======== progress store 初始化 ========

  /**
   * 从已迁移到 v2 的错题本推断 progress store 初始状态。幂等。
   * 如果 progress 已经存在就跳过；否则从 wrongbook v2 里把有 gid 的条目灌进去。
   *
   * @returns {{ initialized: number, skipped: boolean }}
   */
  function initProgressFromWrongbook() {
    const existing = readJSON(PROGRESS_KEY);
    if (existing && existing.progress) {
      return { initialized: 0, skipped: true };
    }

    const wb = readJSON(WRONGBOOK_V2_KEY);
    const progress = {};

    if (wb && Array.isArray(wb.entries)) {
      wb.entries.forEach(entry => {
        if (!entry.gid) return;
        progress[entry.gid] = {
          status: 'learning',
          attempts: 1,
          correct: 0,
          wrong: 1,
          lastReviewedAt: entry.lastWrongAt,
          nextReviewAt: null, // 不预设复习时间，让 progress.js 的 scheduler 计算
          streak: 0,
          masteredAt: null
        };
      });
    }

    writeJSON(PROGRESS_KEY, { version: 1, progress });

    return { initialized: Object.keys(progress).length, skipped: false };
  }

  // ======== 一键入口 ========

  /**
   * 运行全部迁移。幂等。可安全重复调用。
   * @param {object} [bank] 可选：当前 normalized bank
   * @returns {{ wrongbook: {migrated,skipped}, progress: {initialized,skipped} }}
   */
  function runAll(bank) {
    const wb = migrateWrongbook(bank);
    const prog = initProgressFromWrongbook();
    return { wrongbook: wb, progress: prog };
  }

  global.ExamMigration = {
    WRONGBOOK_V2_KEY, PROGRESS_KEY,
    upgradeWrongbookEntry, migrateWrongbook,
    initProgressFromWrongbook, runAll
  };
})(window);
