/**
 * MemoDeck · 纯逻辑单元测试
 *
 * 运行：node test/core.test.js
 * 无依赖、无框架、无构建步骤 —— 与项目「零工具链」的定位一致。
 *
 * 被测模块不依赖 DOM/Vue，因此在 Node 里用一个假的 window 即可加载。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------- 加载被测模块 ---------- */
// 各模块都是 (function(global){...})(window)，提供假的 window 即可在 Node 中加载。
// store.js 依赖 localStorage，需在加载前准备好最小内存实现。
global.window = global;

const mem = {};
global.localStorage = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};

const JS_DIR = path.join(__dirname, '..', 'js');
// 顺序敏感：store.js 必须在 wrongbook.js 之前
for (const f of ['core.js', 'store.js', 'leitner.js', 'wrongbook.js', 'utils.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), { filename: f });
}

const Core = global.ExamCore;
const Leitner = global.ExamLeitner;
const Wrongbook = global.ExamWrongbook;
const Utils = global.ExamUtils;

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
    failures.push({ name, message: e.message });
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || '值不相等'}\n        实际: ${a}\n        期望: ${e}`);
}
function throws(fn, keyword, msg) {
  let threw = false, err = null;
  try { fn(); } catch (e) { threw = true; err = e; }
  if (!threw) throw new Error(msg || '期望抛错但没有');
  if (keyword && !String(err.message).includes(keyword)) {
    throw new Error(`${msg || '错误信息不匹配'}\n        实际: ${err.message}\n        期望包含: ${keyword}`);
  }
}

/* ================= normalizeBank ================= */
console.log('\nnormalizeBank（三种输入格式）');

const STANDARD = {
  view: 'exam-bank',
  viewVersion: '1.0.0',
  meta: { title: '示例题库' },
  features: { practice: { enabled: true } },
  papers: [{
    id: 'p1', name: '第一卷',
    questions: [
      { id: 1, type: 'fill_blank', question: '我国有文字可考的历史开始于____朝。', blanks: [{ index: 1, answer: '商' }] },
      { id: 2, type: 'true_false', question: '秦始皇统一六国。', answer: true },
      { id: 3, type: 'single_choice', question: '统一六国在哪一年？', options: { A: '前230年', B: '前221年' }, answer: 'B' },
      { id: 4, type: 'multi_choice', question: '哪些是秦朝举措？', options: { A: '统一度量衡', B: '修长城' }, answer: ['A', 'B'] },
      { id: 5, type: 'essay', question: '简述秦统一的意义。', answer: '参考答案' }
    ]
  }]
};

test('标准格式（view=exam-bank + papers）', () => {
  const r = Core.normalizeBank(STANDARD);
  eq(r.meta.title, '示例题库', 'meta 应保留');
  eq(r.features.practice.enabled, true, 'features 应保留');
  eq(r.papers.length, 1);
  eq(r.papers[0].name, '第一卷');
  eq(r.papers[0].questions.length, 5);
});

test('JSON 字符串输入可解析', () => {
  const r = Core.normalizeBank(JSON.stringify(STANDARD));
  eq(r.papers[0].questions.length, 5);
});

test('顶层 papers 数组', () => {
  const r = Core.normalizeBank([{ id: 'x', name: 'X卷', questions: [{ id: 1, type: 'essay', question: 'Q', answer: 'A' }] }]);
  eq(r.papers[0].name, 'X卷');
  eq(r.papers[0].questions[0].type, 'essay');
});

test('旧版格式（卷子键 + 中文题型分组）', () => {
  const legacy = {
    '卷1': {
      paper_name: '历史第一卷',
      questions: {
        '填空题': [{ id: 1, question: '____朝', blanks: [{ answer: '商' }] }],
        '判断题': [{ id: 2, question: '对吗？', answer: true }],
        '单项选择题': [{ id: 3, question: '选哪个？', options: { A: 'a', B: 'b' }, answer: 'B' }]
      }
    }
  };
  const r = Core.normalizeBank(legacy);
  eq(r.papers[0].name, '历史第一卷', '应取 paper_name');
  const qs = r.papers[0].questions;
  eq(qs.length, 3);
  eq(qs.map(q => q.type), ['fill_blank', 'true_false', 'single_choice'], '中文题型名应映射为 type，且按固定顺序');
  eq(qs[1].answer, true, '旧版判断题布尔值应保留为 true');
});

test('旧版判断题多种「正确」写法都能识别', () => {
  for (const v of [true, '√', '对', '正确']) {
    const r = Core.normalizeBank({
      v1: { questions: { '判断题': [{ id: 1, question: 'q', answer: v }] } }
    });
    eq(r.papers[0].questions[0].answer, true, `answer=${JSON.stringify(v)} 应归一化为 true`);
  }
  const f = Core.normalizeBank({ v1: { questions: { '判断题': [{ id: 1, question: 'q', answer: false }] } } });
  eq(f.papers[0].questions[0].answer, false, 'false 应保持 false');
});

test('非法输入应抛错', () => {
  throws(() => Core.normalizeBank('not json'), '无效的 JSON 字符串');
  throws(() => Core.normalizeBank({}), '无法识别');
  throws(() => Core.normalizeBank({ view: 'exam-bank', papers: [] }), 'papers 为空');
  throws(() => Core.normalizeBank(null), 'JSON 必须是对象');
});

test('papers 缺省 name 时回退为 id', () => {
  const r = Core.normalizeBank({ view: 'exam-bank', papers: [{ id: 7, questions: [{ id: 1, type: 'essay', question: 'q', answer: 'a' }] }] });
  eq(r.papers[0].name, '7');
});

/* ================= buildItems / renderAnswer ================= */
console.log('\nbuildItems 与 renderAnswer');

test('buildItems 按题型顺序排序并拼装渲染字段', () => {
  const items = Core.buildItems(Core.normalizeBank(STANDARD), 'p1');
  eq(items.length, 5);
  eq(items.map(i => i.rawType),
    ['fill_blank', 'true_false', 'single_choice', 'multi_choice', 'essay'],
    '应按 TYPE_REGISTRY.order 排序');
  const sc = items.find(i => i.rawType === 'single_choice');
  assert(sc.q.includes('A. 前230年'), '单选题干应拼接选项文本');
  eq(sc.typeLabel, '单选题');
  eq(sc.paper, '第一卷');
});

test('buildItems 传入不存在的 paperId 时回退第一卷', () => {
  const items = Core.buildItems(Core.normalizeBank(STANDARD), '不存在');
  eq(items.length, 5);
});

test('renderAnswer 各题型渲染正确', () => {
  const items = Core.buildItems(Core.normalizeBank(STANDARD), 'p1');
  const by = t => items.find(i => i.rawType === t);
  eq(by('fill_blank').a, ['商'], '填空返回答案数组');
  eq(by('true_false').a, '正确', '判断渲染为中文');
  eq(by('single_choice').a, 'B. 前221年', '单选渲染为「字母. 内容」');
  eq(by('multi_choice').a, 'A, B', '多选渲染为逗号分隔');
  eq(by('essay').a, '参考答案', '问答直接返回文本');
});

test('未知题型兜底不报错', () => {
  const r = Core.normalizeBank({ view: 'exam-bank', papers: [{ id: 'p', questions: [{ id: 1, type: 'unknown_type', question: 'q', answer: 'a' }] }] });
  const items = Core.buildItems(r, 'p');
  eq(items.length, 1);
  eq(items[0].typeLabel, 'unknown_type', '未知题型 label 回退为 type 本身');
  eq(items[0].a, 'a');
});

/* ================= Leitner ================= */
console.log('\nLeitner 记忆调度');

const cards = n => Leitner.createQueue(Array.from({ length: n }, (_, i) => i));

test('答对一次即掌握并移出队列', () => {
  const q = Leitner.createQueue(['A']);
  const r = Leitner.markPass(q);
  eq(r.mastered, true, '记住一次应判定掌握');
  eq(r.card.streak, 1);
  eq(q.length, 0, '掌握后应移出队列');
});

test('答对后进度前移，下一题成为队首', () => {
  const q = Leitner.createQueue(['A', 'B', 'C']);
  Leitner.markPass(q); // 掌握 A
  eq(q.length, 2);
  eq(q[0].it, 'B', '答对后不应重插当前卡，下一卡成为队首');
  Leitner.markPass(q); // 掌握 B
  eq(q.length, 1);
  eq(q[0].it, 'C');
});

test('答错后埋到 5~7 张之后，不会立刻重现', () => {
  const q = cards(30);
  const target = q[0].it;
  const r = Leitner.markFail(q);
  eq(r.card.streak, 0, '答错 streak 应清零');
  eq(q[0].it, 1, '队首应换成原本第二张卡');
  const idx = q.findIndex(c => c.it === target);
  assert(idx >= Leitner.MIN_FAIL_GAP && idx <= Leitner.MIN_FAIL_GAP + 2,
    `应埋到 ${Leitner.MIN_FAIL_GAP}~${Leitner.MIN_FAIL_GAP + 2} 张之后，实际 ${idx}`);
});

test('答错只埋当前题，其余卡片相对顺序不变', () => {
  const q = cards(30);
  const orderBefore = q.map(c => c.it).join(',');
  Leitner.markFail(q);
  const withoutTarget = q.map(c => c.it).filter(x => x !== 0);
  eq(withoutTarget.join(','), orderBefore.split(',').filter(x => x !== '0').join(','), '其余卡片顺序应保持');
});

test('空队列调用返回 null 不报错', () => {
  const q = [];
  eq(Leitner.markPass(q), null);
  eq(Leitner.markFail(q), null);
});

/* ================= Wrongbook ================= */
console.log('\n错题本');

const ITEM = { id: 1, rawType: 'true_false', q: '题干', a: '正确' };

test('新增与列出', () => {
  Wrongbook.clear();
  Wrongbook.add(ITEM, 'preview');
  const list = Wrongbook.list();
  eq(list.length, 1);
  eq(list[0].item.id, 1);
  eq(list[0].source, 'preview');
});

test('同题重复添加应全局去重（同来源）', () => {
  Wrongbook.clear();
  Wrongbook.add(ITEM, 'preview');
  Wrongbook.add(ITEM, 'preview');
  eq(Wrongbook.list().length, 1, '相同题目不应重复入库');
});

test('同题跨来源也应去重，且来源更新为最新', () => {
  Wrongbook.clear();
  Wrongbook.add(ITEM, 'preview');
  const second = Wrongbook.add(ITEM, 'exam');
  eq(second, false, '再次入库应返回 false（非新增）');
  eq(Wrongbook.list().length, 1, '同一道题跨来源只保留一条');
  eq(Wrongbook.list()[0].source, 'exam', '来源应更新为最新出错场景');
  // 第三次从练习出错：来源再次刷新，条目仍只有一条
  Wrongbook.add(ITEM, 'practice');
  eq(Wrongbook.list().length, 1);
  eq(Wrongbook.list()[0].source, 'practice');
});

test('按题目移除', () => {
  Wrongbook.clear();
  Wrongbook.add(ITEM, 'exam');
  Wrongbook.add({ id: 2, rawType: 'essay', q: 'q2', a: 'a2' }, 'exam');
  eq(Wrongbook.list().length, 2);
  Wrongbook.removeByItem(ITEM);
  const list = Wrongbook.list();
  eq(list.length, 1);
  eq(list[0].item.id, 2);
});

test('按来源统计', () => {
  Wrongbook.clear();
  Wrongbook.add({ id: 1, q: 'a' }, 'practice');
  Wrongbook.add({ id: 2, q: 'b' }, 'practice');
  Wrongbook.add({ id: 3, q: 'c' }, 'exam');
  const c = Wrongbook.countBySource();
  eq(c.practice, 2);
  eq(c.exam, 1);
});

test('清空', () => {
  Wrongbook.clear();
  eq(Wrongbook.list().length, 0);
});

/* ================= Utils ================= */
console.log('\n轻量工具 utils');

test('shuffle 返回新数组且元素完整（排列不丢失）', () => {
  const src = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  for (let i = 0; i < 20; i++) {
    const out = Utils.shuffle(src);
    eq(out.length, src.length, '长度不变');
    eq(out.slice().sort((a, b) => a - b), src, '元素集合不变（仅顺序随机）');
    assert(out !== src, '应返回新数组');
  }
  eq(src, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], '原数组不应被修改');
});

test('shuffle 空数组 / 单元素安全', () => {
  eq(Utils.shuffle([]), []);
  eq(Utils.shuffle([1]), [1]);
});

test('groupBy 按键分组且保持首次出现顺序', () => {
  const list = [
    { k: 'a', v: 1 },
    { k: 'b', v: 2 },
    { k: 'a', v: 3 },
    { k: 'c', v: 4 }
  ];
  const g = Utils.groupBy(list, it => it.k);
  eq(Object.keys(g), ['a', 'b', 'c'], '键顺序应为首次出现顺序');
  eq(g.a.map(x => x.v), [1, 3]);
  eq(g.b.map(x => x.v), [2]);
  eq(g.c.map(x => x.v), [4]);
});

test('groupBy 空数组安全', () => {
  eq(Utils.groupBy([], it => it.k), {});
});

/* ================= 结果 ================= */
console.log(`\n${'─'.repeat(46)}`);
if (failed === 0) {
  console.log(`✓ 全部通过：${passed} 项`);
  process.exit(0);
} else {
  console.log(`✗ 通过 ${passed} 项，失败 ${failed} 项：`);
  failures.forEach(f => console.log(`  - ${f.name}: ${f.message}`));
  process.exit(1);
}
