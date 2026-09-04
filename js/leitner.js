/**
 * MemoDeck · Leitner 间隔重复算法
 * 挂载到 window.ExamLeitner
 *
 * 规则（需求 #13/#14）：
 *  - 答错：埋到队列较远处（≥5 张，不立即重现）
 *  - 答对：连续答对逐级加大间隔（第 1 次 5 张 → 第 2 次 10 张 → 第 3 次 18 张）
 *  - 连续答对 4 次：判定「掌握」，从队列永久剔除
 */
(function (global) {
  'use strict';

  const INTERVALS = [5, 10, 18];   // 连续答对次数 → 下次出现的间隔（张）
  const MASTER_AT = 4;             // 连续答对 4 次即掌握
  const MIN_FAIL_GAP = 5;          // 答错后至少埋到 5 张之后

  function intervalFor(streak) {
    if (streak <= 0) return 0;
    return INTERVALS[Math.min(streak, INTERVALS.length) - 1];
  }

  // 初始化队列：为每个条目附加 streak（连续答对次数）
  function createQueue(items) {
    return items.map(it => ({ it: it, streak: 0 }));
  }

  /**
   * 答对（记住了）：shift 队首，streak+1
   * @returns {{mastered:boolean, card:object}} mastered=true 表示该卡已被剔除（掌握）
   */
  function markPass(queue) {
    const card = queue.shift();
    if (!card) return null;
    card.streak += 1;
    if (card.streak >= MASTER_AT) return { mastered: true, card };
    const pos = intervalFor(card.streak);
    queue.splice(Math.min(pos, queue.length), 0, card);
    return { mastered: false, card };
  }

  /**
   * 答错（没记住）：streak 清零，埋到 5~7 张之后
   */
  function markFail(queue) {
    const card = queue.shift();
    if (!card) return null;
    card.streak = 0;
    const pos = MIN_FAIL_GAP + Math.floor(Math.random() * 3);
    queue.splice(Math.min(pos, queue.length), 0, card);
    return { card };
  }

  global.ExamLeitner = {
    INTERVALS, MASTER_AT, MIN_FAIL_GAP, intervalFor, createQueue, markPass, markFail
  };
})(window);
