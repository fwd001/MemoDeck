/**
 * MemoDeck · 取题管线（纯逻辑，无 DOM / Vue 依赖）
 * 挂载到 window.ExamQueue
 *
 * 职责：把「范围过滤 → 题型过滤 → 排序 → 数量截断」收敛成唯一一份实现。
 * 学习 / 练习 / 模拟考试三个模式此前各有一份逐字重复的拷贝，且各自手写了
 * js/utils.js 里已有单测的 Fisher-Yates 洗牌。
 *
 * 设计：所有外部依赖（进度表、错题集合、到期集合、每日任务调度）一律由调用方
 * 通过 ctx 注入，本模块不读 localStorage、不碰 Vue，因此可单独在 Node 里跑单测。
 *
 * 依赖：ExamUtils（shuffle）。加载顺序：utils.js → queue.js
 */
(function (global) {
  'use strict';

  const Utils = global.ExamUtils;

  /**
   * 按范围切出候选 gid。
   * @param {string} scope  all | today | unmastered | wrongbook | custom
   * @param {object} ctx
   *   ctx.allGids    string[]  题库全体 gid（顺序即题库顺序）
   *   ctx.progressMap { [gid]: entry }  学习进度（unmastered 用）
   *   ctx.wrongGids  Set<string>        错题本 gid（wrongbook 用）
   *   ctx.dueGids    string[]           到期复习 gid（today 用）
   *   ctx.itemsByGid Map<gid, item>     题目索引（custom 的题型过滤用）
   *   ctx.cfg        { start, end, types }  custom 的边界与题型
   */
  function scopeGidsOf(scope, ctx) {
    const all = ctx.allGids || [];
    if (scope === 'unmastered') {
      const pm = ctx.progressMap || {};
      return all.filter(g => { const e = pm[g]; return !e || e.status !== 'mastered'; });
    }
    if (scope === 'wrongbook') {
      const wg = ctx.wrongGids || new Set();
      return all.filter(g => wg.has(g));
    }
    if (scope === 'today') {
      const due = ctx.dueGids || [];
      return all.filter(g => due.indexOf(g) >= 0);
    }
    if (scope === 'custom') {
      const cfg = ctx.cfg || {};
      const n = all.length;
      const s = Math.max(1, cfg.start || 1);
      const e = Math.min(n, cfg.end > 0 ? cfg.end : n);
      let out = all.slice(s - 1, e);
      const types = cfg.types || {};
      if (Object.values(types).some(Boolean)) {
        const byGid = ctx.itemsByGid || new Map();
        out = out.filter(g => { const it = byGid.get(g); return it && types[it.rawType]; });
      }
      return out;
    }
    return all.slice();
  }

  /**
   * 「每次 N 题」解析成具体上限；'all' 或非法值返回 Infinity（不截断）。
   */
  function perSessionLimit(cfg) {
    if (cfg.perSession === 'all') return Infinity;
    const n = cfg.perSession === 'custom' ? Number(cfg.perSessionCustom) : Number(cfg.perSession);
    return n > 0 ? n : Infinity;
  }

  /**
   * 生成本次会话的队列。
   * @param {object} ctx  同上，另需 ctx.dailyTask(allGids, target, poolGids) => { queue }
   * @param {object} cfg  { scope, strategy, perSession, perSessionCustom, start, end, types }
   * @returns {string[]}
   */
  function buildQueueGids(ctx, cfg) {
    const pool = scopeGidsOf(cfg.scope, ctx);
    if (cfg.strategy === 'due') {
      // 到期优先：排序与截断都交给每日任务调度器，它负责 due > unmastered > 新题
      const limit = perSessionLimit(cfg);
      const target = limit === Infinity ? pool.length : (Number(cfg.perSession) || limit);
      return ctx.dailyTask(ctx.allGids, target, pool).queue;
    }
    const ordered = cfg.strategy === 'random' ? Utils.shuffle(pool) : pool.slice();
    const limit = perSessionLimit(cfg);
    return limit === Infinity ? ordered : ordered.slice(0, limit);
  }

  /**
   * 队列长度：顺序不影响计数，因此跳过洗牌，保证与 buildQueueGids 结果数一致。
   */
  function queueCountOf(ctx, cfg) {
    if (cfg.strategy === 'due') return buildQueueGids(ctx, cfg).length;
    const pool = scopeGidsOf(cfg.scope, ctx);
    const limit = perSessionLimit(cfg);
    return limit === Infinity ? pool.length : Math.min(pool.length, limit);
  }

  global.ExamQueue = {
    scopeGidsOf, perSessionLimit, buildQueueGids, queueCountOf
  };
})(window);
