/**
 * MemoDeck · 错题本 v2
 * 挂载到 window.ExamWrongbook
 *
 * v1 → v2 升级（保持所有旧 API 签名不变）：
 *   旧字段：id / source / item / userAnswer / correct / addedAt
 *   新增字段：
 *     gid            跨卷唯一标识（item.paperId + '::' + item.id）
 *     firstWrongAt   首次进错题本时间
 *     lastWrongAt    最近一次答错
 *     wrongCount     累计错误次数
 *     lastRightAt    最近一次答对
 *     correctStreak  连续答对次数（答对+1，答错归零）
 *     status         'new' | 'learning' | 'weak' | 'mastered'
 *                    new      → 首次/最近答错
 *                    learning → 错 ≥2 次
 *                    weak     → 连续答对 ≥2 次
 *                    mastered → 连续答对 ≥3 次（自动移除）
 *
 * 去重优先级：gid（新）> id + rawType（旧，兼容）
 */
(function (global) {
  'use strict';

  const Store = global.ExamStore;

  function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  // 从 item 提取 gid（如果有），否则返回 null
  function extractGid(item) {
    if (!item) return null;
    if (item.gid) return item.gid;
    // 兼容旧 buildItems 没 gid 的情况 —— 用 paperId + '::' + id 现场拼
    if (item.paperId !== undefined && item.id !== undefined) return item.paperId + '::' + item.id;
    return null;
  }

  // 给 v1 entry 补 v2 字段（幂等，可重复执行）
  function upgradeEntry(e) {
    if (!e) return e;
    if (e._upgradedV2) return e;
    e.gid = extractGid(e.item) || null;
    e.firstWrongAt = e.firstWrongAt || e.addedAt || new Date().toISOString();
    e.lastWrongAt = e.lastWrongAt || e.addedAt || new Date().toISOString();
    e.wrongCount = (typeof e.wrongCount === 'number') ? e.wrongCount : 1;
    e.lastRightAt = e.lastRightAt || null;
    e.correctStreak = (typeof e.correctStreak === 'number') ? e.correctStreak : 0;
    e.status = e.status || 'new';
    e._upgradedV2 = true;
    return e;
  }

  function findEntry(wb, item) {
    const gid = extractGid(item);
    if (gid) {
      // 新数据：有 gid → 精确判重（多卷同 id 也不会误合并）
      return wb.entries.find(e => e.gid === gid) || null;
    }
    // 极旧数据：连 paperId 都没有 → 回退到 id + rawType
    return wb.entries.find(e => e.item && e.item.id === item.id && e.item.rawType === item.rawType) || null;
  }

  /**
   * 加入错题本
   * 保持旧签名：add(item, source, userAnswer, correct) → boolean
   * v2 升级：自动补 gid / v2 字段；已存在条目刷新来源/作答 + wrongCount++ + status 回到 new
   */
  function add(item, source, userAnswer, correct) {
    if (!item || item.id === undefined) return false;
    const wb = Store.readWrongbook();
    upgradeAll(wb);

    const exist = findEntry(wb, item);
    if (exist) {
      // 已存在：刷新来源 + 作答 + 错误计数 + 状态机回退
      if (source && exist.source !== source) exist.source = source;
      if (userAnswer !== undefined && userAnswer !== null) exist.userAnswer = userAnswer;
      if (correct !== undefined && correct !== null) exist.correct = correct;
      exist.lastWrongAt = new Date().toISOString();
      exist.wrongCount = (exist.wrongCount || 0) + 1;
      exist.correctStreak = 0;       // 答错 → streak 归零
      exist.status = 'new';          // 答错 → 状态回退
      Store.writeWrongbook(wb);
      return false;
    }

    // 全新条目
    const now = new Date().toISOString();
    const entry = {
      id: genId(),
      gid: extractGid(item),
      source: source,
      item: item,
      userAnswer: userAnswer ?? null,
      correct: correct ?? null,
      addedAt: now,
      firstWrongAt: now,
      lastWrongAt: now,
      wrongCount: 1,
      lastRightAt: null,
      correctStreak: 0,
      status: 'new',
      _upgradedV2: true
    };
    wb.entries.push(entry);
    Store.writeWrongbook(wb);
    return true;
  }

  function list() {
    const wb = Store.readWrongbook();
    upgradeAll(wb);
    return wb.entries.slice(); // 返回副本防止外部误改
  }

  function upgradeAll(wb) {
    if (!wb || !wb.entries) return;
    let changed = false;
    wb.entries.forEach(e => { const u = upgradeEntry(e); if (!u._upgradedV2) changed = true; });
    if (changed) Store.writeWrongbook(wb);
  }

  function remove(id) {
    const wb = Store.readWrongbook();
    wb.entries = wb.entries.filter(e => e.id !== id);
    Store.writeWrongbook(wb);
  }

  // 按 item 移除：内部优先用 gid
  function removeByItem(item) {
    if (!item) return;
    const wb = Store.readWrongbook();
    const gid = extractGid(item);
    let removed = false;
    wb.entries = wb.entries.filter(e => {
      const match = gid ? e.gid === gid : (e.item && e.item.id === item.id && e.item.rawType === item.rawType);
      if (match) { removed = true; return false; }
      return true;
    });
    if (removed) Store.writeWrongbook(wb);
  }

  function clear(source) {
    const wb = Store.readWrongbook();
    wb.entries = source ? wb.entries.filter(e => e.source !== source) : [];
    Store.writeWrongbook(wb);
  }

  function countBySource() {
    const m = { practice: 0, preview: 0, exam: 0, study: 0, exercise: 0 };
    list().forEach(e => { if (Object.prototype.hasOwnProperty.call(m, e.source)) m[e.source]++; });
    return m;
  }

  /**
   * 用户在错题本里答对了 —— 推进状态机
   * @returns {object} { entry, removed: bool }  removed=true 表示这道题已达 mastered 自动移出
   */
  function markCorrect(entryOrId) {
    const wb = Store.readWrongbook();
    upgradeAll(wb);
    let entry = typeof entryOrId === 'string'
      ? wb.entries.find(e => e.id === entryOrId)
      : wb.entries.find(e => e.id === entryOrId.id);
    if (!entry) return { entry: null, removed: false };

    entry.lastRightAt = new Date().toISOString();
    entry.correctStreak = (entry.correctStreak || 0) + 1;

    // 状态机推进
    if (entry.correctStreak >= 3) {
      // 连续答对 3 次 → mastered → 自动移出
      entry.status = 'mastered';
      wb.entries = wb.entries.filter(e => e.id !== entry.id);
      Store.writeWrongbook(wb);
      return { entry, removed: true };
    } else if (entry.correctStreak >= 2) {
      entry.status = 'weak';
    } else {
      entry.status = entry.wrongCount >= 2 ? 'learning' : 'new';
    }
    Store.writeWrongbook(wb);
    return { entry, removed: false };
  }

  // 状态机：手动标记 entry 答错（比如错题练习中又答错）
  function markWrong(entryOrId) {
    const wb = Store.readWrongbook();
    upgradeAll(wb);
    let entry = typeof entryOrId === 'string'
      ? wb.entries.find(e => e.id === entryOrId)
      : wb.entries.find(e => e.id === entryOrId.id);
    if (!entry) return null;
    entry.lastWrongAt = new Date().toISOString();
    entry.wrongCount = (entry.wrongCount || 0) + 1;
    entry.correctStreak = 0;
    entry.status = 'new';
    Store.writeWrongbook(wb);
    return entry;
  }

  // 按 status 分组计数
  function countByStatus() {
    const m = { new: 0, learning: 0, weak: 0, mastered: 0 };
    list().forEach(e => { if (m[e.status] !== undefined) m[e.status]++; else m.new++; });
    return m;
  }

  global.ExamWrongbook = {
    // 旧 API（签名不变）
    add, list, remove, removeByItem, clear, countBySource,
    // 新 API
    markCorrect, markWrong, countByStatus,
    // 内部工具（供 migration / 测试使用）
    _upgradeEntry: upgradeEntry, _findEntry: findEntry
  };
})(window);
