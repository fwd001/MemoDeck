/**
 * MemoDeck · 轻量工具集
 * 挂载到 window.ExamUtils
 *
 * 设计说明：
 *  - 项目刻意保持零第三方运行时依赖（file:// 离线、纯逻辑可单测），
 *    因此不引入 lodash 全量（约 530KB）；只在确有重复时，把所需工具
 *    按需实现于此，函数语义对齐 lodash 同名函数，便于将来对照替换。
 *  - 纯逻辑、无 DOM / Vue 依赖，可被 test/core.test.js 直接单测。
 */
(function (global) {
  'use strict';

  /**
   * 洗牌：返回打乱后的新数组（不改原数组）。
   * 实现为 Fisher–Yates，均匀无偏；lodash _.shuffle 同语义。
   * @param {Array} arr
   * @returns {Array}
   */
  function shuffle(arr) {
    const a = (arr || []).slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  /**
   * 分组：按 keyFn 的结果归组，返回 { key: [元素, ...] }。
   * 键的插入顺序即元素首次出现的顺序；lodash _.groupBy 同语义。
   * @param {Array} list
   * @param {Function} keyFn
   * @returns {Object}
   */
  function groupBy(list, keyFn) {
    const out = {};
    (list || []).forEach(it => {
      const k = keyFn(it);
      (out[k] = out[k] || []).push(it);
    });
    return out;
  }

  global.ExamUtils = { shuffle, groupBy };
})(window);
