/**
 * MemoDeck · 错题本
 * 挂载到 window.ExamWrongbook
 * 错题来源：practice（记忆闯关）/ preview（摸底速览）/ exam（分类考试）
 */
(function (global) {
  'use strict';

  const Store = global.ExamStore;

  function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  /**
   * 加入错题本（同题同来源自动去重）
   * @param {object} item        题目条目（ExamCore.buildItems 产物）
   * @param {string} source      'practice' | 'preview' | 'exam'
   * @param {*} userAnswer       用户作答（考试/练习时），可为 null
   * @param {boolean|null} correct 是否答对
   * @returns {boolean} 是否成功新增
   */
  function add(item, source, userAnswer, correct) {
    const wb = Store.readWrongbook();
    const dup = wb.entries.some(e =>
      e.source === source && e.item && e.item.id === item.id && e.item.rawType === item.rawType
    );
    if (dup) return false;
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
