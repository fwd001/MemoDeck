/**
 * MemoDeck · 记忆调度算法
 * 挂载到 window.ExamLeitner
 *
 * 旧 API（保持不变，零破坏现有测试）：
 *   MIN_FAIL_GAP, createQueue, markPass, markFail
 *
 * v2 新增（持久化 + 与 ExamProgress.nextReviewAt 联合调度）：
 *   persistQueue(gids, sessionId)    持久化 queueGids
 *   restoreQueue(sessionId)           恢复 queueGids
 *   buildQueueFromProgress(allGids, strategy, progressMap)
 *     基于 ExamProgress 排序构建队列：到期→未掌握→新题
 *
 * 间隔调度的真正实现在 ExamProgress.computeNextReviewAt
 * （INTERVAL_DAYS = [0, 1, 3, 7, 14, 30] 天）
 * 本模块只负责「队列排序 + 持久化」，不计算间隔。
 */
(function (global) {
  'use strict';

  const MIN_FAIL_GAP = 5;          // 答错后至少埋到 5 张之后（+0~2 随机）
  const QUEUE_STORE_KEY = 'examLeitnerQueue:v1';

  // 初始化队列：为每个条目附加 streak（连续答对次数，保留字段以便扩展）
  function createQueue(items) {
    return items.map(it => ({ it: it, streak: 0 }));
  }

  /**
   * 答对（记住了）：shift 队首，判定掌握并剔除
   * @returns {{mastered:boolean, card:object}} 恒为 mastered=true（卡片已被剔除）
   */
  function markPass(queue) {
    const card = queue.shift();
    if (!card) return null;
    card.streak += 1;
    return { mastered: true, card };
  }

  /**
   * 答错（没记住/跳过）：streak 清零，埋到 5~7 张之后
   */
  function markFail(queue) {
    const card = queue.shift();
    if (!card) return null;
    card.streak = 0;
    const pos = MIN_FAIL_GAP + Math.floor(Math.random() * 3);
    queue.splice(Math.min(pos, queue.length), 0, card);
    return { card };
  }

  // —— v2 新增：持久化队列 ——
  function _store() {
    try { return JSON.parse(localStorage.getItem(QUEUE_STORE_KEY)) || {}; }
    catch { return {}; }
  }
  function _save(obj) {
    try { localStorage.setItem(QUEUE_STORE_KEY, JSON.stringify(obj)); } catch {}
  }

  function persistQueue(gids, sessionId) {
    if (!gids || !gids.length) return;
    const all = _store();
    all[sessionId] = { gids: gids.slice(), savedAt: new Date().toISOString() };
    _save(all);
  }

  function restoreQueue(sessionId) {
    const all = _store();
    return all[sessionId] || null; // { gids:[...], savedAt } 或 null
  }

  function clearQueue(sessionId) {
    const all = _store();
    delete all[sessionId];
    _save(all);
  }

  // —— v2 新增：基于 ExamProgress 排序构建队列 ——
  // 优先级：到期复习 > 新题 > 未掌握但未到期 > 已掌握
  function buildQueueFromProgress(allGids, strategy, progressMap, dueGids) {
    if (!allGids || !allGids.length) return [];
    const gids = allGids.slice();

    if (strategy === 'sequential') return gids;

    if (strategy === 'random') {
      for (let i = gids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [gids[i], gids[j]] = [gids[j], gids[i]];
      }
      return gids;
    }

    // strategy === 'due'（默认/推荐）
    // 排序 key：priority 数值越小越靠前
    const dueSet = dueGids ? new Set(dueGids) : new Set();
    return gids.sort((a, b) => {
      const ea = progressMap[a];
      const eb = progressMap[b];
      const pa = _priority(ea, dueSet.has(a));
      const pb = _priority(eb, dueSet.has(b));
      if (pa !== pb) return pa - pb;
      // 同优先级：progress 里已见过的、更早到期的先
      if (ea && eb && ea.nextReviewAt && eb.nextReviewAt) {
        return ea.nextReviewAt.localeCompare(eb.nextReviewAt);
      }
      if (ea && !eb) return 1;
      if (!ea && eb) return -1;
      return 0;
    });
  }

  function _priority(entry, isDue) {
    if (isDue) return 0;                       // 到期复习（含新题）→ 最高
    if (!entry) return 0;                      // 新题也算到期
    if (entry.status === 'mastered') return 3; // 已掌握 → 跳过
    return 1;                                  // 未掌握但未到期 → 补齐
  }

  global.ExamLeitner = {
    MIN_FAIL_GAP, createQueue, markPass, markFail,
    // v2
    persistQueue, restoreQueue, clearQueue,
    buildQueueFromProgress
  };
})(window);
