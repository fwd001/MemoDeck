/**
 * MemoDeck · Vue 应用逻辑
 * 依赖：vendor/vue.global.prod.js（全局 Vue）、ExamCore / ExamStore / ExamLeitner / ExamWrongbook / ExamAIPrompt
 * 挂载：index.html 中的 #app（in-DOM template）
 */
(function (global) {
  'use strict';

  const { createApp, ref, reactive, computed } = global.Vue;
  const Core = global.ExamCore;
  const Store = global.ExamStore;
  const Leitner = global.ExamLeitner;
  const Wrongbook = global.ExamWrongbook;
  const AIPrompt = global.ExamAIPrompt;

  // 运行配置见 config.js（defaultRemoteUrl / jsonManagerUrl 均可外部覆盖）
  const CFG = global.EXAM_CONFIG || {};
  const DEFAULT_REMOTE_URL = CFG.defaultRemoteUrl || './data.json';
  const JSON_MANAGER_URL = CFG.jsonManagerUrl || ''; // 留空则隐藏「JSON 管理服务」入口

  const app = createApp({
    setup() {
      /* ============ 基础 / 数据源 ============ */
      const activeTab = ref('practice');            // practice | exam | category | wrongbook
      const sourceMeta = ref({ label: '加载中…', cls: 'default', url: '', detail: '' });
      const currentBank = ref({ meta: {}, features: {}, papers: [] });
      const currentPaperId = ref('');
      const bank = ref([]);                          // 题目条目数组
      const dataError = ref('');
      const remoteUrl = ref('');
      const pasteText = ref('');
      const managerUrl = ref(JSON_MANAGER_URL);
      const showDataPanel = ref(true);
      const dataBusy = ref(false);
      const dragActive = ref(false);
      const toastMsg = ref('');
      const toastOk = ref(true);
      let toastTimer = null;

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

      /* ============ AI 提示词 ============ */
      const showAiPanel = ref(false);
      const aiCopied = ref(false);

      /* ============ 计算属性 ============ */
      const papers = computed(() => currentBank.value.papers);
      const hasMultiplePapers = computed(() => papers.value.length > 1);
      const features = computed(() => currentBank.value.features || {});
      const totalQuestions = computed(() => bank.value.length);

      const tabs = computed(() => {
        const f = features.value;
        const list = [];
        if (!f.practice || f.practice.enabled) list.push({ key: 'practice', label: (f.practice && f.practice.label) || '记忆闯关', icon: (f.practice && f.practice.icon) || '🕹️' });
        if (!f.exam || f.exam.enabled) list.push({ key: 'exam', label: (f.exam && f.exam.label) || '摸底速览', icon: (f.exam && f.exam.icon) || '📝' });
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
        const map = {};
        bank.value.forEach(it => {
          if (!map[it.rawType]) map[it.rawType] = { rawType: it.rawType, label: it.typeLabel, count: 0 };
          map[it.rawType].count++;
        });
        return Object.values(map);
      });
      const catAllSelected = computed(() => catTypes.value.length > 0 && catSelected.value.length === catTypes.value.length);

      const wrongCount = computed(() => wrongEntries.value.length);
      const wrongBySource = computed(() => ({
        practice: wrongEntries.value.filter(e => e.source === 'practice'),
        preview: wrongEntries.value.filter(e => e.source === 'preview'),
        exam: wrongEntries.value.filter(e => e.source === 'exam'),
        all: wrongEntries.value
      }));
      const wrongFiltered = computed(() => wrongBySource.value[wrongTab.value] || wrongEntries.value);
      const wrongItems = computed(() => wrongFiltered.value.map(e => e.item));

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
          activeTab.value = (tabs.value[0] && tabs.value[0].key) || 'practice';
        }
        sourceMetaDump(source);
        dataError.value = '';
        catSelected.value = [];
        loadWrongbook();
      }

      function rebuildBank() {
        bank.value = Core.buildItems(currentBank.value, currentPaperId.value);
        resetPractice(); // 数据变化时总是重置练习队列，避免切卷残留旧队列
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
            if (!tabs.value.some(t => t.key === activeTab.value)) activeTab.value = (tabs.value[0] && tabs.value[0].key) || 'practice';
            sourceMetaDump({ source: 'local', url: cached.url, fetchedAt: cached.fetchedAt });
            remoteUrl.value = cached.url || '';
            loadWrongbook();
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
          viewVersion: '1.0.0',
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
        let arr = bank.value.slice();
        if (shufflePolicy.value) arr = arr.sort(() => Math.random() - 0.5);
        practiceQueue.value = Leitner.createQueue(arr);
        practiceShowAnswer.value = false;
      }
      function mark(remembered) {
        const cur = practiceCard.value;
        if (remembered) {
          Leitner.markPass(practiceQueue.value);
        } else {
          Leitner.markFail(practiceQueue.value);
          if (cur) Wrongbook.add(cur, 'practice', null, false);
        }
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
        pool = pool.slice().sort(() => Math.random() - 0.5);
        catPool.value = pool;
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
      function isObjective(rawType) {
        return rawType === 'true_false' || rawType === 'single_choice' || rawType === 'multi_choice';
      }
      function judgeObjective(cur) {
        if (cur.rawType === 'true_false') return (catChoice.value === 'true') === !!cur.answer;
        if (cur.rawType === 'single_choice') return catChoice.value === cur.answer;
        if (cur.rawType === 'multi_choice') {
          const std = (Array.isArray(cur.answer) ? cur.answer : []).slice().sort().join(',');
          const sel = catMultiSel.value.slice().sort().join(',');
          return sel === std && sel !== '';
        }
        return false;
      }
      function catSubmit() {
        const cur = catCurrent.value;
        if (!cur || catRevealed.value) return;
        if (isObjective(cur.rawType)) {
          finishCatAnswer(judgeObjective(cur));
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
          catWrongItems.value.forEach(it => Wrongbook.add(it, 'exam', null, false));
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
        if (remembered) {
          const r = Leitner.markPass(wrongPracticeQueue.value);
          // 连续答对 4 次掌握：自动移出错题本
          if (r && r.mastered) {
            Wrongbook.removeByItem(r.card.it);
            loadWrongbook();
          }
        } else {
          Leitner.markFail(wrongPracticeQueue.value);
        }
        wrongPracticeShow.value = false;
      }
      function startWrongExam(items) {
        if (!items.length) return;
        catPool.value = items.slice().sort(() => Math.random() - 0.5);
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
        practiceQueue, practiceShowAnswer, practiceCard, practiceMastered, practiceProgress,
        passLabel, failLabel, totalQuestions, tabs,
        previewRevealed,
        catStage, catSelected, catInput, catChoice, catMultiSel, catRevealed, catFeedback,
        catPool, catIndex, catStats, catWrongItems, catError, catCurrent, catNextLabel, hasPrevCat, catElapsed, catTypes, catAllSelected,
        showCustomForm, customForm,
        wrongEntries, wrongTab, wrongCount, wrongFiltered, wrongItems, wrongBySource,
        wrongPracticeQueue, wrongPracticeShow,
        showAiPanel, aiPrompt, aiCopied,
        fetchUrl, refresh, applyPaste, clearAndReload, onDragOver, onDragLeave, onDrop, onFileChange,
        downloadCurrent, copyCurrent, downloadRules, switchPaper, switchTab,
        resetPractice, mark, togglePreview, addPreviewToWrongbook,
        toggleCatType, selectAllTypes, startCat, catSubmit, catSelfJudge, catNext, catPrev,
        toggleCatMulti, catOptionClick, isCatOptionOn, catRestart, addCustomQuestion, isObjective,
        sourceLabel,
        loadWrongbook, wrongRemove, wrongClear, startWrongPractice, wrongMark, startWrongExam,
        copyAiPrompt, downloadAiPrompt
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
