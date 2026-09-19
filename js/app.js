/**
 * MemoDeck · Vue 应用逻辑
 * 依赖：vendor/vue.global.prod.js（全局 Vue）、ExamCore / ExamStore / ExamLeitner / ExamWrongbook / ExamAIPrompt
 * 挂载：index.html 中的 #app（in-DOM template）
 */
(function (global) {
  'use strict';

  const { createApp, ref, reactive, computed, nextTick, onMounted, onBeforeUnmount } = global.Vue;
  const Core = global.ExamCore;
  const Store = global.ExamStore;
  const Leitner = global.ExamLeitner;
  const Wrongbook = global.ExamWrongbook;
  const AIPrompt = global.ExamAIPrompt;
  const Utils = global.ExamUtils;
  // —— 阶段 0 新增模块 ——
  const Migration = global.ExamMigration;
  const Progress = global.ExamProgress;
  const Session = global.ExamSession;
  const Stats = global.ExamStats;

  // 运行配置见 config.js（defaultRemoteUrl / jsonManagerUrl 均可外部覆盖）
  const CFG = global.EXAM_CONFIG || {};
  const DEFAULT_REMOTE_URL = CFG.defaultRemoteUrl || './data.json';
  const JSON_MANAGER_URL = CFG.jsonManagerUrl || ''; // 留空则隐藏「JSON 管理服务」入口

  const app = createApp({
    setup() {
      /* ============ 基础 / 数据源 ============ */
      const activeTab = ref('home');               // 阶段 1：默认首页；其余：practice | exam | category | wrongbook
      const sourceMeta = ref({ label: '加载中…', cls: 'default', url: '', detail: '' });
      const currentBank = ref({ meta: {}, features: {}, papers: [] });
      const currentPaperId = ref('');
      const bank = ref([]);                          // 题目条目数组
      const dataError = ref('');
      const remoteUrl = ref('');
      const pasteText = ref('');
      const managerUrl = ref(JSON_MANAGER_URL);
      const showDataPanel = ref(localStorage.getItem('memo:showDataPanel') !== '0');
      const confirmClearAll = ref(false); // 备份区二次确认
      const dataBusy = ref(false);
      const dragActive = ref(false);
      const toastMsg = ref('');
      const toastOk = ref(true);
      let toastTimer = null;

      /* ============ 主题 ============ */
      // 'auto' | 'light' | 'dark'
      const themeMode = ref(localStorage.getItem('memo:theme') || 'auto');
      function applyTheme() {
        var mode = themeMode.value;
        if (mode === 'auto') {
          document.documentElement.removeAttribute('data-theme');
        } else {
          document.documentElement.setAttribute('data-theme', mode);
        }
        localStorage.setItem('memo:theme', mode);
      }
      // 初始化立即应用
      applyTheme();
      // 跟随系统偏好变化（auto 模式下实时切换）
      if (window.matchMedia) {
        var mql = window.matchMedia('(prefers-color-scheme: dark)');
        mql.addEventListener && mql.addEventListener('change', function () {
          if (themeMode.value === 'auto') applyTheme();
        });
      }

      /* ============ 阶段 0 新增：学习状态 & 统计 ============ */
      // 刷新信号：每次 bump 让 dashboard/dailyTask 重新计算
      const progressTick = ref(0);
      function refreshProgress() { progressTick.value++; }

      // 题库稳定标识：恢复点按它归属，切库后旧恢复点不再冒出来
      function bankIdOf() {
        const m = currentBank.value.meta;
        return m && m.title ? String(m.title) : '';
      }

      /* —— watchers：面板/主题状态持久化 —— */
      Vue.watch(showDataPanel, function (v) { localStorage.setItem('memo:showDataPanel', v ? '1' : '0'); });
      Vue.watch(themeMode, function () { applyTheme(); });

      /* ============ 记忆闯关 ============ */
      const practiceQueue = ref([]);
      const practiceShowAnswer = ref(false);

      /* ============ 摸底速览 ============ */
      const previewRevealed = reactive({});

      /* ============ 分类考试 ============ */
      const catStage = ref('setup');                 // setup | test | done
      const catSelected = ref([]);                   // 选中的 rawType
      const catPool = ref([]);
      const catIndex = ref(0);
      const catInput = ref('');
      const catChoice = ref(null);
      const catMultiSel = ref([]);
      const catRevealed = ref(false);
      const catFeedback = ref(null);                 // { correct }
      const catFillInput = ref(null);                // 填空题多空答案输入框元素（插入分隔符用）
      const catStats = reactive({ total: 0, right: 0, wrong: 0 });
      const catFromWrongbook = ref(false); // 当前考试是否来自错题本（答对自动移除错题）
      const catSnapshots = ref({});        // 每题作答快照：{ index: {input,choice,multiSel,revealed,feedback} }
      const catStartTime = ref(0);         // 考试开始时间戳
      const catElapsed = ref('');          // 考试用时文本
      let autoNextTimer = null;            // 答对自动进下一题的定时器
      const catWrongItems = ref([]);
      const catError = ref('');
      const showCustomForm = ref(false);
      const customForm = reactive({ question: '', type: 'single_choice', options: '', answer: '' });

      /* ============ 错题本 ============ */
      const wrongEntries = ref([]);
      const wrongTab = ref('practice');              // practice | preview | exam | all
      const wrongPracticeQueue = ref([]);
      const wrongPracticeShow = ref(false);

      /* ============ 阶段 2：学习/背诵模式 ============ */
      // 状态机：setup → running → summary
      const studyMode = ref('setup');

      // setup 配置
      const studyScope = ref('today');               // today | unmastered | all | wrongbook | custom
      const studyCustomStart = ref(1);
      const studyCustomEnd = ref(0);                 // 0 表示自动填充总题数
      const studyStrategy = ref('due');              // due | sequential | random
      const studyPerSession = ref(30);
      const studyPerSessionCustom = ref(20);         // 自定义数量
      const studyTypes = ref({ single_choice: true, multi_choice: true, true_false: true, fill_blank: true, special_fill_blank: true, essay: false });

      // running 状态
      const studyQueueGids = ref([]);
      const studyIndex = ref(0);
      const studyShowAnswer = ref(false);
      const studyStartAt = ref(0);
      const studyPassCount = ref(0);
      const studyFailCount = ref(0);
      const studyNewMastered = ref(0);
      const studyNewWrong = ref(0);
      const studyMaxStreak = ref(0);

      // 手势状态
      const studySwipeX = ref(0);                    // 当前卡片的水平位移 px
      const studySwipeActive = ref(false);
      let studySwipeStartX = 0;
      let studySwipeStartY = 0;
      const studySwipeAxis = { locked: false, horizontal: false };
      const STUDY_SWIPE_THRESHOLD = 120;             // 触发阈值 px

      // summary 统计
      const studyElapsedSec = ref(0);
      let studyTimer = null;

      // computed：当前题目 item
      const studyCurrentItem = computed(() => {
        const gid = studyQueueGids.value[studyIndex.value];
        if (!gid) return null;
        return bank.value.find(it => it.gid === gid) || null;
      });
      const studyNextItem = computed(() => {
        const gid = studyQueueGids.value[studyIndex.value + 1];
        if (!gid) return null;
        return bank.value.find(it => it.gid === gid) || null;
      });
      const studyTotal = computed(() => studyQueueGids.value.length);
      const studyProgressPct = computed(() => {
        if (!studyTotal.value) return 0;
        return Math.round((studyIndex.value / studyTotal.value) * 100);
      });
      const studyCurrentProgress = computed(() => {
        if (!studyTotal.value) return '0/0';
        return (studyIndex.value + 1) + '/' + studyTotal.value;
      });
      // 当前题的学习历史（小字 hint）
      const studyPrevHint = computed(() => {
        const gid = studyCurrentItem.value && studyCurrentItem.value.gid;
        if (!gid) return '';
        const e = Progress.get(gid);
        if (!e) return '之前：未学过';
        const parts = [];
        if (e.attempts > 0) parts.push('学过 ' + e.attempts + ' 次');
        if (e.status === 'mastered') parts.push('已掌握');
        else if (e.status === 'review') parts.push('需复习');
        else if (e.wrong > 0) parts.push('上次答错');
        parts.push('streak ' + e.streak);
        return '之前：' + parts.join(' · ');
      });
      // setup 时实时计算各范围的题数
      const studyScopeCounts = computed(() => {
        const gids = bankGids.value;
        const pm = progressMap.value;
        const out = {};
        out.all = gids.length;
        out.today = Progress.getDueQuestions(gids).length;
        out.unmastered = gids.filter(g => {
          const e = pm[g]; return !e || e.status !== 'mastered';
        }).length;
        out.wrongbook = wrongEntries.value.length;
        // custom 数量需要在选 custom 时动态算
        return out;
      });
      const studyCustomCount = computed(() => {
        const start = Math.max(1, studyCustomStart.value || 1);
        const end = studyCustomEnd.value > 0 ? studyCustomEnd.value : bank.value.length;
        const s = Math.min(start, end), e = Math.max(start, end);
        // 过滤题型
        const typesSelected = Object.values(studyTypes.value).some(Boolean);
        let count = 0;
        for (let i = s - 1; i < Math.min(e, bank.value.length); i++) {
          const t = bank.value[i].rawType;
          if (!typesSelected || studyTypes.value[t]) count++;
        }
        return count;
      });
      const studyAvailableCount = computed(() => {
        if (studyScope.value === 'custom') return studyCustomCount.value;
        return (studyScopeCounts.value[studyScope.value] !== undefined) ? studyScopeCounts.value[studyScope.value] : studyScopeCounts.value.all;
      });
      const studyBadgeCount = computed(() => {
        if (studyScope.value === 'custom') return studyCustomCount.value;
        const c = studyScopeCounts.value;
        return c[studyScope.value] !== undefined ? c[studyScope.value] : c.all;
      });

      // ====== setup → running ======
      function studyStart() {
        if (!studyAvailableCount.value) { toast('当前条件下没有可学习的题目', false); return; }
        const all = bankGids.value;
        let scopeGids = all.slice();

        // 1. 按 scope 切
        if (studyScope.value === 'unmastered') {
          const pm = Progress.getAll();
          scopeGids = all.filter(g => {
            const e = pm[g]; return !e || e.status !== 'mastered';
          });
        } else if (studyScope.value === 'wrongbook') {
          const wg = new Set(wrongEntries.value.map(e => e.item && e.item.gid).filter(Boolean));
          scopeGids = all.filter(g => wg.has(g));
        } else if (studyScope.value === 'custom') {
          const start = Math.max(1, studyCustomStart.value || 1);
          const end = Math.min(bank.value.length, studyCustomEnd.value > 0 ? studyCustomEnd.value : bank.value.length);
          scopeGids = all.slice(start - 1, end);
          // 再按题型过滤
          const ts = studyTypes.value;
          const hasType = Object.values(ts).some(Boolean);
          if (hasType) {
            scopeGids = scopeGids.filter(g => {
              const it = bank.value.find(b => b.gid === g);
              return it && ts[it.rawType];
            });
          }
        } else if (studyScope.value === 'today') {
          scopeGids = Progress.getDueQuestions(all);
        }

        // 2. 按 strategy 排
        let queueGids;
        if (studyStrategy.value === 'sequential') {
          queueGids = scopeGids.slice();
        } else if (studyStrategy.value === 'random') {
          queueGids = scopeGids.slice();
          for (let i = queueGids.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [queueGids[i], queueGids[j]] = [queueGids[j], queueGids[i]];
          }
        } else {
          // due 优先：Session.generateDailyTask
          const perSession = studyPerSession.value === 'custom'
            ? studyPerSessionCustom.value
            : Number(studyPerSession.value) || 30;
          const r = Session.generateDailyTask(all, perSession, scopeGids);
          queueGids = r.queue;
        }

        if (!queueGids.length) { toast('队列生成为空，请换范围', false); return; }

        // 3. 启动
        studyQueueGids.value = queueGids;
        studyIndex.value = 0;
        studyShowAnswer.value = false;
        studyStartAt.value = Date.now();
        studyPassCount.value = 0;
        studyFailCount.value = 0;
        studyNewMastered.value = 0;
        studyNewWrong.value = 0;
        studyMaxStreak.value = 0;
        studyMode.value = 'running';

        // 保存恢复点
        Session.saveResumePoint({
          bankId: bankIdOf(),
          paperId: currentPaperId.value,
          mode: 'study',
          queueGids: queueGids,
          currentIndex: 0,
          segment: { scope: studyScope.value, start: studyCustomStart.value, end: studyCustomEnd.value }
        });

        // 计时器
        studyElapsedSec.value = 0;
        if (studyTimer) clearInterval(studyTimer);
        studyTimer = setInterval(() => {
          studyElapsedSec.value = Math.floor((Date.now() - studyStartAt.value) / 1000);
        }, 1000);
      }

      function studyResume() {
        const rp = Session.loadResumePoint(bankIdOf(), 'study');
        if (!rp) return;
        studyQueueGids.value = rp.queueGids || [];
        studyIndex.value = rp.currentIndex || 0;
        studyShowAnswer.value = false;
        // 恢复设置（尽量还原）
        const seg = rp.segment || {};
        if (seg.scope) studyScope.value = seg.scope;
        if (seg.start) studyCustomStart.value = seg.start;
        if (seg.end) studyCustomEnd.value = seg.end;
        // running 统计重置（恢复点只存位置不存统计）
        studyPassCount.value = 0;
        studyFailCount.value = 0;
        studyNewMastered.value = 0;
        studyNewWrong.value = 0;
        studyMaxStreak.value = 0;
        studyStartAt.value = Date.now();
        studyMode.value = 'running';
        studyElapsedSec.value = 0;
        if (studyTimer) clearInterval(studyTimer);
        studyTimer = setInterval(() => {
          studyElapsedSec.value = Math.floor((Date.now() - studyStartAt.value) / 1000);
        }, 1000);
      }

      function studyAbandonResume() {
        // 放弃上次 → 保持 setup 模式，等用户重新开始
        toast('已放弃上次进度，重新设置');
      }

      // ====== running：mark + next ======
      function studyMark(remembered) {
        const item = studyCurrentItem.value;
        if (!item || !item.gid) return;
        const prev = Progress.get(item.gid);
        const prevStatus = prev ? prev.status : 'new';

        if (remembered) {
          const e = Progress.markPass(item.gid);
          studyPassCount.value++;
          if (e && e.streak > studyMaxStreak.value) studyMaxStreak.value = e.streak;
          if (prevStatus !== 'mastered' && e && e.status === 'mastered') studyNewMastered.value++;
        } else {
          Progress.markFail(item.gid);
          studyFailCount.value++;
          Wrongbook.add(item, 'study', null, false);
          studyNewWrong.value++;
          loadWrongbook();
        }
        refreshProgress();

        // 自动下一题
        studyNext();
      }

      function studyNext() {
        studyShowAnswer.value = false;
        if (studyIndex.value + 1 >= studyQueueGids.value.length) {
          studyFinish();
        } else {
          studyIndex.value++;
          studySwipeX.value = 0;
          // 位置必须写回恢复点，否则「继续上次」永远从第 1 题重来
          Session.touchResumePoint(studyIndex.value);
        }
      }

      function studyFinish() {
        studyMode.value = 'summary';
        if (studyTimer) { clearInterval(studyTimer); studyTimer = null; }
        Session.clearResumePoint('study');
        refreshProgress();
      }

      function studyExit() {
        // 主动退出 running → 暂停，恢复点已在 saveResumePoint/touchResumePoint 里
        if (studyMode.value === 'running') {
          toast('已暂停，下次打开可继续', true);
          if (studyTimer) { clearInterval(studyTimer); studyTimer = null; }
          studyMode.value = 'setup';
          switchTab('home');
          setTimeout(() => switchTab('study'), 50);
        } else {
          studyMode.value = 'setup';
        }
      }

      function studyRestart() {
        studyMode.value = 'setup';
        studySwipeX.value = 0;
        studyShowAnswer.value = false;
        if (studyTimer) { clearInterval(studyTimer); studyTimer = null; }
        Session.clearResumePoint('study');
      }

      // ====== 手势：移动端左右滑动 ======
      // 首个超出死区的位移一次性定轴：判为纵向就返回 null 并交还浏览器滚动，
      // 之后本次触摸不再改判——否则斜着拖会在「滑卡」和「滚页」之间反复横跳。
      const SWIPE_AXIS_DEADZONE = 8;
      function swipeAxisDx(axis, dx, dy) {
        if (!axis.locked) {
          if (Math.abs(dx) < SWIPE_AXIS_DEADZONE && Math.abs(dy) < SWIPE_AXIS_DEADZONE) return null;
          axis.locked = true;
          axis.horizontal = Math.abs(dx) > Math.abs(dy);
        }
        return axis.horizontal ? dx : null;
      }

      function studyOnSwipeStart(e) {
        if (studyMode.value !== 'running') return;
        if (!studyShowAnswer.value) return; // 必须先看答案才能滑动
        const pt = e.touches ? e.touches[0] : e;
        studySwipeStartX = pt.clientX;
        studySwipeStartY = pt.clientY;
        studySwipeX.value = 0;
        studySwipeAxis.locked = false;
        studySwipeAxis.horizontal = false;
        studySwipeActive.value = true;
      }
      function studyOnSwipeMove(e) {
        if (!studySwipeActive.value) return;
        const pt = e.touches ? e.touches[0] : e;
        const dx = swipeAxisDx(studySwipeAxis, pt.clientX - studySwipeStartX, pt.clientY - studySwipeStartY);
        if (dx === null) return;
        studySwipeX.value = dx;
        if (e.cancelable) e.preventDefault();
      }
      function studyOnSwipeEnd() {
        if (!studySwipeActive.value) return;
        studySwipeActive.value = false;
        const x = studySwipeX.value;
        if (x >= STUDY_SWIPE_THRESHOLD) {
          // 右滑 → 记住了 ✅
          studyMark(true);
        } else if (x <= -STUDY_SWIPE_THRESHOLD) {
          // 左滑 → 还不会 🤦
          studyMark(false);
        } else {
          // 阈值不够，弹回
          studySwipeX.value = 0;
        }
      }

      // 桌面端也支持：点击"记住了/还不会"按钮 或 键盘 1/2 或 ←/→
      function studyKeyDown(e) {
        if (activeTab.value !== 'study') return;
        if (studyMode.value !== 'running') return;
        if (e.key === ' ' || e.key === 'Enter') {
          if (!studyShowAnswer.value) { studyShowAnswer.value = true; e.preventDefault(); }
        } else if (studyShowAnswer.value) {
          if (e.key === 'ArrowLeft' || e.key === '1') { studyMark(false); e.preventDefault(); }
          else if (e.key === 'ArrowRight' || e.key === '2') { studyMark(true); e.preventDefault(); }
        }
      }

      // 格式化时长
      function studyFormatDuration(sec) {
        sec = sec || 0;
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        if (m >= 60) {
          const h = Math.floor(m / 60);
          return h + 'h ' + (m % 60) + 'm';
        }
        return m + '分 ' + (s < 10 ? '0' : '') + s + 's';
      }

      // ====== setup 自动填充 custom end ======
      function studyAutoFillCustomEnd() {
        if (!studyCustomEnd.value || studyCustomEnd.value <= 0) {
          studyCustomEnd.value = bank.value.length || 500;
        }
      }

      /* ============ 阶段 3：练习模式（独立于学习/记忆闯关） ============ */
      // 核心差异：练习 = 自己作答 → 系统自动判分 → 看答案 → 下一题
      // 与学习/记忆闯关的区别：有"提交答案"步骤，客观题系统判分，主观题看答案后自评
      const exerciseMode = ref('setup');

      // setup 配置（复用 study 的范围逻辑，独立 ref 避免串状态）
      const exerciseScope = ref('all');
      const exerciseCustomStart = ref(1);
      const exerciseCustomEnd = ref(0);
      const exerciseStrategy = ref('random');    // 练习默认随机洗牌
      const exercisePerSession = ref('all');
      const exercisePerSessionCustom = ref(30);
      const exerciseTypes = ref({ single_choice: true, multi_choice: true, true_false: true, fill_blank: true, special_fill_blank: true, essay: true });

      // running 状态
      const exerciseQueueGids = ref([]);
      const exerciseIndex = ref(0);
      const exerciseStartAt = ref(0);
      let exerciseTimer = null;

      // 每题作答
      const exerciseAnswerSubmitted = ref(false);
      const exerciseChoice = ref(null);       // 单选/判断
      const exerciseMultiSel = ref([]);       // 多选
      const exerciseInput = ref('');          // 填空/简答

      // 每题判分结果
      const exerciseFeedback = ref(null);     // { correct: true/false, reveal: true }
      const exerciseStudentAnswer = ref('');  // 渲染"你的答案"（主观题或填空）

      // summary 统计
      const exercisePassCount = ref(0);
      const exerciseFailCount = ref(0);
      const exerciseNewWrong = ref(0);
      const exerciseNewMastered = ref(0);
      const exerciseElapsedSec = ref(0);

      // 手势
      const exerciseSwipeX = ref(0);
      const exerciseSwipeActive = ref(false);
      const exerciseSwipeAxis = { locked: false, horizontal: false };
      let exerciseSwipeStartX = 0, exerciseSwipeStartY = 0;

      // computed
      const exerciseCurrentItem = computed(() => {
        const gid = exerciseQueueGids.value[exerciseIndex.value];
        if (!gid) return null;
        return bank.value.find(it => it.gid === gid) || null;
      });
      const exerciseNextItem = computed(() => {
        const gid = exerciseQueueGids.value[exerciseIndex.value + 1];
        if (!gid) return null;
        return bank.value.find(it => it.gid === gid) || null;
      });
      const exerciseTotal = computed(() => exerciseQueueGids.value.length);
      const exerciseProgressPct = computed(() => {
        if (!exerciseTotal.value) return 0;
        return Math.round((exerciseIndex.value / exerciseTotal.value) * 100);
      });
      const exerciseCurrentProgress = computed(() => {
        if (!exerciseTotal.value) return '0/0';
        return (exerciseIndex.value + 1) + '/' + exerciseTotal.value;
      });
      const exercisePrevHint = computed(() => {
        const gid = exerciseCurrentItem.value && exerciseCurrentItem.value.gid;
        if (!gid) return '';
        const e = Progress.get(gid);
        if (!e) return '之前：未学过';
        const parts = [];
        if (e.attempts > 0) parts.push('学过 ' + e.attempts + ' 次');
        if (e.status === 'mastered') parts.push('已掌握');
        else if (e.wrong > 0) parts.push('上次答错');
        return '之前：' + parts.join(' · ');
      });
      const exerciseBadgeCount = computed(() => {
        const all = bankGids.value;
        let scopeGids = all.slice();
        if (exerciseScope.value === 'unmastered') {
          const pm = Progress.getAll();
          scopeGids = all.filter(g => { const e = pm[g]; return !e || e.status !== 'mastered'; });
        } else if (exerciseScope.value === 'wrongbook') {
          const wg = new Set(wrongEntries.value.map(e => e.item && e.item.gid).filter(Boolean));
          scopeGids = all.filter(g => wg.has(g));
        } else if (exerciseScope.value === 'custom') {
          const s = Math.max(1, exerciseCustomStart.value || 1);
          const e = Math.min(bank.value.length, exerciseCustomEnd.value > 0 ? exerciseCustomEnd.value : bank.value.length);
          scopeGids = all.slice(s - 1, e);
          const ts = exerciseTypes.value;
          const hasType = Object.values(ts).some(Boolean);
          if (hasType) scopeGids = scopeGids.filter(g => {
            const it = bank.value.find(b => b.gid === g); return it && ts[it.rawType];
          });
        }
        return scopeGids.length;
      });

      // 判分核心（纯函数，不读写任何 ref）——学习/练习/模拟考试/分类考试共用这一份
      // 未作答必须先判错：否则判断题 answer=false 时 (null==='true')===false 会白送一分
      function judgeObjective(cur, choice, multiSel) {
        if (!cur || !isObjective(cur.rawType)) return false;
        if (cur.rawType === 'true_false') {
          if (choice !== 'true' && choice !== 'false') return false;
          return (choice === 'true') === !!cur.answer;
        }
        if (cur.rawType === 'single_choice') {
          if (!choice) return false;
          return choice === cur.answer;
        }
        const sel = Array.isArray(multiSel) ? multiSel : [];
        if (!sel.length) return false;
        const std = (Array.isArray(cur.answer) ? cur.answer : []).slice().sort().join(',');
        return sel.slice().sort().join(',') === std;
      }

      function resetExerciseAnswer() {
        exerciseChoice.value = null;
        exerciseMultiSel.value = [];
        exerciseInput.value = '';
        exerciseAnswerSubmitted.value = false;
        exerciseFeedback.value = null;
        exerciseStudentAnswer.value = '';
      }

      // ====== setup → running ======
      function exerciseStart() {
        if (!exerciseBadgeCount.value) { toast('当前条件下没有可练习的题目', false); return; }
        const all = bankGids.value;
        let scopeGids = all.slice();
        if (exerciseScope.value === 'unmastered') {
          const pm = Progress.getAll();
          scopeGids = all.filter(g => { const e = pm[g]; return !e || e.status !== 'mastered'; });
        } else if (exerciseScope.value === 'wrongbook') {
          const wg = new Set(wrongEntries.value.map(e => e.item && e.item.gid).filter(Boolean));
          scopeGids = all.filter(g => wg.has(g));
        } else if (exerciseScope.value === 'custom') {
          const s = Math.max(1, exerciseCustomStart.value || 1);
          const e = Math.min(bank.value.length, exerciseCustomEnd.value > 0 ? exerciseCustomEnd.value : bank.value.length);
          scopeGids = all.slice(s - 1, e);
          const ts = exerciseTypes.value;
          const hasType = Object.values(ts).some(Boolean);
          if (hasType) scopeGids = scopeGids.filter(g => {
            const it = bank.value.find(b => b.gid === g); return it && ts[it.rawType];
          });
        }

        let queueGids;
        if (exerciseStrategy.value === 'sequential') {
          queueGids = scopeGids.slice();
        } else if (exerciseStrategy.value === 'random') {
          queueGids = scopeGids.slice();
          for (let i = queueGids.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [queueGids[i], queueGids[j]] = [queueGids[j], queueGids[i]];
          }
        } else {
          queueGids = scopeGids.slice();
        }

        let perSession = exercisePerSession.value === 'custom' ? exercisePerSessionCustom.value : exercisePerSession.value;
        if (perSession !== 'all' && Number(perSession) > 0) {
          queueGids = queueGids.slice(0, Number(perSession));
        }

        if (!queueGids.length) { toast('队列为空', false); return; }

        exerciseQueueGids.value = queueGids;
        exerciseIndex.value = 0;
        resetExerciseAnswer();
        exercisePassCount.value = 0;
        exerciseFailCount.value = 0;
        exerciseNewWrong.value = 0;
        exerciseNewMastered.value = 0;
        exerciseStartAt.value = Date.now();
        exerciseElapsedSec.value = 0;
        exerciseMode.value = 'running';

        // 恢复点
        Session.saveResumePoint({ bankId: bankIdOf(), paperId: currentPaperId.value, mode: 'exercise', queueGids: queueGids, currentIndex: 0 });

        if (exerciseTimer) clearInterval(exerciseTimer);
        exerciseTimer = setInterval(() => {
          exerciseElapsedSec.value = Math.floor((Date.now() - exerciseStartAt.value) / 1000);
        }, 1000);
      }

      function exerciseResume() {
        const rp = Session.loadResumePoint(bankIdOf(), 'exercise');
        if (!rp) return;
        exerciseQueueGids.value = rp.queueGids || [];
        exerciseIndex.value = rp.currentIndex || 0;
        resetExerciseAnswer();
        exercisePassCount.value = 0; exerciseFailCount.value = 0;
        exerciseNewWrong.value = 0; exerciseNewMastered.value = 0;
        exerciseStartAt.value = Date.now(); exerciseElapsedSec.value = 0;
        exerciseMode.value = 'running';
        if (exerciseTimer) clearInterval(exerciseTimer);
        exerciseTimer = setInterval(() => {
          exerciseElapsedSec.value = Math.floor((Date.now() - exerciseStartAt.value) / 1000);
        }, 1000);
      }

      function exerciseAbandonResume() { toast('已放弃上次进度'); }

      // ====== running ======
      function exerciseSubmit() {
        const cur = exerciseCurrentItem.value;
        if (!cur || exerciseAnswerSubmitted.value) return;

        if (isObjective(cur.rawType)) {
          // 客观题：系统自动判分
          const correct = judgeObjective(cur, exerciseChoice.value, exerciseMultiSel.value);
          _exerciseRecord(cur, correct, null); // 客观题的"你的答案"直接在 answer-view 里展示
          exerciseFeedback.value = { correct: correct };
        } else {
          // 主观题（填空/简答/特填）：不自动判分，先看答案，用户自评
          exerciseAnswerSubmitted.value = true;
          return;
        }
        exerciseAnswerSubmitted.value = true;
      }

      // 用户对主观题自评（答对/答错）
      function exerciseSelfJudge(correct) {
        const cur = exerciseCurrentItem.value;
        if (!cur || !exerciseAnswerSubmitted.value) return;
        // 主观题先展示标准答案，让用户自己对照自评
        _exerciseRecord(cur, correct, exerciseInput.value);
        exerciseFeedback.value = { correct: correct };
      }

      // 内部：记录结果
      function _exerciseRecord(cur, correct, studentAnswer) {
        const prev = Progress.get(cur.gid);
        const prevStatus = prev ? prev.status : 'new';
        if (correct) {
          const e = Progress.markPass(cur.gid);
          exercisePassCount.value++;
          if (prevStatus !== 'mastered' && e && e.status === 'mastered') exerciseNewMastered.value++;
        } else {
          Progress.markFail(cur.gid);
          exerciseFailCount.value++;
          const added = Wrongbook.add(cur, 'exercise', studentAnswer, false);
          exerciseNewWrong.value++;
          loadWrongbook();
        }
        refreshProgress();
      }

      function exerciseNext() {
        if (exerciseIndex.value + 1 >= exerciseQueueGids.value.length) {
          exerciseFinish();
        } else {
          exerciseIndex.value++;
          resetExerciseAnswer();
          exerciseSwipeX.value = 0;
          Session.touchResumePoint(exerciseIndex.value);
        }
      }

      function exerciseFinish() {
        exerciseMode.value = 'summary';
        if (exerciseTimer) { clearInterval(exerciseTimer); exerciseTimer = null; }
        Session.clearResumePoint('exercise');
        refreshProgress();
      }

      function exerciseExit() {
        if (exerciseMode.value === 'running') {
          toast('已暂停，下次打开可继续', true);
          if (exerciseTimer) { clearInterval(exerciseTimer); exerciseTimer = null; }
          exerciseMode.value = 'setup';
          switchTab('home'); setTimeout(() => switchTab('exercise'), 50);
        } else {
          exerciseMode.value = 'setup';
        }
      }

      function exerciseRestart() {
        exerciseMode.value = 'setup';
        resetExerciseAnswer();
        exerciseSwipeX.value = 0;
        if (exerciseTimer) { clearInterval(exerciseTimer); exerciseTimer = null; }
        Session.clearResumePoint('exercise');
      }

      // 选项 / 多选
      function exerciseOptionClick(val) {
        if (exerciseAnswerSubmitted.value) return;
        const cur = exerciseCurrentItem.value;
        if (!cur) return;
        if (cur.rawType === 'single_choice' || cur.rawType === 'true_false') {
          exerciseChoice.value = val;
        } else if (cur.rawType === 'multi_choice') {
          const idx = exerciseMultiSel.value.indexOf(val);
          if (idx >= 0) exerciseMultiSel.value.splice(idx, 1);
          else exerciseMultiSel.value.push(val);
        }
      }
      function exerciseIsOptionOn(val) {
        return exerciseMultiSel.value.indexOf(val) >= 0;
      }

      // 手势
      function exerciseOnSwipeStart(e) {
        if (exerciseMode.value !== 'running') return;
        if (!exerciseAnswerSubmitted.value) return; // 只有判完分才能滑
        const pt = e.touches ? e.touches[0] : e;
        exerciseSwipeStartX = pt.clientX;
        exerciseSwipeStartY = pt.clientY;
        exerciseSwipeX.value = 0;
        exerciseSwipeAxis.locked = false;
        exerciseSwipeAxis.horizontal = false;
        exerciseSwipeActive.value = true;
      }
      function exerciseOnSwipeMove(e) {
        if (!exerciseSwipeActive.value) return;
        const pt = e.touches ? e.touches[0] : e;
        const dx = swipeAxisDx(exerciseSwipeAxis, pt.clientX - exerciseSwipeStartX, pt.clientY - exerciseSwipeStartY);
        if (dx === null) return;
        exerciseSwipeX.value = dx;
        if (e.cancelable) e.preventDefault();
      }
      function exerciseOnSwipeEnd() {
        if (!exerciseSwipeActive.value) return;
        exerciseSwipeActive.value = false;
        const x = exerciseSwipeX.value;
        if (Math.abs(x) >= 80) { exerciseNext(); }
        else { exerciseSwipeX.value = 0; }
      }

      // 键盘
      function exerciseKeyDown(e) {
        if (activeTab.value !== 'exercise') return;
        if (exerciseMode.value !== 'running') return;
        if (exerciseAnswerSubmitted.value) {
          if (e.key === 'Enter' || e.key === ' ') { exerciseNext(); e.preventDefault(); }
        } else {
          if (e.key === 'Enter') { exerciseSubmit(); e.preventDefault(); }
        }
      }

      function exerciseAutoFillCustomEnd() {
        if (!exerciseCustomEnd.value || exerciseCustomEnd.value <= 0) {
          exerciseCustomEnd.value = bank.value.length || 500;
        }
      }

      /* ============ 阶段 4：考试模式 ============ */
      // 核心差异：过程中不判分不显示答案，可回看改答，结束一次性判分
      const examMode = ref('setup');

      // setup（与 exercise 类似，默认 50 题随机洗牌）
      const examScope = ref('all');
      const examCustomStart = ref(1);
      const examCustomEnd = ref(0);
      const examStrategy = ref('random');
      const examPerSession = ref('50');
      const examPerSessionCustom = ref(100);
      const examTypes = ref({ single_choice: true, multi_choice: true, true_false: true, fill_blank: true, special_fill_blank: true, essay: true });

      // running
      const examQueueGids = ref([]);
      const examIndex = ref(0);
      const examStartAt = ref(0);
      const examElapsedSec = ref(0);
      let examTimer = null;
      // 核心：每题独立存答案（可随时回看改答）
      const examAnswers = reactive({});   // { [gid]: { choice, multiSel, input, answered: bool } }
      const examSubmitted = ref(false);   // 是否已交卷
      const examSheetOpen = ref(false);    // 移动端答题卡折叠开关

      // summary
      const examPassCount = ref(0);
      const examFailCount = ref(0);
      const examWrongItems = ref([]);     // [{ gid, item, userAnswer, isCorrect }]
      const examPendingItems = ref([]);   // 主观题已作答、待自评
      const examBlankItems = ref([]);     // 未作答：不计分、不写 progress、不进错题本

      // 正确率按「已判分」题数算：把待自评和未作答算进分母会系统性压低分数
      const examGradedCount = computed(() => examPassCount.value + examFailCount.value);
      const examScorePct = computed(() => {
        if (!examGradedCount.value) return 0;
        return Math.round((examPassCount.value / examGradedCount.value) * 100);
      });

      // 状态面板显示
      const examAnsweredCount = computed(() => {
        let c = 0;
        examQueueGids.value.forEach(g => { if (examAnswers[g] && examAnswers[g].answered) c++; });
        return c;
      });

      // computed
      const examCurrentItem = computed(() => {
        const gid = examQueueGids.value[examIndex.value];
        if (!gid) return null;
        return bank.value.find(it => it.gid === gid) || null;
      });
      const examTotal = computed(() => examQueueGids.value.length);
      const examProgressPct = computed(() => {
        if (!examTotal.value) return 0;
        return Math.round((examAnsweredCount.value / examTotal.value) * 100);
      });
      const examIndexLabel = computed(() => {
        if (!examTotal.value) return '0/0';
        return (examIndex.value + 1) + '/' + examTotal.value;
      });
      const examBadgeCount = computed(() => {
        const all = bankGids.value;
        let scopeGids = all.slice();
        if (examScope.value === 'custom') {
          const s = Math.max(1, examCustomStart.value || 1);
          const e = Math.min(bank.value.length, examCustomEnd.value > 0 ? examCustomEnd.value : bank.value.length);
          scopeGids = all.slice(s - 1, e);
          const ts = examTypes.value;
          const hasType = Object.values(ts).some(Boolean);
          if (hasType) scopeGids = scopeGids.filter(g => {
            const it = bank.value.find(b => b.gid === g); return it && ts[it.rawType];
          });
        }
        let n = examPerSession.value === 'custom' ? examPerSessionCustom.value : examPerSession.value;
        if (n !== 'all' && Number(n) > 0 && Number(n) < scopeGids.length) return Number(n);
        return scopeGids.length;
      });

      function _examGetAnswer(gid) {
        if (!examAnswers[gid]) examAnswers[gid] = { choice: null, multiSel: [], input: '', answered: false };
        return examAnswers[gid];
      }
      function _examMarkAnswered(gid) {
        const a = _examGetAnswer(gid);
        const item = bank.value.find(it => it.gid === gid);
        if (!item) { a.answered = false; return; }
        if (item.rawType === 'single_choice' || item.rawType === 'true_false') {
          a.answered = !!a.choice;
        } else if (item.rawType === 'multi_choice') {
          a.answered = a.multiSel.length > 0;
        } else {
          a.answered = !!a.input && a.input.trim() !== '';
        }
      }

      // setup → running
      function examStart() {
        if (!examBadgeCount.value) { toast('当前条件下没有可考试的题目', false); return; }
        const all = bankGids.value;
        let scopeGids = all.slice();
        if (examScope.value === 'custom') {
          const s = Math.max(1, examCustomStart.value || 1);
          const e = Math.min(bank.value.length, examCustomEnd.value > 0 ? examCustomEnd.value : bank.value.length);
          scopeGids = all.slice(s - 1, e);
          const ts = examTypes.value;
          const hasType = Object.values(ts).some(Boolean);
          if (hasType) scopeGids = scopeGids.filter(g => {
            const it = bank.value.find(b => b.gid === g); return it && ts[it.rawType];
          });
        }

        let queueGids;
        if (examStrategy.value === 'sequential') { queueGids = scopeGids.slice(); }
        else {
          queueGids = scopeGids.slice();
          for (let i = queueGids.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [queueGids[i], queueGids[j]] = [queueGids[j], queueGids[i]];
          }
        }
        let n = examPerSession.value === 'custom' ? examPerSessionCustom.value : examPerSession.value;
        if (n !== 'all' && Number(n) > 0) queueGids = queueGids.slice(0, Number(n));

        if (!queueGids.length) { toast('队列为空', false); return; }

        examQueueGids.value = queueGids;
        examIndex.value = 0;
        // 清空/初始化答案对象
        for (const k of Object.keys(examAnswers)) delete examAnswers[k];
        examPassCount.value = 0; examFailCount.value = 0;
        examWrongItems.value = []; examPendingItems.value = []; examBlankItems.value = [];
        examSubmitted.value = false;
        examStartAt.value = Date.now();
        examElapsedSec.value = 0;
        examMode.value = 'running';

        if (examTimer) clearInterval(examTimer);
        examTimer = setInterval(() => {
          examElapsedSec.value = Math.floor((Date.now() - examStartAt.value) / 1000);
        }, 1000);
      }

      function examJump(idx) {
        if (idx < 0 || idx >= examTotal.value) return;
        examIndex.value = idx;
        examSheetOpen.value = false; // 移动端跳题后自动折叠
      }
      function examPrev() { if (examIndex.value > 0) examIndex.value--; }
      function examNext() { if (examIndex.value < examTotal.value - 1) examIndex.value++; }

      // 选项点击（running 中随时可改）
      function examOptionClick(val) {
        const cur = examCurrentItem.value;
        if (!cur || examSubmitted.value) return;
        const a = _examGetAnswer(cur.gid);
        if (cur.rawType === 'single_choice' || cur.rawType === 'true_false') {
          a.choice = (a.choice === val) ? null : val;
        } else if (cur.rawType === 'multi_choice') {
          const idx = a.multiSel.indexOf(val);
          if (idx >= 0) a.multiSel.splice(idx, 1); else a.multiSel.push(val);
        }
        _examMarkAnswered(cur.gid);
      }
      function examIsOptionOn(val) {
        const cur = examCurrentItem.value;
        if (!cur) return false;
        const a = examAnswers[cur.gid];
        return a && a.multiSel.indexOf(val) >= 0;
      }

      // computed 代理：把 examAnswers[gid].input 暴露为可 v-model 的左值
      // Vue 模板 v-model 不能跟函数调用表达式（非 LValue），所以用 computed 桥接
      const examInputProxy = computed({
        get() {
          const cur = examCurrentItem.value;
          if (!cur) return '';
          const a = examAnswers[cur.gid];
          return a ? a.input : '';
        },
        set(val) {
          const cur = examCurrentItem.value;
          if (!cur) return;
          _examGetAnswer(cur.gid).input = val;
          _examMarkAnswered(cur.gid);
        }
      });
      // 同理：把 examAnswers[gid].choice 暴露为 computed 左值（模板 :class 里不能跟函数调用）
      const examChoiceProxy = computed({
        get() {
          const cur = examCurrentItem.value;
          if (!cur) return null;
          const a = examAnswers[cur.gid];
          return a ? a.choice : null;
        },
        set(val) {
          const cur = examCurrentItem.value;
          if (!cur) return;
          _examGetAnswer(cur.gid).choice = val;
          _examMarkAnswered(cur.gid);
        }
      });

      function _examAnswerText(a) {
        if (!a) return '';
        if (a.input) return a.input;
        if (Array.isArray(a.multiSel) && a.multiSel.length) return a.multiSel.join(',');
        return a.choice || '';
      }

      // 交卷（结束 running → summary）
      // 三分法：客观题即时判分；主观题答了→转待自评（此刻不算错）；未答→不计分不入错题本
      function examSubmit() {
        if (examSubmitted.value) return;
        const blank = examQueueGids.value.filter(g => !(examAnswers[g] && examAnswers[g].answered));
        const tip = blank.length
          ? '还有 ' + blank.length + ' 题未作答，确定交卷吗？'
          : '确认交卷并判分？';
        if (!confirm(tip)) return;

        let pass = 0, fail = 0;
        const wrong = [];
        const pending = [];
        examQueueGids.value.forEach(gid => {
          const item = bank.value.find(it => it.gid === gid);
          if (!item) return;
          const a = examAnswers[gid] || {};
          if (!a.answered) return;
          if (isObjective(item.rawType)) {
            if (judgeObjective(item, a.choice || null, a.multiSel || [])) {
              pass++;
              Progress.markPass(gid);
            } else {
              fail++;
              Progress.markFail(gid);
              Wrongbook.add(item, 'exam', _examAnswerText(a), false);
              wrong.push({ gid, item, userAnswer: a, isCorrect: false, isObjective: true });
            }
          } else {
            pending.push({ gid, item, userAnswer: a, isCorrect: null, isObjective: false, subjective: true });
          }
        });
        examPassCount.value = pass;
        examFailCount.value = fail;
        examWrongItems.value = wrong;
        examPendingItems.value = pending;
        examBlankItems.value = blank.map(g => {
          const item = bank.value.find(it => it.gid === g);
          return { gid: g, item: item, userAnswer: examAnswers[g] || {} };
        }).filter(e => e.item);
        examSubmitted.value = true;
        loadWrongbook();      // 角标与来源计数即时刷新
        refreshProgress();

        // 计时停止
        if (examTimer) { clearInterval(examTimer); examTimer = null; }
        examMode.value = 'summary';
      }

      // 主观题自评：对齐分类考试的 catSelfJudge 语义
      function examSelfJudge(gid, correct) {
        const idx = examPendingItems.value.findIndex(e => e.gid === gid);
        if (idx < 0) return;
        const entry = examPendingItems.value[idx];
        examPendingItems.value.splice(idx, 1);
        if (correct) {
          examPassCount.value++;
          Progress.markPass(gid);
        } else {
          examFailCount.value++;
          Progress.markFail(gid);
          Wrongbook.add(entry.item, 'exam', _examAnswerText(entry.userAnswer), false);
          entry.isCorrect = false;
          examWrongItems.value.push(entry);
          loadWrongbook();
        }
        refreshProgress();
      }

      function examExit() {
        if (examTimer) { clearInterval(examTimer); examTimer = null; }
        examMode.value = 'setup';
        for (const k of Object.keys(examAnswers)) delete examAnswers[k];
      }

      function examRestart() {
        examMode.value = 'setup';
        examPassCount.value = 0; examFailCount.value = 0;
        examWrongItems.value = []; examPendingItems.value = []; examBlankItems.value = [];
        examSubmitted.value = false;
        examIndex.value = 0;
        for (const k of Object.keys(examAnswers)) delete examAnswers[k];
        if (examTimer) { clearInterval(examTimer); examTimer = null; }
      }

      function examAutoFillCustomEnd() {
        if (!examCustomEnd.value || examCustomEnd.value <= 0) {
          examCustomEnd.value = bank.value.length || 500;
        }
      }

      // 键盘（考试中 Enter = 下一题，方便快速跳过）
      function examKeyDown(e) {
        if (activeTab.value !== 'exam') return;
        if (examMode.value !== 'running' || examSubmitted.value) return;
        if (e.key === 'Enter') { examNext(); e.preventDefault(); }
        else if (e.key === 'Escape') { examSubmit(); e.preventDefault(); }
      }

      // ====== 生命周期更新（把 examKeyDown 也加进去） ======
      // 下面的 onMounted / onBeforeUnmount 会覆盖这里，在生命周期块追加 exerciseKeyDown 监听

      // ====== 生命周期 ======
      onMounted(() => {
        window.addEventListener('keydown', studyKeyDown);
        window.addEventListener('keydown', exerciseKeyDown);
        window.addEventListener('keydown', examKeyDown);
      });
      onBeforeUnmount(() => {
        window.removeEventListener('keydown', studyKeyDown);
        window.removeEventListener('keydown', exerciseKeyDown);
        window.removeEventListener('keydown', examKeyDown);
        if (studyTimer) clearInterval(studyTimer);
        if (exerciseTimer) clearInterval(exerciseTimer);
        if (examTimer) clearInterval(examTimer);
      });

      /* ============ AI 提示词（弹窗） ============ */
      const showAiModal = ref(false);
      const aiCopied = ref(false);

      /* ============ 计算属性 ============ */
      const papers = computed(() => currentBank.value.papers);
      const hasMultiplePapers = computed(() => papers.value.length > 1);
      const features = computed(() => currentBank.value.features || {});
      const totalQuestions = computed(() => bank.value.length);

      /* —— 阶段 0 新增：学习状态 & 统计 —— */
      // bankGids：所有题目的全局 id 数组
      const bankGids = computed(() => bank.value.map(it => it.gid).filter(Boolean));
      // progressMap：全部学习进度（读取 ExamProgress，用 progressTick 驱动刷新）
      const progressMap = computed(() => {
        progressTick.value; // 依赖信号
        return Progress.getAll();
      });
      // wrongbookV2Entries：读取 v2 错题本
      const wrongbookV2Entries = computed(() => {
        progressTick.value;
        try {
          const raw = localStorage.getItem(Migration.WRONGBOOK_V2_KEY);
          if (!raw) return [];
          const v = JSON.parse(raw);
          return v && Array.isArray(v.entries) ? v.entries : [];
        } catch (e) { return []; }
      });
      // dashboard：首页聚合
      const dashboard = computed(() => {
        progressTick.value;
        return Stats.buildDashboard({
          allGids: bankGids.value,
          progressMap: progressMap.value,
          wrongbookEntries: wrongbookV2Entries.value
        });
      });
      // dailyTask：今日任务生成
      const dailyTask = computed(() => {
        progressTick.value;
        if (!Session || !Session.generateDailyTask) return { queue: [], stats: {} };
        return Session.generateDailyTask(bankGids.value);
      });
      // 本周活跃天数（weekTrend 里 reviewed > 0 的天数）
      const weekActiveDays = computed(() => {
        const trend = dashboard.value && dashboard.value.weekTrend;
        if (!trend) return 0;
        return trend.filter(d => d.reviewed > 0).length;
      });
      const weekGoalDays = 5; // 每周目标 5 天（硬编码，后续可从 settings 读）
      // 恢复点按 mode 归属：学习 / 练习 / 考试各认各的，不再互相顶包
      function resumeComputed(mode) {
        return computed(() => {
          progressTick.value;
          return Session.loadResumePoint(bankIdOf(), mode);
        });
      }
      const resumeStudy = resumeComputed('study');
      const resumeExercise = resumeComputed('exercise');

      const tabs = computed(() => {
        // 阶段 3：home + study + exercise + 原功能 tab
        const list = [];
        list.push({ key: 'home', label: '首页', icon: '🏠', mode: 'all' });
        list.push({ key: 'study', label: '学习', icon: '📖' });
        list.push({ key: 'exercise', label: '练习', icon: '✍️' });
        const f = features.value;
        if (!f.practice || f.practice.enabled) list.push({ key: 'practice', label: (f.practice && f.practice.label) || '记忆闯关', icon: (f.practice && f.practice.icon) || '🕹️' });
        if (!f.preview || f.preview.enabled) list.push({ key: 'preview', label: (f.preview && f.preview.label) || '摸底速览', icon: (f.preview && f.preview.icon) || '📝' });
        list.push({ key: 'exam', label: '模拟考试', icon: '🎓' });
        list.push({ key: 'category', label: '分类考试', icon: '🎯' });
        list.push({ key: 'wrongbook', label: '错题本', icon: '📕' });
        return list;
      });

      const practiceCfg = computed(() => (features.value.practice && features.value.practice.config) || {});
      const passLabel = computed(() => practiceCfg.value.passLabel || '😎 记住了');
      const failLabel = computed(() => practiceCfg.value.failLabel || '😥 没记住');
      const shufflePolicy = computed(() => practiceCfg.value.shuffle !== false);

      const practiceCard = computed(() => practiceQueue.value[0] ? practiceQueue.value[0].it : null);
      const practiceMastered = computed(() => totalQuestions.value - practiceQueue.value.length);
      const practiceProgress = computed(() => totalQuestions.value === 0 ? 0 : ((totalQuestions.value - practiceQueue.value.length) / totalQuestions.value) * 100);

      const catCurrent = computed(() => catPool.value[catIndex.value] || null);
      const catNextLabel = computed(() => (catIndex.value + 1 < catStats.total) ? '下一题 →' : '查看成绩');
      const hasPrevCat = computed(() => catIndex.value > 0);
      const catTypes = computed(() => {
        const groups = Utils.groupBy(bank.value, it => it.rawType);
        return Object.keys(groups).map(rawType => ({
          rawType: rawType,
          label: groups[rawType][0].typeLabel,
          count: groups[rawType].length
        }));
      });
      const catAllSelected = computed(() => catTypes.value.length > 0 && catSelected.value.length === catTypes.value.length);

      const wrongCount = computed(() => wrongEntries.value.length);
      const wrongBySource = computed(() => {
        const g = Utils.groupBy(wrongEntries.value, e => e.source);
        return {
          practice: g.practice || [],
          preview: g.preview || [],
          exam: g.exam || [],
          all: wrongEntries.value
        };
      });
      const wrongFiltered = computed(() => wrongBySource.value[wrongTab.value] || wrongEntries.value);
      const wrongItems = computed(() => wrongFiltered.value.map(e => e.item));
      // v2：错题本状态分布（new / learning / weak）
      const wrongStatusDist = computed(() => {
        if (!wrongEntries.value.length) return { new: 0, learning: 0, weak: 0 };
        return Wrongbook.countByStatus();
      });

      const aiPrompt = computed(() => AIPrompt.PROMPT);

      /* ============ 工具 ============ */
      function toast(msg, ok) {
        toastMsg.value = msg;
        toastOk.value = ok !== false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toastMsg.value = ''; }, 2200);
      }
      function sourceLabel(s) {
        return { practice: '记忆闯关', preview: '摸底速览', exam: '分类考试' }[s] || s;
      }
      function makeEnvelope(source, url, data) {
        return { source, url: url || '', fetchedAt: new Date().toISOString(), data };
      }
      function sourceMetaDump(source) {
        const t = source.source;
        if (t === 'remote') sourceMeta.value = { label: '🌐 远程', cls: 'remote', url: source.url || '', detail: `URL：${source.url || '(未记录)'} · 读取于 ${source.fetchedAt || ''}` };
        else if (t === 'paste') sourceMeta.value = { label: '📋 粘贴', cls: 'paste', url: '', detail: `手动录入 · 缓存于 ${source.fetchedAt || ''}` };
        else if (t === 'file') sourceMeta.value = { label: '📁 本地文件', cls: 'local', url: '', detail: `文件导入 · 缓存于 ${source.fetchedAt || ''}` };
        else if (t === 'local') sourceMeta.value = { label: '🗄️ 本地缓存', cls: 'local', url: source.url || '', detail: (source.url ? `URL：${source.url} · ` : '') + `缓存于 ${source.fetchedAt || ''}` };
        else sourceMeta.value = { label: '📄 内置默认', cls: 'default', url: '', detail: '应用内置的离线兜底数据。' };
      }

      /* ============ 数据应用 ============ */
      function applyNormalized(normalized, source) {
        currentBank.value = normalized;
        currentPaperId.value = normalized.papers[0] ? String(normalized.papers[0].id) : '';
        rebuildBank();
        if (!tabs.value.some(t => t.key === activeTab.value)) {
          activeTab.value = (tabs.value[0] && tabs.value[0].key) || 'home';
        }
        sourceMetaDump(source);
        dataError.value = '';
        catSelected.value = [];
        loadWrongbook();
        // 阶段 0 新增：数据到位后跑一次性迁移 + 刷新统计
        try { Migration.runAll(normalized); } catch (e) { /* 迁移失败不阻塞应用 */ }
        refreshProgress();
      }

      function rebuildBank() {
        bank.value = Core.buildItems(currentBank.value, currentPaperId.value);
        resetPractice(); // 数据变化时总是重置练习队列，避免切卷残留旧队列
        // 阶段 0 新增：切卷后刷新统计
        refreshProgress();
      }

      function switchPaper() {
        rebuildBank();
        catSelected.value = [];
        catStage.value = 'setup';   // 重置分类考试
        catPool.value = [];
        catWrongItems.value = [];
        Object.keys(previewRevealed).forEach(k => delete previewRevealed[k]); // 清空摸底速览的查看状态
      }

      /* ============ 数据加载（优先级：缓存 > data.json > 内置兜底） ============ */
      async function loadStart() {
        Store.clearLegacyCache();
        const cached = Store.readCache();
        if (cached && cached.data) {
          try {
            const normalized = Core.normalizeBank(cached.data);
            currentBank.value = normalized;
            currentPaperId.value = normalized.papers[0] ? String(normalized.papers[0].id) : '';
            rebuildBank();
            if (!tabs.value.some(t => t.key === activeTab.value)) activeTab.value = (tabs.value[0] && tabs.value[0].key) || 'home';
            sourceMetaDump({ source: 'local', url: cached.url, fetchedAt: cached.fetchedAt });
            remoteUrl.value = cached.url || '';
            loadWrongbook();
            // 阶段 0 新增：迁移 + 刷新
            try { Migration.runAll(normalized); } catch (e) { /* */ }
            refreshProgress();
            return { via: 'cache' };
          } catch (e) { Store.clearCache(); }
        }
        try {
          const res = await fetch(DEFAULT_REMOTE_URL, { cache: 'no-store' });
          if (res.ok) {
            const data = JSON.parse(await res.text());
            const normalized = Core.normalizeBank(data);
            applyNormalized(normalized, makeEnvelope('remote', DEFAULT_REMOTE_URL, data));
            Store.writeCache(makeEnvelope('remote', DEFAULT_REMOTE_URL, data));
            return { via: 'remote' };
          }
        } catch (e) { /* file:// 或 CORS 不可用则走兜底 */ }
        if (global.DEFAULT_BANK) {
          const normalized = Core.normalizeBank(global.DEFAULT_BANK);
          applyNormalized(normalized, makeEnvelope('default', '', global.DEFAULT_BANK));
          return { via: 'default' };
        }
        sourceMeta.value = { label: '❌ 无数据', cls: 'default', url: '', detail: '未找到数据，请导入 JSON。' };
      }

      /* ============ 导入 / 导出 ============ */
      async function fetchUrl() {
        const url = (remoteUrl.value || '').trim();
        if (!url) { dataError.value = '请先输入远程 JSON 链接。'; return; }
        dataError.value = '';
        dataBusy.value = true;
        try {
          const res = await fetch(url, { cache: 'no-store' });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const data = JSON.parse(await res.text());
          const normalized = Core.normalizeBank(data);
          applyNormalized(normalized, makeEnvelope('remote', url, data));
          Store.writeCache(makeEnvelope('remote', url, data));
          toast('远程导入成功');
        } catch (e) { dataError.value = '远程导入失败：' + e.message; }
        finally { dataBusy.value = false; }
      }

      /* ============ 数据备份 & 恢复 ============ */
      function doExportBackup() {
        if (!global.ExamBackup) { toast('备份模块未加载', false); return; }
        try {
          var payload = global.ExamBackup.exportBackup();
          var keys = Object.keys(payload.storage).length;
          toast('已导出备份：' + keys + ' 个数据键', true);
        } catch (e) {
          toast('导出失败：' + e.message, false);
        }
      }

      function onImportBackup(evt) {
        var file = evt.target.files && evt.target.files[0];
        if (!file) return;
        // reset so picking the same file again triggers change
        evt.target.value = '';
        if (!global.ExamBackup) { toast('备份模块未加载', false); return; }
        var msg = '导入方式：\n[合并] 只覆盖备份中有数据的项，保留现有其它数据\n[覆盖] 先清空全部数据再写入备份\n\n是否继续？';
        var mode = confirm(msg + '\n\n点"确定"=合并，点"取消"=再给你一次选择机会') ? 'merge' : null;
        if (mode === null) {
          mode = confirm('确定要用 [覆盖] 模式吗？这会先清空所有数据！') ? 'replace' : null;
        }
        if (!mode) return;
        global.ExamBackup.importBackup(file, { mode: mode }).then(function (r) {
          toast(r.msg, r.ok);
          if (r.ok) {
            progressTick.value++;
            refresh();
          }
        }).catch(function (e) {
          toast('导入失败：' + (e && e.msg ? e.msg : e.message), false);
        });
      }

      function doClearAll() {
        if (!confirmClearAll.value) {
          confirmClearAll.value = true;
          setTimeout(function () { confirmClearAll.value = false; }, 5000);
          return;
        }
        confirmClearAll.value = false;
        if (!confirm('⚠️ 确定要清空所有数据吗？\n这将删除题库、学习进度、错题本等全部数据。\n\n此操作不可撤销（除非你之前导出过备份）。')) return;
        if (!global.ExamBackup) return;
        var removed = global.ExamBackup.clearAll();
        toast('已清空 ' + removed.length + ' 个数据键，请重新导入题库', true);
        progressTick.value++;
        refresh();
      }

      async function refresh() {
        if (sourceMeta.value.url && sourceMeta.value.cls === 'remote') {
          remoteUrl.value = sourceMeta.value.url;
          await fetchUrl();
        } else if (Store.readCache() && Store.readCache().url) {
          remoteUrl.value = Store.readCache().url;
          await fetchUrl();
        } else {
          dataError.value = '当前来源没有可刷新的远程地址。可先「清空缓存并重载」再远程导入。';
        }
      }

      function applyPaste() {
        const text = (pasteText.value || '').trim();
        if (!text) { dataError.value = '粘贴内容为空。'; return; }
        try {
          const data = JSON.parse(text);
          const normalized = Core.normalizeBank(data);
          applyNormalized(normalized, makeEnvelope('paste', '', data));
          Store.writeCache(makeEnvelope('paste', '', data));
          pasteText.value = '';
          toast('粘贴导入成功');
        } catch (e) { dataError.value = '粘贴解析失败：' + e.message; }
      }

      function clearAndReload() {
        Store.clearCache();
        dataError.value = '';
        toast('已清空缓存');
        loadStart();
      }

      function onDragOver(e) { e.preventDefault(); dragActive.value = true; }
      function onDragLeave(e) { e.preventDefault(); dragActive.value = false; }
      function onDrop(e) {
        e.preventDefault();
        dragActive.value = false;
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) readFile(file);
      }
      function onFileChange(e) {
        const file = e.target.files && e.target.files[0];
        if (file) readFile(file);
        e.target.value = '';
      }
      function readFile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const data = JSON.parse(reader.result);
            const normalized = Core.normalizeBank(data);
            applyNormalized(normalized, makeEnvelope('file', '', data));
            Store.writeCache(makeEnvelope('file', '', data));
            toast('已导入：' + file.name);
          } catch (err) { dataError.value = '文件解析失败：' + err.message; }
        };
        reader.onerror = () => { dataError.value = '文件读取失败。'; };
        reader.readAsText(file);
      }

      function serializeBank() {
        return {
          view: 'exam-bank',
          viewVersion: (window.MEMODECK_VERSION && window.MEMODECK_VERSION.VIEW) || '1.0.0',
          meta: currentBank.value.meta || {},
          features: currentBank.value.features || {},
          papers: currentBank.value.papers || []
        };
      }

      function downloadCurrent() {
        const blob = new Blob([JSON.stringify(serializeBank(), null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = ((currentBank.value.meta && currentBank.value.meta.title) || 'exam-bank') + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
      }

      async function copyCurrent() {
        const text = JSON.stringify(serializeBank(), null, 2);
        try {
          await navigator.clipboard.writeText(text);
          toast('已复制当前题库 JSON 到剪贴板');
        } catch (e) {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); toast('已复制到剪贴板'); }
          catch (e2) { dataError.value = '复制失败，请手动复制。'; }
          document.body.removeChild(ta);
        }
      }

      function downloadRules() {
        fetch('./docs/EXAM_JSON_SPEC.md', { cache: 'no-store' })
          .then(r => { if (!r.ok) throw new Error('not found'); return r.text(); })
          .then(text => saveText('MemoDeck-JSON规则.md', text))
          .catch(() => saveText('MemoDeck-JSON规则.md', global.FALLBACK_RULES || ''));
      }
      function saveText(fileName, text) {
        const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(a.href);
      }

      /* ============ Tab 切换 ============ */
      function switchTab(k) {
        activeTab.value = k;
        if (k === 'practice' && practiceQueue.value.length === 0) resetPractice();
        if (k === 'wrongbook') loadWrongbook();
      }

      /* ============ 记忆闯关（Leitner） ============ */
      function resetPractice() {
        const source = shufflePolicy.value ? Utils.shuffle(bank.value) : bank.value.slice();
        practiceQueue.value = Leitner.createQueue(source);
        practiceShowAnswer.value = false;
      }
      function mark(remembered) {
        const cur = practiceCard.value;
        if (remembered) {
          Leitner.markPass(practiceQueue.value);
          // 阶段 0 新增：写入 progress store
          if (cur && cur.gid) Progress.markPass(cur.gid);
        } else {
          Leitner.markFail(practiceQueue.value);
          // 没记住：立即加入错题本（全局去重），实时刷新角标
          if (cur) {
            Wrongbook.add(cur, 'practice', null, false);
            loadWrongbook();
          }
          // 阶段 0 新增：写入 progress store
          if (cur && cur.gid) Progress.markFail(cur.gid);
        }
        // 阶段 0 新增：刷新统计
        refreshProgress();
        practiceShowAnswer.value = false;
      }

      /* ============ 摸底速览 ============ */
      function togglePreview(index) {
        if (previewRevealed[index]) delete previewRevealed[index];
        else previewRevealed[index] = true;
      }
      function addPreviewToWrongbook(item) {
        if (Wrongbook.add(item, 'preview', null, null)) toast('已加入错题本');
        else toast('该题已在错题本中', false);
      }

      /* ============ 分类考试 ============ */
      function toggleCatType(t) {
        const i = catSelected.value.indexOf(t);
        if (i >= 0) catSelected.value.splice(i, 1);
        else catSelected.value.push(t);
        catError.value = '';
      }
      function selectAllTypes() {
        catSelected.value = catAllSelected.value ? [] : catTypes.value.map(t => t.rawType);
      }
      function startCat() {
        if (!catSelected.value.length) { catError.value = '请至少选择一种题型。'; return; }
        let pool = bank.value.filter(it => catSelected.value.includes(it.rawType));
        if (!pool.length) { catError.value = '所选题型没有题目。'; return; }
        catPool.value = Utils.shuffle(pool);
        catIndex.value = 0;
        catStats.total = pool.length;
        catStats.right = 0;
        catStats.wrong = 0;
        catWrongItems.value = [];
        catStage.value = 'test';
        catFromWrongbook.value = false;
        catSnapshots.value = {};
        catStartTime.value = Date.now();
        catElapsed.value = '';
        catError.value = '';
        resetCatAnswer();
      }
      function resetCatAnswer() {
        catInput.value = '';
        catChoice.value = null;
        catMultiSel.value = [];
        catRevealed.value = false;
        catFeedback.value = null;
      }
      // 填空题多空答案：在光标处插入分隔符「|」，免去手动输入
      function insertCatSep() {
        const el = catFillInput.value;
        const cur = catCurrent.value;
        if (!cur || catRevealed.value) return;
        const v = catInput.value || '';
        const pos = (el && typeof el.selectionStart === 'number') ? el.selectionStart : v.length;
        catInput.value = v.slice(0, pos) + '|' + v.slice(pos);
        nextTick(() => {
          if (el) {
            el.focus();
            try { el.setSelectionRange(pos + 1, pos + 1); } catch (e) {}
          }
        });
      }
      function isObjective(rawType) {
        return rawType === 'true_false' || rawType === 'single_choice' || rawType === 'multi_choice';
      }
      function catSubmit() {
        const cur = catCurrent.value;
        if (!cur || catRevealed.value) return;
        if (isObjective(cur.rawType)) {
          finishCatAnswer(judgeObjective(cur, catChoice.value, catMultiSel.value));
        } else {
          catRevealed.value = true; // 主观题：揭示答案，等待自评
        }
      }
      function finishCatAnswer(correct) {
        catRevealed.value = true;
        catFeedback.value = { correct: correct };
        if (correct) {
          catStats.right++;
          // 来自错题本的重新考试：答对自动移出错题本
          if (catFromWrongbook.value && catCurrent.value) {
            Wrongbook.removeByItem(catCurrent.value);
            loadWrongbook();
          }
          // 答对：短暂展示「✅ 回答正确」后自动进入下一题
          clearTimeout(autoNextTimer);
          autoNextTimer = setTimeout(() => {
            if (catStage.value === 'test') catNext();
          }, 600);
        } else {
          catStats.wrong++;
          catWrongItems.value.push(catCurrent.value);
          // 答错：实时加入错题本（全局去重，跨来源），无需等考试结束即可见
          Wrongbook.add(catCurrent.value, 'exam', null, false);
          loadWrongbook();
        }
      }
      function catSelfJudge(correct) {
        if (catRevealed.value && !catFeedback.value) finishCatAnswer(correct);
      }
      function catNext() {
        snapshotCat();
        if (catIndex.value + 1 < catPool.value.length) {
          catIndex.value++;
          restoreCat();
        } else {
          catStage.value = 'done';
          const sec = Math.floor((Date.now() - catStartTime.value) / 1000);
          const m = Math.floor(sec / 60), s = sec % 60;
          catElapsed.value = m > 0 ? (m + ' 分 ' + s + ' 秒') : (s + ' 秒');
          // 错题已在答题瞬间实时入库（finishCatAnswer），这里仅刷新一次视图
          loadWrongbook();
        }
      }
      function catPrev() {
        if (catIndex.value <= 0) return;
        clearTimeout(autoNextTimer); // 回看时取消可能存在的自动前进
        snapshotCat();
        catIndex.value--;
        restoreCat();
      }
      function snapshotCat() {
        catSnapshots.value[catIndex.value] = {
          input: catInput.value,
          choice: catChoice.value,
          multiSel: catMultiSel.value.slice(),
          revealed: catRevealed.value,
          feedback: catFeedback.value
        };
      }
      function restoreCat() {
        const s = catSnapshots.value[catIndex.value];
        if (s) {
          catInput.value = s.input;
          catChoice.value = s.choice;
          catMultiSel.value = s.multiSel.slice();
          catRevealed.value = s.revealed;
          catFeedback.value = s.feedback;
        } else {
          resetCatAnswer();
        }
      }
      function toggleCatMulti(opt) {
        const i = catMultiSel.value.indexOf(opt);
        if (i >= 0) catMultiSel.value.splice(i, 1);
        else catMultiSel.value.push(opt);
      }
      function catOptionClick(k) {
        if (catRevealed.value) return;
        if (catCurrent.value && catCurrent.value.rawType === 'single_choice') catChoice.value = k;
        else toggleCatMulti(k);
      }
      function isCatOptionOn(k) {
        if (!catCurrent.value) return false;
        return catCurrent.value.rawType === 'single_choice' ? catChoice.value === k : catMultiSel.value.includes(k);
      }
      function catRestart() {
        clearTimeout(autoNextTimer);
        catStage.value = 'setup';
        catPool.value = [];
        catWrongItems.value = [];
        catSnapshots.value = {};
        catElapsed.value = '';
      }
      function parseOptions(text) {
        const opts = {};
        (text || '').split('\n').forEach(line => {
          const m = line.match(/^\s*([A-Za-z])\s*[.、:：]\s*(.+)$/);
          if (m) opts[m[1].toUpperCase()] = m[2].trim();
        });
        return opts;
      }
      function addCustomQuestion() {
        const f = customForm;
        if (!f.question.trim()) { catError.value = '请输入题干。'; return; }
        const q = { id: Date.now(), type: f.type, question: f.question.trim(), group: Core.TYPE_REGISTRY[f.type] ? Core.TYPE_REGISTRY[f.type].label : f.type };
        if (f.type === 'fill_blank' || f.type === 'special_fill_blank') {
          q.blanks = f.answer.split(/[|｜]/).map(s => s.trim()).filter(Boolean).map((a, i) => ({ index: i + 1, answer: a }));
        } else if (f.type === 'true_false') {
          q.answer = /对|正确|√|true/i.test(f.answer);
        } else if (f.type === 'single_choice') {
          q.options = parseOptions(f.options);
          q.answer = f.answer.trim().toUpperCase();
        } else if (f.type === 'multi_choice') {
          q.options = parseOptions(f.options);
          q.answer = f.answer.split(/[,，\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
        } else {
          q.answer = f.answer.trim();
        }
        const paper = currentBank.value.papers.find(p => String(p.id) === String(currentPaperId.value));
        if (paper) paper.questions.push(q);
        else currentBank.value.papers.push({ id: '自定义', name: '自定义卷', questions: [q] });
        rebuildBank();
        if (!catSelected.value.includes(q.type)) catSelected.value.push(q.type);
        catError.value = '';
        customForm.question = ''; customForm.answer = ''; customForm.options = '';
        toast('已添加题目');
      }

      /* ============ 错题本 ============ */
      function loadWrongbook() {
        wrongEntries.value = Wrongbook.list();
      }
      function wrongRemove(id) {
        Wrongbook.remove(id);
        loadWrongbook();
      }
      function wrongClear(source) {
        Wrongbook.clear(source);
        loadWrongbook();
      }
      function startWrongPractice(items) {
        if (!items.length) return;
        wrongPracticeQueue.value = Leitner.createQueue(items);
        wrongPracticeShow.value = false;
      }
      function wrongMark(remembered) {
        const cur = wrongPracticeQueue.value[0];
        const curItem = cur && cur.it;
        if (remembered) {
          // ✅ v2：调 Wrongbook.markCorrect 推进状态机（连续答对 3 次自动移出）
          // 先找对应 entry（通过 gid）
          const wbEntries = Wrongbook.list();
          const entry = curItem && curItem.gid
            ? wbEntries.find(e => e.gid === curItem.gid)
            : null;
          if (entry) {
            const result = Wrongbook.markCorrect(entry.id);
            if (result.removed) toast('🎉 这道题已连续答对 3 次，自动移出错题本', true);
            loadWrongbook();
          }
          // Leitner 队列仍然前移
          Leitner.markPass(wrongPracticeQueue.value);
          if (curItem && curItem.gid) Progress.markPass(curItem.gid);
        } else {
          // ❌ 没记住
          const wbEntries = Wrongbook.list();
          const entry = curItem && curItem.gid
            ? wbEntries.find(e => e.gid === curItem.gid)
            : null;
          if (entry) {
            Wrongbook.markWrong(entry.id); // 状态机归零
            loadWrongbook();
          }
          Leitner.markFail(wrongPracticeQueue.value);
          if (curItem && curItem.gid) Progress.markFail(curItem.gid);
        }
        refreshProgress();
        wrongPracticeShow.value = false;
      }
      function startWrongExam(items) {
        if (!items.length) return;
        catPool.value = Utils.shuffle(items);
        catIndex.value = 0;
        catStats.total = items.length;
        catStats.right = 0;
        catStats.wrong = 0;
        catWrongItems.value = [];
        catStage.value = 'test';
        catFromWrongbook.value = true;
        catSnapshots.value = {};
        catStartTime.value = Date.now();
        catElapsed.value = '';
        resetCatAnswer();
        activeTab.value = 'category';
      }

      /* ============ AI 提示词 ============ */
      async function copyAiPrompt() {
        try {
          await navigator.clipboard.writeText(aiPrompt.value);
          aiCopied.value = true;
          setTimeout(() => { aiCopied.value = false; }, 2000);
        } catch (e) {
          const ta = document.createElement('textarea');
          ta.value = aiPrompt.value;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          aiCopied.value = true;
          setTimeout(() => { aiCopied.value = false; }, 2000);
        }
      }
      function downloadAiPrompt() {
        saveText('MemoDeck-AI题库转换提示词.md', aiPrompt.value);
      }

      /* ============ 初始化 ============ */
      loadStart();

      return {
        activeTab, sourceMeta, currentBank, papers, hasMultiplePapers, features, currentPaperId, bank, dataError,
        remoteUrl, pasteText, managerUrl, showDataPanel, dataBusy, dragActive, toastMsg, toastOk,
        themeMode, applyTheme,
        practiceQueue, practiceShowAnswer, practiceCard, practiceMastered, practiceProgress,
        passLabel, failLabel, totalQuestions, tabs,
        previewRevealed,
        catStage, catSelected, catInput, catChoice, catMultiSel, catRevealed, catFeedback,
        catPool, catIndex, catStats, catWrongItems, catError, catCurrent, catNextLabel, hasPrevCat, catElapsed, catTypes, catAllSelected,
        showCustomForm, customForm,
        wrongEntries, wrongTab, wrongCount, wrongFiltered, wrongItems, wrongBySource, wrongStatusDist,
        wrongPracticeQueue, wrongPracticeShow,
        showAiModal, aiPrompt, aiCopied,
        catFillInput, insertCatSep,
        fetchUrl, refresh, applyPaste, clearAndReload, onDragOver, onDragLeave, onDrop, onFileChange,
        downloadCurrent, copyCurrent, downloadRules, switchPaper, switchTab,
        doExportBackup, onImportBackup, doClearAll, confirmClearAll,
        resetPractice, mark, togglePreview, addPreviewToWrongbook,
        toggleCatType, selectAllTypes, startCat, catSubmit, catSelfJudge, catNext, catPrev,
        toggleCatMulti, catOptionClick, isCatOptionOn, catRestart, addCustomQuestion, isObjective,
        sourceLabel,
        loadWrongbook, wrongRemove, wrongClear, startWrongPractice, wrongMark, startWrongExam,
        copyAiPrompt, downloadAiPrompt,
        // —— 阶段 0/1 新增：首页数据 & 学习状态 ——
        bankGids, progressMap, dashboard, dailyTask, weekActiveDays, weekGoalDays,
        resumeStudy, resumeExercise, wrongbookV2Entries,
        refreshProgress,
        // —— 阶段 2 新增：学习/背诵模式 ——
        studyMode, studyScope, studyCustomStart, studyCustomEnd, studyStrategy,
        studyPerSession, studyPerSessionCustom, studyTypes,
        studyQueueGids, studyIndex, studyShowAnswer,
        studyPassCount, studyFailCount, studyNewMastered, studyNewWrong, studyMaxStreak,
        studySwipeX, studySwipeActive,
        studyElapsedSec, studyCurrentItem, studyNextItem,
        studyTotal, studyProgressPct, studyCurrentProgress, studyPrevHint,
        studyScopeCounts, studyCustomCount, studyAvailableCount, studyBadgeCount,
        studyStart, studyResume, studyAbandonResume, studyMark, studyNext,
        studyExit, studyRestart, studyFinish, studyFormatDuration,
        studyOnSwipeStart, studyOnSwipeMove, studyOnSwipeEnd,
        studyAutoFillCustomEnd,
        // —— 阶段 3 新增：练习模式 ——
        exerciseMode, exerciseScope, exerciseCustomStart, exerciseCustomEnd, exerciseStrategy,
        exercisePerSession, exercisePerSessionCustom, exerciseTypes,
        exerciseQueueGids, exerciseIndex, exerciseStartAt,
        exerciseAnswerSubmitted, exerciseChoice, exerciseMultiSel, exerciseInput,
        exerciseFeedback, exerciseStudentAnswer,
        exercisePassCount, exerciseFailCount, exerciseNewWrong, exerciseNewMastered, exerciseElapsedSec,
        exerciseSwipeX, exerciseSwipeActive,
        exerciseCurrentItem, exerciseNextItem, exerciseTotal, exerciseProgressPct,
        exerciseCurrentProgress, exercisePrevHint, exerciseBadgeCount,
        exerciseStart, exerciseResume, exerciseAbandonResume,
        exerciseSubmit, exerciseSelfJudge, exerciseNext, exerciseExit, exerciseRestart, exerciseFinish,
        exerciseOptionClick, exerciseIsOptionOn, exerciseAutoFillCustomEnd,
        exerciseOnSwipeStart, exerciseOnSwipeMove, exerciseOnSwipeEnd,
        // —— 阶段 4 新增：模拟考试 ——
        examMode, examScope, examCustomStart, examCustomEnd, examStrategy,
        examPerSession, examPerSessionCustom, examTypes,
        examQueueGids, examIndex, examStartAt, examElapsedSec,
        examAnswers, examSubmitted, examSheetOpen, examPassCount, examFailCount, examWrongItems,
        examPendingItems, examBlankItems, examGradedCount, examScorePct,
        examAnsweredCount, examCurrentItem, examTotal, examProgressPct,
        examIndexLabel, examBadgeCount,
        examStart, examJump, examPrev, examNext, examSubmit, examSelfJudge, examExit, examRestart,
        examOptionClick, examIsOptionOn, examAutoFillCustomEnd,
        examInputProxy, examChoiceProxy,
        _examGetAnswer
      };
    }
  });

  // 全局组件：标准答案展示（记忆闯关 / 摸底速览 复用）
  app.component('answer-view', {
    props: { item: { type: Object, required: true } },
    template: `
      <div class="answer-box">
        <div class="answer-title">标准答案：</div>
        <template v-if="item.rawType === 'fill_blank' || item.rawType === 'special_fill_blank'">
          <div class="answer-item" v-for="(b, i) in (item.blanks || [])" :key="i">
            <span class="answer-index">空 {{ b.index }}</span><span class="answer-text">{{ b.answer }}</span>
          </div>
        </template>
        <template v-else-if="item.rawType === 'true_false'">
          <span class="answer-text" :class="item.answer ? 'ans-ok' : 'ans-no'">{{ item.answer ? '✓ 正确' : '✗ 错误' }}</span>
        </template>
        <template v-else-if="item.rawType === 'single_choice'">
          <span class="answer-text">{{ item.answer }}. {{ item.options && item.options[item.answer] }}</span>
        </template>
        <template v-else-if="item.rawType === 'multi_choice'">
          <span class="answer-text">{{ Array.isArray(item.answer) ? item.answer.join(', ') : item.answer }}</span>
        </template>
        <template v-else>
          <span class="answer-text">{{ item.answer }}</span>
        </template>
        <div class="answer-explanation" v-if="item.explanation">解析：{{ item.explanation }}</div>
      </div>
    `
  });

  app.mount('#app');
})(window);
