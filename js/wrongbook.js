/**
 * MemoDeck · 错题本
 * 挂载到 window.ExamWrongbook
 * 错题来源：practice（记忆闯关）/ preview（摸底速览）/ exam（分类考试）
 *
 * 规则：
 *  - 全局去重：同一道题（id + rawType）无论来自哪个来源，错题本只保留一条；
 *    再次入库时仅把来源更新为最新一次出错场景
 *  - 移除：仅由用户在错题本内主动操作（标记「记住了」/ 练习清除 / 手动移除）
 */
(function (global) {
  'use strict';

  const Store = global.ExamStore;

  function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  /**
   * 加入错题本（全局去重：同题只保留一条，来源更新为最新）
   * @param {object} item        题目条目（ExamCore.buildItems 产物）
   * @param {string} source      'practice' | 'preview' | 'exam'
   * @param {*} userAnswer       用户作答（考试/练习时），可为 null
   * @param {boolean|null} correct 是否答对
   * @returns {boolean} true=本次为全新新增；false=已存在（仅刷新来源/作答）
   */
  function add(item, source, userAnswer, correct) {
    if (!item || item.id === undefined) return false;
    const wb = Store.readWrongbook();
    const exist = wb.entries.find(e =>
      e.item && e.item.id === item.id && e.item.rawType === item.rawType
    );
    if (exist) {
      // 全局去重：刷新为最新来源与作答上下文（保留原 addedAt 便于追溯最早记录）
      if (source && exist.source !== source) exist.source = source;
      if (userAnswer !== undefined && userAnswer !== null) exist.userAnswer = userAnswer;
      if (correct !== undefined && correct !== null) exist.correct = correct;
      Store.writeWrongbook(wb);
      return false;
    }
    wb.entries.push({
      id: genId(),
      source: source,
      item: item,
      userAnswer: userAnswer ?? null,
      correct: correct ?? null,
      addedAt: new Date().toISOString()
    });
    Store.writeWrongbook(wb);
    return true;
  }

  function list() { return Store.readWrongbook().entries; }

  function remove(id) {
    const wb = Store.readWrongbook();
    wb.entries = wb.entries.filter(e => e.id !== id);
    Store.writeWrongbook(wb);
  }

  // 按题目（id + rawType）移除：加强练习/重新考试答对时调用
  function removeByItem(item) {
    if (!item) return;
    const wb = Store.readWrongbook();
    wb.entries = wb.entries.filter(e => !(e.item && e.item.id === item.id && e.item.rawType === item.rawType));
    Store.writeWrongbook(wb);
  }

  function clear(source) {
    const wb = Store.readWrongbook();
    wb.entries = source ? wb.entries.filter(e => e.source !== source) : [];
    Store.writeWrongbook(wb);
  }

  // 按来源计数：{ practice, preview, exam }
  function countBySource() {
    const m = { practice: 0, preview: 0, exam: 0 };
    list().forEach(e => { if (Object.prototype.hasOwnProperty.call(m, e.source)) m[e.source]++; });
    return m;
  }

  global.ExamWrongbook = { add, list, remove, removeByItem, clear, countBySource };
})(window);
