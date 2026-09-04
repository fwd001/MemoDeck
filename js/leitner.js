/**
 * MemoDeck · 记忆调度算法
 * 挂载到 window.ExamLeitner
 *
 * 规则：
 *  - 答对（记住了）：一次即判定「掌握」，从队列永久剔除，进度向前推进
 *  - 答错（没记住/跳过）：埋到 5~7 张之后，保证中间至少隔四五道其它题
 *    才可能再次刷到，不立即重现
 */
(function (global) {
  'use strict';

  const MIN_FAIL_GAP = 5;          // 答错后至少埋到 5 张之后（+0~2 随机）

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

  global.ExamLeitner = {
    MIN_FAIL_GAP, createQueue, markPass, markFail
  };
})(window);
