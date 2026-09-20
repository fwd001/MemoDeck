/**
 * MemoDeck · 取题管线单元测试
 *
 * 运行：node test/queue.test.js
 * 覆盖：ExamQueue.scopeGidsOf / perSessionLimit / buildQueueGids / queueCountOf
 *
 * 核心不变式：queueCountOf() 必须恒等于 buildQueueGids().length ——
 * 重构前学习/练习模式的「将学习 N 题」与实际排队数不一致（显示不截断 perSession），
 * 本文件把这条不变式在所有 scope × strategy × perSession 组合上钉死。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.window = global;
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };

const JS_DIR = path.join(__dirname, '..', 'js');
// 顺序敏感：queue.js 依赖 utils.js
['utils.js', 'queue.js'].forEach(f => {
  vm.runInThisContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), { filename: f });
});

const Queue = global.ExamQueue;

/* ---------- 极简断言 ---------- */
let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e.message}`);
    console.log(`  ✗ ${name}`);
  }
}
function ok(v, msg) { if (!v) throw new Error(msg || '断言失败'); }
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || '值不相等') + `  实际: ${a}  期望: ${b}`);
}
function deepEq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '数组不相等') + `  实际: ${JSON.stringify(a)}  期望: ${JSON.stringify(b)}`);
}

/* ---------- 固定夹具 ---------- */
// 8 道题：4 单选、2 判断、2 填空，其中第 6 题已掌握、第 2/5 题在错题本
const G = i => `p::${i}`;
const ALL = [1, 2, 3, 4, 5, 6, 7, 8].map(G);
const TYPES = { 1: 'single_choice', 2: 'true_false', 3: 'single_choice', 4: 'fill_blank',
                5: 'true_false', 6: 'single_choice', 7: 'fill_blank', 8: 'single_choice' };
const ITEMS = new Map(ALL.map(g => {
  const i = Number(g.split('::')[1]);
  return [g, { gid: g, rawType: TYPES[i] }];
}));
const PROGRESS = {
  [G(1)]: { status: 'learning' },
  [G(6)]: { status: 'mastered' },   // 唯一已掌握
  [G(7)]: { status: 'review' }
};
const DUE = [G(3), G(1), G(5)];      // 故意乱序，用来验证结果按题库顺序过滤
const WRONG = new Set([G(2), G(5)]);

function ctx(extra) {
  return Object.assign({
    allGids: ALL,
    progressMap: PROGRESS,
    wrongGids: WRONG,
    dueGids: DUE,
    itemsByGid: ITEMS,
    cfg: {},
    dailyTask: () => { throw new Error('不该调用 dailyTask'); }
  }, extra || {});
}

/* ============== scopeGidsOf ============== */
test('scope=all 返回全部且保持题库顺序', () => {
  deepEq(Queue.scopeGidsOf('all', ctx()), ALL);
});

test('scope=today 只留下到期题，且按题库顺序而非到期顺序', () => {
  deepEq(Queue.scopeGidsOf('today', ctx()), [G(1), G(3), G(5)]);
});

test('scope=unmastered 排除已掌握', () => {
  const out = Queue.scopeGidsOf('unmastered', ctx());
  ok(!out.includes(G(6)), '已掌握的 p::6 应被排除');
  eq(out.length, 7);
});

test('scope=wrongbook 与当前题库取交集（跨卷残留错题不会混进来）', () => {
  const out = Queue.scopeGidsOf('wrongbook', ctx({ wrongGids: new Set([G(2), G(5), '其他卷::9']) }));
  deepEq(out, [G(2), G(5)]);
});

test('scope=custom 是 1-based 闭区间', () => {
  deepEq(Queue.scopeGidsOf('custom', ctx({ cfg: { start: 2, end: 4 } })), [G(2), G(3), G(4)]);
});

test('scope=custom 越界自动收敛到题库范围', () => {
  deepEq(Queue.scopeGidsOf('custom', ctx({ cfg: { start: 7, end: 999 } })), [G(7), G(8)]);
  deepEq(Queue.scopeGidsOf('custom', ctx({ cfg: { start: 100, end: 200 } })), []);
});

test('scope=custom 未填 end 时取到末尾', () => {
  eq(Queue.scopeGidsOf('custom', ctx({ cfg: { start: 6 } })).length, 3);
});

test('scope=custom 按题型过滤', () => {
  const out = Queue.scopeGidsOf('custom', ctx({ cfg: { start: 1, end: 8, types: { true_false: true } } }));
  deepEq(out, [G(2), G(5)]);
});

test('scope=custom 题型全 false 时不过滤', () => {
  eq(Queue.scopeGidsOf('custom', ctx({ cfg: { start: 1, end: 8, types: { true_false: false } } })).length, 8);
});

test('未知 scope 兜底返回全部', () => {
  deepEq(Queue.scopeGidsOf('nonsense', ctx()), ALL);
});

/* ============== perSessionLimit ============== */
test('perSession=all 不截断', () => {
  eq(Queue.perSessionLimit({ perSession: 'all' }), Infinity);
});

test('perSession 数字字符串按数值截断（表单里是 radio 的字符串值）', () => {
  eq(Queue.perSessionLimit({ perSession: '10' }), 10);
  eq(Queue.perSessionLimit({ perSession: 'custom', perSessionCustom: 25 }), 25);
});

test('perSession 非法或 0 时不截断，而不是清空队列', () => {
  eq(Queue.perSessionLimit({ perSession: 'custom', perSessionCustom: 0 }), Infinity);
  eq(Queue.perSessionLimit({ perSession: 'abc' }), Infinity);
});

/* ============== buildQueueGids ============== */
test('strategy=sequential + perSession 取前 N 题且保持原序', () => {
  deepEq(Queue.buildQueueGids(ctx(), { scope: 'all', strategy: 'sequential', perSession: '3' }),
    [G(1), G(2), G(3)]);
});

test('strategy=random 是排列：元素不多不少', () => {
  const out = Queue.buildQueueGids(ctx(), { scope: 'all', strategy: 'random', perSession: 'all' });
  eq(out.length, ALL.length);
  deepEq(out.slice().sort(), ALL.slice().sort());
});

test('strategy=random 不修改传入的 allGids', () => {
  const before = ALL.slice();
  Queue.buildQueueGids(ctx(), { scope: 'all', strategy: 'random', perSession: 'all' });
  deepEq(ALL, before);
});

test('strategy=due 委托给每日任务调度器并透传 (allGids, target, pool)', () => {
  let seen = null;
  const c = ctx({
    dailyTask: (all, target, pool) => { seen = { all, target, pool }; return { queue: pool.slice(0, 2) }; }
  });
  const out = Queue.buildQueueGids(c, { scope: 'today', strategy: 'due', perSession: '2' });
  eq(out.length, 2);
  eq(seen.target, 2, '应按 perSession 传目标量');
  deepEq(seen.all, ALL, '第一个参数应是全体 gid');
  deepEq(seen.pool, [G(1), G(3), G(5)], '第三个参数应是 scope 过滤后的候选池');
});

test('strategy=due 且 perSession=all 时目标量为候选池大小', () => {
  let target = null;
  const c = ctx({ dailyTask: (all, t, pool) => { target = t; return { queue: pool }; } });
  Queue.buildQueueGids(c, { scope: 'today', strategy: 'due', perSession: 'all' });
  eq(target, 3);
});

/* ============== 核心不变式：计数 == 实际队列长度 ============== */
test('queueCountOf 恒等于 buildQueueGids().length（全组合遍历）', () => {
  const scopes = ['all', 'today', 'unmastered', 'wrongbook'];
  const strategies = ['sequential', 'random', 'due'];
  const perSessions = ['all', '3', '5', '100'];
  let combos = 0;
  const c = ctx({ dailyTask: (all, target, pool) => ({ queue: pool.slice(0, target) }) });
  scopes.forEach(scope => strategies.forEach(strategy => perSessions.forEach(perSession => {
    const cfg = { scope, strategy, perSession };
    eq(Queue.queueCountOf(c, cfg), Queue.buildQueueGids(c, cfg).length,
      `组合 ${scope}/${strategy}/${perSession}`);
    combos++;
  })));
  eq(combos, 48);
});

test('queueCountOf 对 custom 范围与题型过滤同样成立', () => {
  const c = ctx({ dailyTask: (all, target, pool) => ({ queue: pool.slice(0, target) }) });
  [{ scope: 'custom', start: 2, end: 6, types: {} },
   { scope: 'custom', start: 1, end: 8, types: { single_choice: true } },
   { scope: 'custom', start: 5, end: 3, types: {} }].forEach(base => {
    ['sequential', 'random', 'due'].forEach(strategy => ['all', '2', '9'].forEach(perSession => {
      const cfg = Object.assign({ strategy, perSession }, base);
      eq(Queue.queueCountOf(c, cfg), Queue.buildQueueGids(c, cfg).length,
        `custom ${base.start}-${base.end}/${strategy}/${perSession}`);
    }));
  });
});

test('custom 的 start>end 返回空队列（徽标与实际都显示 0，不再互相矛盾）', () => {
  const cfg = { scope: 'custom', strategy: 'sequential', perSession: 'all' };
  const c = ctx({ cfg: { start: 6, end: 2 } });
  eq(Queue.queueCountOf(c, cfg), 0);
  deepEq(Queue.buildQueueGids(c, cfg), []);
});

/* ---------- 汇总 ---------- */
console.log('\n' + '─'.repeat(46));
if (failed) {
  console.log(`✗ 通过 ${passed} 项，失败 ${failed} 项：`);
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
console.log(`✓ 全部通过：${passed} 项`);
