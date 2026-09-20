/**
 * MemoDeck · 阶段 0 新增模块单元测试
 *
 * 运行：node test/extensions.test.js
 * 覆盖：ExamCore.makeGlobalId / ExamMigration / ExamProgress / ExamSession / ExamStats
 *
 * 被测模块全部不依赖 DOM/Vue，因此用 Node + 假 localStorage + vm 加载即可。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------- 加载被测模块 ---------- */
global.window = global;

let mem;
function resetStorage() {
  mem = {};
  global.localStorage = {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; },
    clear: () => { mem = {}; }
  };
}
resetStorage();

const JS_DIR = path.join(__dirname, '..', 'js');
// 加载顺序敏感：core → store → leitner → wrongbook → migration → progress → utils → ai-prompt → session → stats
['core.js', 'store.js', 'leitner.js', 'wrongbook.js', 'migration.js', 'progress.js', 'utils.js', 'ai-prompt.js', 'session.js', 'stats.js'].forEach(f => {
  vm.runInThisContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), { filename: f });
});

const Core = global.ExamCore;
const Migration = global.ExamMigration;
const Progress = global.ExamProgress;
const Session = global.ExamSession;
const Stats = global.ExamStats;
const Store = global.ExamStore;
const Wrongbook = global.ExamWrongbook;

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
function ok(val, msg) {
  if (!val) throw new Error(msg || '期望 truthy');
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || '值不相等'}\n        实际: ${a}\n        期望: ${e}`);
}

/* ============== makeGlobalId ============== */
console.log('\nExamCore.makeGlobalId');

test('paperId 字符串 + questionId 数字 → 正确格式', () => {
  eq(Core.makeGlobalId('卷1', 42), '卷1::42');
});
test('paperId / questionId 都是数字 → 正确格式', () => {
  eq(Core.makeGlobalId(7, 3), '7::3');
});
test('多卷不同但 id 相同的题目 → gid 不同（核心用途）', () => {
  eq(Core.makeGlobalId('卷1', 1), '卷1::1');
  eq(Core.makeGlobalId('卷2', 1), '卷2::1');
  assert(Core.makeGlobalId('卷1', 1) !== Core.makeGlobalId('卷2', 1), '不同卷同 id 的 gid 必须不同');
});

/* ============== ExamProgress ============== */
console.log('\nExamProgress（每次测试前清空）');

function freshProgress() { Progress.clear(); }

test('getOrCreate 不存在时创建默认 new 条目', () => {
  freshProgress();
  const e = Progress.getOrCreate('p::1');
  eq(e.status, 'new');
  eq(e.attempts, 0);
  eq(e.streak, 0);
  eq(e.masteredAt, null);
});

test('set 合并字段', () => {
  freshProgress();
  Progress.set('p::1', { attempts: 3, status: 'learning' });
  const e = Progress.get('p::1');
  eq(e.attempts, 3);
  eq(e.status, 'learning');
});

test('markPass 连续答对 1 → streak=1, +1 天', () => {
  freshProgress();
  Progress.markPass('p::1');
  const e = Progress.get('p::1');
  eq(e.attempts, 1);
  eq(e.correct, 1);
  eq(e.streak, 1);
  const nr = new Date(e.nextReviewAt);
  const now = new Date();
  const diffDays = Math.round((nr - now) / 86400000);
  assert(diffDays === 1, `streak=1 应间隔 1 天，实际差 ${diffDays} 天`);
});

test('markPass 连续答对 5 次 → 自动 mastered', () => {
  freshProgress();
  for (let i = 0; i < 5; i++) Progress.markPass('p::1');
  const e = Progress.get('p::1');
  eq(e.status, 'mastered');
  assert(e.masteredAt != null, 'masteredAt 应有值');
});

test('markFail → streak=0, 立即复习 (nextReviewAt ≈ now)', () => {
  freshProgress();
  Progress.markPass('p::1');
  Progress.markPass('p::1'); // streak=2
  Progress.markFail('p::1');
  const e = Progress.get('p::1');
  eq(e.streak, 0);
  eq(e.status, 'learning');
  const nr = new Date(e.nextReviewAt);
  const diffMs = Math.abs(nr - new Date());
  assert(diffMs < 5000, 'markFail 后 nextReviewAt 应≈现在');
});

test('markMastered / markForgotten', () => {
  freshProgress();
  Progress.markForgotten('p::1');
  let e = Progress.get('p::1');
  eq(e.status, 'learning');
  eq(e.streak, 0);

  Progress.markMastered('p::1');
  e = Progress.get('p::1');
  eq(e.status, 'mastered');
  assert(e.masteredAt != null);
});

test('getDueQuestions 包含到期题和新题', () => {
  freshProgress();
  // 新题（无 entry）
  // 到期题：手动把 nextReviewAt 设成过去
  const past = new Date(Date.now() - 86400000).toISOString();
  Progress.set('p::2', { status: 'learning', nextReviewAt: past });
  // 未到期题：nextReviewAt 设成未来
  const future = new Date(Date.now() + 7 * 86400000).toISOString();
  Progress.set('p::3', { status: 'review', nextReviewAt: future });
  // 已掌握题
  Progress.markMastered('p::4');

  const gids = ['p::1', 'p::2', 'p::3', 'p::4'];
  const due = new Set(Progress.getDueQuestions(gids));
  assert(due.has('p::1'), '新题应在 due 里');
  assert(due.has('p::2'), '到期题应在 due 里');
  assert(!due.has('p::3'), '未到期题不应在 due 里');
  assert(!due.has('p::4'), '已掌握题不应在 due 里');
});

test('getStatistics 按 status 分组', () => {
  freshProgress();
  Progress.set('p::1', { status: 'learning', attempts: 1 });
  Progress.set('p::2', { status: 'review', attempts: 2 });
  Progress.markMastered('p::3');
  const gids = ['p::1', 'p::2', 'p::3', 'p::4'];
  const s = Progress.getStatistics(gids);
  eq(s.total, 4);
  eq(s.new, 1);   // p::4 无 entry
  eq(s.learning, 1);
  eq(s.review, 1);
  eq(s.mastered, 1);
  eq(s.attempted, 3);
});

/* ============== ExamMigration ============== */
console.log('\nExamMigration（每次测试前清空所有 store）');

function resetAll() {
  resetStorage();
  localStorage.clear();
}

test('upgradeWrongbookEntry v1→v2：保留旧字段 + 新增 v2 字段', () => {
  resetAll();
  const v1 = { id: 'abc', source: 'practice', item: { id: 1, rawType: 'single_choice' }, addedAt: '2026-09-10T10:00:00Z' };
  const v2 = Migration.upgradeWrongbookEntry(v1, '卷1');
  eq(v2.id, 'abc');
  eq(v2.source, 'practice');
  eq(v2.gid, '卷1::1');
  eq(v2.paperId, '卷1');
  eq(v2.firstWrongAt, '2026-09-10T10:00:00Z');
  eq(v2.wrongCount, 1);
  eq(v2.status, 'new');
  eq(v2.consecutiveRight, 0);
});

test('migrateWrongbook 从 v1 生成 v2', () => {
  resetAll();
  // 手动写 v1 wrongbook
  localStorage.setItem('examWrongbook:v1', JSON.stringify({
    entries: [
      { id: 'a', source: 'practice', item: { id: 1, rawType: 'true_false' }, addedAt: '2026-09-10T10:00:00Z' },
      { id: 'b', source: 'exam', item: { id: 2, rawType: 'single_choice' }, addedAt: '2026-09-11T08:00:00Z' }
    ]
  }));

  const bank = { papers: [
    { id: '卷1', name: '第一卷', questions: [
      { id: 1, type: 'true_false', question: 'q1', answer: true },
      { id: 2, type: 'single_choice', question: 'q2', options: {}, answer: 'A' }
    ] }
  ] };

  const r = Migration.migrateWrongbook(bank);
  eq(r.migrated, 2);

  const v2 = JSON.parse(localStorage.getItem('examWrongbook:v2'));
  eq(v2.version, 2);
  eq(v2.entries.length, 2);
  assert(v2.entries[0].gid === '卷1::1', 'gid 应精确匹配题库');
  assert(v2.entries[1].gid === '卷1::2');
});

test('migrateWrongbook 幂等：v2 已有数据时跳过', () => {
  resetAll();
  // 预置 v2
  localStorage.setItem('examWrongbook:v2', JSON.stringify({ version: 2, entries: [{ id: 'x', gid: '卷1::1', status: 'learning' }] }));
  // 预置 v1（模拟旧数据）
  localStorage.setItem('examWrongbook:v1', JSON.stringify({ entries: [{ id: 'old' }] }));

  const r = Migration.migrateWrongbook({ papers: [] });
  eq(r.migrated, 0, '幂等时不应再迁移');

  const v2 = JSON.parse(localStorage.getItem('examWrongbook:v2'));
  eq(v2.entries.length, 1, 'v2 条目数不变');
});

test('initProgressFromWrongbook 从 v2 推断 progress', () => {
  resetAll();
  localStorage.setItem('examWrongbook:v2', JSON.stringify({
    version: 2, entries: [
      { gid: '卷1::1', wrongCount: 1, lastWrongAt: '2026-09-10T10:00:00Z', status: 'new' },
      { gid: '卷1::2', wrongCount: 2, lastWrongAt: '2026-09-11T08:00:00Z', status: 'new' }
    ]
  }));

  const r = Migration.initProgressFromWrongbook();
  eq(r.initialized, 2);
  eq(r.skipped, false);

  const prog = JSON.parse(localStorage.getItem('examProgress:v1'));
  eq(prog.progress['卷1::1'].status, 'learning');
  eq(prog.progress['卷1::1'].wrong, 1);
  eq(prog.progress['卷1::2'].wrong, 1); // migration 只记第一次，后续 wrong 从 v2 推断
});

test('initProgressFromWrongbook 幂等：progress 存在时跳过', () => {
  resetAll();
  localStorage.setItem('examProgress:v1', JSON.stringify({ version: 1, progress: { '卷1::1': { status: 'mastered' } } }));
  const r = Migration.initProgressFromWrongbook();
  eq(r.skipped, true);
  const prog = JSON.parse(localStorage.getItem('examProgress:v1'));
  eq(prog.progress['卷1::1'].status, 'mastered', '原有数据不受影响');
});

/* ============== ExamSession ============== */
console.log('\nExamSession（每次测试前清空）');

test('saveResumePoint / loadResumePoint / clearResumePoint', () => {
  resetAll();
  Session.saveResumePoint({
    bankId: 'test-bank',
    paperId: '卷1',
    mode: 'study',
    queueGids: ['卷1::1', '卷1::2', '卷1::3'],
    currentIndex: 1,
    segment: { start: 1, end: 100, perSession: 20 }
  });

  const rp = Session.loadResumePoint();
  assert(rp != null, '应能读到恢复点');
  eq(rp.bankId, 'test-bank');
  eq(rp.currentIndex, 1);
  eq(rp.queueGids.length, 3);

  // bankId 过滤
  eq(Session.loadResumePoint('other-bank'), null, '不匹配 bankId 应返回 null');
  assert(Session.loadResumePoint('test-bank') != null);

  Session.clearResumePoint();
  eq(Session.loadResumePoint(), null, '清除后应返回 null');
});

test('恢复点按模式分桶：三个模式互不顶包', () => {
  resetAll();
  const mk = (mode, index) => Session.saveResumePoint({
    bankId: 'test-bank', paperId: '卷1', mode,
    queueGids: ['卷1::1', '卷1::2'], currentIndex: index
  });

  mk('study', 1);
  mk('exercise', 0);
  mk('exam', 1);

  eq(Session.loadResumePoint('test-bank', 'study').currentIndex, 1, '学习恢复点仍在');
  eq(Session.loadResumePoint('test-bank', 'exercise').currentIndex, 0, '练习恢复点仍在');
  eq(Session.loadResumePoint('test-bank', 'exam').currentIndex, 1, '考试恢复点仍在');

  // 清掉考试不影响另外两个
  Session.clearResumePoint('exam');
  eq(Session.loadResumePoint('test-bank', 'exam'), null, '考试恢复点已清');
  assert(Session.loadResumePoint('test-bank', 'study') != null, '学习恢复点不受影响');
  assert(Session.loadResumePoint('test-bank', 'exercise') != null, '练习恢复点不受影响');

  // 无 mode 时给最近触碰的那个（把 study 的时间戳拨旧，避开同毫秒并列）
  const raw = JSON.parse(localStorage.getItem('examSession:v1'));
  raw.resumes.study.lastTouchedAt = '2020-01-01T00:00:00.000Z';
  localStorage.setItem('examSession:v1', JSON.stringify(raw));
  Session.touchResumePoint(0, 'exercise');
  eq(Session.loadResumePoint('test-bank').mode, 'exercise', '无 mode 应返回最近触碰的恢复点');

  // 清空全部
  Session.clearResumePoint();
  eq(Session.loadResumePoint('test-bank', 'study'), null);
  eq(Session.loadResumePoint('test-bank', 'exercise'), null);
});

test('touchResumePoint 只写自己的桶', () => {
  resetAll();
  Session.saveResumePoint({ bankId: 'b', paperId: 'p', mode: 'study', queueGids: ['g1', 'g2', 'g3'], currentIndex: 0 });
  Session.saveResumePoint({ bankId: 'b', paperId: 'p', mode: 'exam', queueGids: ['g1', 'g2', 'g3'], currentIndex: 0 });

  eq(Session.touchResumePoint(2, 'exam'), true, '存在的桶应返回 true');
  eq(Session.loadResumePoint('b', 'exam').currentIndex, 2, '考试桶下标已更新');
  eq(Session.loadResumePoint('b', 'study').currentIndex, 0, '学习桶下标不受影响');
  eq(Session.touchResumePoint(1, 'practice'), false, '没有恢复点的模式返回 false');
});

test('examSession v1 单槽数据就地升级为 v2 分桶', () => {
  resetAll();
  localStorage.setItem('examSession:v1', JSON.stringify({
    version: 1,
    resume: {
      bankId: 'old-bank', paperId: '卷1', mode: 'exam',
      queueGids: ['卷1::1', '卷1::2'], currentIndex: 1,
      startedAt: '2026-09-01T00:00:00.000Z', lastTouchedAt: '2026-09-01T00:00:00.000Z',
      segment: null, answers: { '卷1::1': { choice: 'A', multiSel: [], input: '', answered: true } }
    }
  }));

  const rp = Session.loadResumePoint('old-bank', 'exam');
  assert(rp != null, '旧恢复点应可读');
  eq(rp.currentIndex, 1);
  eq(rp.answers['卷1::1'].choice, 'A', '作答快照不丢');

  // 写入新模式的恢复点后，存储升级为 v2，旧恢复点仍在
  Session.saveResumePoint({ bankId: 'old-bank', paperId: '卷1', mode: 'study', queueGids: ['卷1::1'], currentIndex: 0 });
  const raw = JSON.parse(localStorage.getItem('examSession:v1'));
  eq(raw.version, 2, '内部版本升级到 2');
  eq(Object.keys(raw.resumes).sort(), ['exam', 'study']);
  assert(Session.loadResumePoint('old-bank', 'exam') != null, '升级后旧恢复点仍是 exam 桶');
});

test('sliceSegment 按题目序号切分（1-based）', () => {
  resetAll();
  const all = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  eq(Session.sliceSegment(all, null).length, 10);
  eq(Session.sliceSegment(all, { start: 3, end: 5 }), ['c', 'd', 'e']);
  eq(Session.sliceSegment(all, { start: 1, end: 3 }), ['a', 'b', 'c']);
  eq(Session.sliceSegment(all, { start: 8, end: 99 }), ['h', 'i', 'j']);
  eq(Session.sliceSegment(all, { start: 100, end: 200 }), [], '超范围返回空');
});

test('generateDailyTask 优先级：due > unmastered > new → 截断到 target', () => {
  resetAll();
  // 构造 progress：
  //   p::1 到期（status=learning, nextReviewAt 过去）
  //   p::2 到期（status=new, 无 entry）
  //   p::3 未到期但未掌握
  //   p::4 已掌握（跳过）
  //   p::5 到期（new）
  const future = new Date(Date.now() + 7 * 86400000).toISOString();
  const past = new Date(Date.now() - 86400000).toISOString();
  Progress.set('p::1', { status: 'learning', nextReviewAt: past });
  Progress.set('p::3', { status: 'review', nextReviewAt: future });
  Progress.markMastered('p::4');

  const allGids = ['p::1', 'p::2', 'p::3', 'p::4', 'p::5'];
  const result = Session.generateDailyTask(allGids, 3);
  // due = [p::1, p::2, p::5]（p::3 未到期，p::4 mastered）
  // target=3 → queue 就是 due 的 3 个
  eq(result.queue.length, 3);
  assert(result.queue.includes('p::1'));
  assert(result.queue.includes('p::2'));
  assert(result.queue.includes('p::5'));
  eq(result.stats.target, 3);
  eq(result.stats.due, 3);
});

/* ============== ExamStats（纯函数，不碰 storage） ============== */
console.log('\nExamStats（纯函数，不需 storage）');

test('countByStatus 按 entry.status 分组，无 entry 算 new', () => {
  const allGids = ['a', 'b', 'c', 'd', 'e'];
  const progressMap = {
    a: { status: 'learning', nextReviewAt: '2026-09-15T00:00:00Z' },
    b: { status: 'review', nextReviewAt: '2026-09-16T00:00:00Z' },
    c: { status: 'mastered' },
    // d、e 无 entry
  };
  const nowIso = '2026-09-15T12:00:00Z';
  const s = Stats.countByStatus(allGids, progressMap, nowIso);
  eq(s.total, 5);
  eq(s.new, 2);
  eq(s.learning, 1);
  eq(s.review, 1);
  eq(s.mastered, 1);
});

test('buildDashboard 聚合正确', () => {
  const allGids = ['a', 'b', 'c'];
  const progressMap = {
    a: { status: 'learning', attempts: 1, lastReviewedAt: new Date().toISOString() },
    b: { status: 'mastered', masteredAt: '2026-09-14T10:00:00Z' },
  };
  const wb = [
    { gid: 'a', status: 'learning' },
    { gid: 'c', status: 'new' },
  ];
  const d = Stats.buildDashboard({ allGids, progressMap, wrongbookEntries: wb });
  eq(d.total, 3);
  eq(d.learned, 2);
  eq(d.mastered, 1);
  eq(d.wrongTotal, 2);
  eq(d.wrongByStatus.learning, 1);
  eq(d.wrongByStatus.new, 1);
  eq(d.weekTrend.length, 7); // 默认 7 天
  // 状态四分类互斥：待复习 = learning + review，不能叠加 due（重叠维度）
  eq(d.weak, 1);
  eq(d.weak, d.learned - d.mastered);
  assert(d.weak <= d.total, 'weak 不应超过题库总数');
});

test('_dayKey 按本地日历日归桶，不按 UTC 日界', () => {
  const now = new Date();
  const today = Stats._todayKey();
  eq(Stats._dayKey(now), today);
  // 本地今天 00:30 —— UTC 口径会掉到前一天（东八区 00:00–07:59 全部记错）
  const earlyMorning = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 30, 0);
  eq(Stats._dayKey(earlyMorning), today);
  // 本地昨天 23:30 必须仍算昨天
  const lateNight = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 30, 0);
  const keys = Stats._pastDayKeys(2);
  eq(Stats._dayKey(lateNight), keys[0]);
  eq(Stats._dayKey(earlyMorning), keys[1]);
  // ISO 字符串入参与 Date 入参等价（往返同一时刻，本地日不变）
  eq(Stats._dayKey(earlyMorning.toISOString()), today);
  eq(Stats._dayKey(null), '');
  eq(Stats._dayKey('not-a-date'), '');
});

test('computeWeekTrend 返回指定天数的桶', () => {
  // 时间戳必须相对 now 生成：写死日期会让这条断言只在它生日那天能通过
  const isoDaysAgo = n => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString();
  };
  const p = {
    a: { lastReviewedAt: isoDaysAgo(0), masteredAt: isoDaysAgo(0), wrong: 1 },
    b: { lastReviewedAt: isoDaysAgo(5) },
  };
  const trend = Stats.computeWeekTrend(p, 7);
  eq(trend.length, 7);
  const today = Stats._todayKey();
  const todayBucket = trend.find(b => b.day === today);
  assert(todayBucket != null);
  eq(todayBucket.reviewed, 1);
  eq(todayBucket.mastered, 1);
  eq(todayBucket.wrong, 1);
  eq(trend[trend.length - 1].day, today);              // 最后一个桶是今天
  eq(trend.reduce((s, d) => s + d.reviewed, 0), 2);    // 5 天前那条也在 7 天窗口内
  eq(Stats.computeWeekTrend(p, 3).reduce((s, d) => s + d.reviewed, 0), 1); // 窗口收窄后掉出
});

/* ============== 错题本 v2 状态机 ============== */
const _sampleItem = () => ({ paperId: 'p1', id: '1', rawType: 'single_choice', typeLabel: '单选', question: 'Q', answer: 'A', options: [{ key: 'A', val: 'a' }, { key: 'B', val: 'b' }] });
const _sampleItem2 = () => ({ paperId: 'p1', id: '2', rawType: 'true_false', typeLabel: '判断', question: 'Q2', answer: true });

test('ExamWrongbook v2：新条目自带 gid 和全部 v2 字段', () => {
  Store.clearWrongbook();
  Wrongbook.add(_sampleItem(), 'exercise', null, false);
  const e = Wrongbook.list()[0];
  ok(e.gid); eq(e.gid, 'p1::1');
  ok(e.firstWrongAt); ok(e.lastWrongAt);
  eq(e.wrongCount, 1); eq(e.status, 'new');
  eq(e.correctStreak, 0); eq(e.lastRightAt, null);
});

test('ExamWrongbook v2：同题重复 add → wrongCount++ + streak 归零', () => {
  Store.clearWrongbook();
  Wrongbook.add(_sampleItem(), 'practice', null, false);
  Wrongbook.add(_sampleItem(), 'exercise', null, false);
  const e = Wrongbook.list()[0];
  eq(e.wrongCount, 2); eq(e.source, 'exercise'); eq(e.status, 'new');
});

test('ExamWrongbook v2：markCorrect 连续 1 次 → new 或 learning（看 wrongCount）', () => {
  Store.clearWrongbook();
  Wrongbook.add(_sampleItem(), 'exam', null, false);
  let r = Wrongbook.markCorrect(Wrongbook.list()[0]);
  eq(r.removed, false); eq(r.entry.status, 'new');

  Wrongbook.add(_sampleItem(), 'exam', null, false); // wrongCount=2
  Wrongbook.markCorrect(Wrongbook.list()[0]);
  const e = Wrongbook.list()[0];
  eq(e.status, 'learning'); eq(e.correctStreak, 1);
});

test('ExamWrongbook v2：markCorrect 连续 2 次 → status=weak', () => {
  Store.clearWrongbook();
  Wrongbook.add(_sampleItem(), 'exam', null, false);
  Wrongbook.add(_sampleItem(), 'exam', null, false);
  Wrongbook.markCorrect(Wrongbook.list()[0]);
  const r2 = Wrongbook.markCorrect(Wrongbook.list()[0]);
  eq(r2.removed, false); eq(r2.entry.status, 'weak'); eq(r2.entry.correctStreak, 2);
});

test('ExamWrongbook v2：markCorrect 连续 3 次 → mastered + 自动移出', () => {
  Store.clearWrongbook();
  Wrongbook.add(_sampleItem(), 'exam', null, false);
  Wrongbook.markCorrect(Wrongbook.list()[0]);
  Wrongbook.markCorrect(Wrongbook.list()[0]);
  const r3 = Wrongbook.markCorrect(Wrongbook.list()[0]);
  eq(r3.removed, true); eq(r3.entry.status, 'mastered');
  eq(Wrongbook.list().length, 0);
});

test('ExamWrongbook v2：任何时候 markWrong → streak 归零 + status=new', () => {
  Store.clearWrongbook();
  Wrongbook.add(_sampleItem(), 'exam', null, false);
  Wrongbook.markCorrect(Wrongbook.list()[0]);
  Wrongbook.markCorrect(Wrongbook.list()[0]);
  Wrongbook.markWrong(Wrongbook.list()[0]);
  const e = Wrongbook.list()[0];
  eq(e.status, 'new'); eq(e.correctStreak, 0);
});

test('ExamWrongbook v2：markWrong 归零后还能再升到 mastered', () => {
  Store.clearWrongbook();
  Wrongbook.add(_sampleItem(), 'exam', null, false);
  Wrongbook.markCorrect(Wrongbook.list()[0]);
  Wrongbook.markCorrect(Wrongbook.list()[0]);
  Wrongbook.markWrong(Wrongbook.list()[0]);
  Wrongbook.markCorrect(Wrongbook.list()[0]);
  Wrongbook.markCorrect(Wrongbook.list()[0]);
  const r = Wrongbook.markCorrect(Wrongbook.list()[0]);
  eq(r.removed, true); eq(Wrongbook.list().length, 0);
});

test('ExamWrongbook v2：countByStatus 正确分组', () => {
  Store.clearWrongbook();
  Wrongbook.add(_sampleItem(), 'exam', null, false);
  Wrongbook.add(_sampleItem2(), 'practice', null, false);
  Wrongbook.markCorrect(Wrongbook.list()[1]);
  const d = Wrongbook.countByStatus();
  eq(d.new, 2); eq(d.learning, 0); eq(d.weak, 0); eq(d.mastered, 0);
});

test('ExamWrongbook v2：v1 entry 自动补 v2 字段（向后兼容）', () => {
  Store.clearWrongbook();
  Store.writeWrongbook({ version: 1, entries: [{
    id: 'old1', source: 'practice', item: _sampleItem(),
    userAnswer: 'B', correct: false, addedAt: '2026-09-01T00:00:00Z'
  }]});
  const list = Wrongbook.list();
  eq(list.length, 1); ok(list[0].gid);
  eq(list[0].status, 'new'); eq(list[0].wrongCount, 1);
});

test('ExamWrongbook v2：gid 判重优先（多卷同 id 不冲突）', () => {
  Store.clearWrongbook();
  const a = { paperId: '卷1', id: '1', rawType: 'single_choice', typeLabel: '单选', question: 'Q', answer: 'A', options: [{ key: 'A', val: 'a' }] };
  const b = { paperId: '卷2', id: '1', rawType: 'single_choice', typeLabel: '单选', question: 'Q', answer: 'A', options: [{ key: 'A', val: 'a' }] };
  Wrongbook.add(a, 'exam', null, false);
  Wrongbook.add(b, 'exam', null, false);
  eq(Wrongbook.list().length, 2);
});

/* —— ExamLeitner v2：持久化队列 + buildQueueFromProgress —— */
test('ExamLeitner v2：persistQueue / restoreQueue / clearQueue 基本流程', () => {
  resetStorage();
  const Leitor = global.ExamLeitner;
  const gids = ['卷1::1', '卷1::2', '卷1::3'];
  Leitor.persistQueue(gids, 'session-study-1');
  const r = Leitor.restoreQueue('session-study-1');
  eq(!!r, true);
  eq(r.gids.join(','), '卷1::1,卷1::2,卷1::3');
  eq(!!r.savedAt, true);

  Leitor.clearQueue('session-study-1');
  eq(Leitor.restoreQueue('session-study-1'), null);
});

test('ExamLeitner v2：persistQueue 空 gids 不写入', () => {
  resetStorage();
  const Leitor = global.ExamLeitner;
  Leitor.persistQueue([], 'empty');
  eq(Leitor.restoreQueue('empty'), null);
});

test('ExamLeitner v2：buildQueueFromProgress strategy=sequential 保持原序', () => {
  const Leitor = global.ExamLeitner;
  const gids = ['A', 'B', 'C'];
  const r = Leitor.buildQueueFromProgress(gids, 'sequential', {}, []);
  eq(r.join(','), 'A,B,C');
});

test('ExamLeitner v2：buildQueueFromProgress strategy=due 到期题排最前', () => {
  const Leitor = global.ExamLeitner;
  // A=新题, B=到期复习, C=已掌握, D=未到期未掌握
  const all = ['A', 'B', 'C', 'D'];
  const progressMap = {
    B: { status: 'learning', nextReviewAt: '2024-01-01T00:00:00.000Z' },
    C: { status: 'mastered' },
    D: { status: 'learning', nextReviewAt: '2099-01-01T00:00:00.000Z' }
  };
  // 到期 Set：B（明确到期）+ A（从未见过=新题=也算到期）
  const dueGids = ['A', 'B'];
  const r = Leitor.buildQueueFromProgress(all, 'due', progressMap, dueGids);
  // 期望：A/B 在前，D 在中，C 在最后
  eq(r.indexOf('A') < r.indexOf('D'), true, '新题应在未到期未掌握之前');
  eq(r.indexOf('B') < r.indexOf('D'), true, '到期题应在未到期未掌握之前');
  eq(r.indexOf('C'), 3, '已掌握应在最后');
});

test('ExamLeitner v2：旧 API 零破坏（createQueue/markPass/markFail 签名不变）', () => {
  const Leitor = global.ExamLeitner;
  const items = [{ gid: 'a' }, { gid: 'b' }, { gid: 'c' }];
  const q = Leitor.createQueue(items);
  eq(q.length, 3);
  eq(q[0].it.gid, 'a');
  eq(q[0].streak, 0);
  const r = Leitor.markPass(q);
  eq(r.mastered, true);
  eq(q.length, 2);
  const q2 = Leitor.createQueue(items);
  Leitor.markFail(q2);
  eq(q2.length, 3); // 答错后重新插入
});

/* ============== 结果 ============== */
console.log(`\n${'─'.repeat(46)}`);
if (failed === 0) {
  console.log(`✓ 全部通过：${passed} 项`);
  process.exit(0);
} else {
  console.log(`✗ 通过 ${passed} 项，失败 ${failed} 项：`);
  failures.forEach(f => console.log(`  - ${f.name}: ${f.message}`));
  process.exit(1);
}
