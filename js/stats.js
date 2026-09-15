/**
 * MemoDeck · 统计聚合（纯函数层）
 * 挂载到 window.ExamStats
 *
 * 职责：
 *  - 把 progress map + wrongbook entries 聚合成首页 / 统计页需要的数据
 *  - 所有函数都是纯函数：输入数据 → 返回对象，不读写任何 store
 *
 * 为什么要单独做一层？
 *  ExamProgress.getStatistics 是底层 status 计数，够基础查询但不够首页展示。
 *  ExamStats 把它和 wrongbook 的 status / 时间戳结合起来，产出"已学习/已掌握/
 *  待复习/错题/7天趋势"这些更高层的数字。这样 Vue 的 computed 层就很薄。
 *
 * 依赖：无（纯函数）。可在 Node 里单测。
 */
(function (global) {
  'use strict';

  // =====================================================
  //  日期工具（私有，方便单测时替换）
  // =====================================================

  function _dayKey(iso) {
    // '2026-09-15' 形式
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  function _todayKey() { return _dayKey(new Date().toISOString()); }

  function _pastDayKeys(n) {
    // 返回最近 n 天（含今天）的 dayKey 数组，从远到近
    const out = [];
    const today = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      out.push(_dayKey(d.toISOString()));
    }
    return out;
  }

  // =====================================================
  //  基础：progress status 计数（重复实现，保持纯函数）
  // =====================================================

  /**
   * 按 status 给 progress map 分组计数。
   * @param {string[]} allGids   全体 gid
   * @param {object}   progressMap ExamProgress.getAll() 的结果
   * @param {string}  [nowIso]   可选
   */
  function countByStatus(allGids, progressMap, nowIso) {
    const counts = { total: allGids.length, new: 0, learning: 0, review: 0, mastered: 0, due: 0 };
    const ts = nowIso || new Date().toISOString();
    allGids.forEach(gid => {
      const e = progressMap[gid];
      if (!e) {
        counts.new++;
        counts.due++;
        return;
      }
      counts[e.status] = (counts[e.status] || 0) + 1;
      // due：已掌握之外、nextReviewAt <= now
      if (e.status !== 'mastered') {
        const nr = new Date(e.nextReviewAt || 0);
        const n = new Date(ts);
        if (isNaN(nr.getTime()) || nr.getTime() <= n.getTime()) counts.due++;
      }
    });
    return counts;
  }

  // =====================================================
  //  错题本统计
  // =====================================================

  /**
   * 按 status 给错题本条目分组计数。
   * @param {Array} wrongbookEntries 错本题目数组（v2 结构，有 status 字段）
   * @returns {{ total, new, learning, weak, mastered }}
   */
  function countWrongbookByStatus(wrongbookEntries) {
    const counts = { total: 0, new: 0, learning: 0, weak: 0, mastered: 0 };
    (wrongbookEntries || []).forEach(e => {
      counts.total++;
      const s = e.status || 'new';
      if (counts[s] !== undefined) counts[s]++;
      else counts.learning++; // 未知 status 归 learning
    });
    return counts;
  }

  // =====================================================
  //  最近 N 天趋势
  // =====================================================

  /**
   * 计算最近 N 天的每日统计。
   * 依据 progress map 中每条 entry 的 lastReviewedAt / masteredAt 日期。
   *
   * @param {object} progressMap ExamProgress.getAll() 的结果
   * @param {number} [days=7]    天数
   * @returns {Array<{ day: string, reviewed: number, mastered: number, wrong: number }>}
   */
  function computeWeekTrend(progressMap, days) {
    const n = Math.max(1, days || 7);
    const keys = _pastDayKeys(n);

    const buckets = {};
    keys.forEach(k => { buckets[k] = { day: k, reviewed: 0, mastered: 0, wrong: 0 }; });

    const now = new Date().getTime();
    Object.values(progressMap || {}).forEach(function (e) {
      if (!e) return;
      // 当日"复习过"：lastReviewedAt 在这个 dayKey
      const lr = _dayKey(e.lastReviewedAt);
      if (lr && buckets[lr]) {
        buckets[lr].reviewed++;
      }
      // 当日"掌握了"：masteredAt 在这个 dayKey
      const ma = _dayKey(e.masteredAt);
      if (ma && buckets[ma]) {
        buckets[ma].mastered++;
      }
      // 当日"答错了"：无法精确计算（因为没有 per-attempt 记录），用 wrong 和 lastReviewedAt 的交集近似
      if (e.wrong > 0) {
        const lr2 = _dayKey(e.lastReviewedAt);
        if (lr2 && buckets[lr2]) buckets[lr2].wrong++;
      }
    });

    return keys.map(k => buckets[k]);
  }

  // =====================================================
  //  首页 Dashboard
  // =====================================================

  /**
   * 聚合所有数据，产出首页展示需要的统计对象。
   *
   * @param {object} params
   * @param {string[]} params.allGids         题库全体 gid
   * @param {object}   params.progressMap     ExamProgress.getAll()
   * @param {Array}    params.wrongbookEntries 错题本 v2 条目数组（可选，不传只算 progress 侧）
   * @param {number}  [params.weekDays=7]     趋势天数
   *
   * @returns {object}
   *   {
   *     // 题库概览
   *     total,        // 总题数
   *     learned,      // 已学习（至少做过一次，attempts > 0）
   *     mastered,     // 已掌握
   *     weak,         // 待复习（learning + review + due）
   *     due,          // 今天需要复习的数量
   *
   *     // 错题本概览
   *     wrongTotal,   // 错题总数
   *     wrongByStatus, // { new, learning, weak, mastered }
   *
   *     // 最近 7 天趋势
   *     weekTrend,    // [{ day, reviewed, mastered, wrong }]
   *
   *     // 今日
   *     todayReviewed, // 今天学习过多少题（去重：按 lastReviewedAt 是今天的 gid 数）
   *     targetDone    // 今日是否完成 target（假设 target=20）
   *   }
   */
  function buildDashboard(params) {
    const allGids = params.allGids || [];
    const progressMap = params.progressMap || {};
    const wrongbookEntries = params.wrongbookEntries || [];
    const weekDays = params.weekDays || 7;

    const byStatus = countByStatus(allGids, progressMap);
    const wrongByStatus = countWrongbookByStatus(wrongbookEntries);
    const weekTrend = computeWeekTrend(progressMap, weekDays);

    // 今日复习数（去重）：lastReviewedAt 在今天
    const todayKey = _todayKey();
    let todayReviewed = 0;
    Object.keys(progressMap).forEach(gid => {
      const e = progressMap[gid];
      if (e && _dayKey(e.lastReviewedAt) === todayKey) todayReviewed++;
    });

    return {
      total: byStatus.total,
      learned: byStatus.total - byStatus.new,
      mastered: byStatus.mastered,
      weak: byStatus.learning + byStatus.review + byStatus.due,
      due: byStatus.due,

      wrongTotal: wrongByStatus.total,
      wrongByStatus: wrongByStatus,

      weekTrend: weekTrend,

      todayReviewed: todayReviewed,
      targetDone: false // UI 侧根据 settings.dailyTarget 判断
    };
  }

  global.ExamStats = {
    countByStatus,
    countWrongbookByStatus,
    computeWeekTrend,
    buildDashboard,

    // 暴露供单测
    _dayKey, _todayKey, _pastDayKeys
  };
})(window);
