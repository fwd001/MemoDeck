/**
 * 考试记忆系统 · 核心纯逻辑（无 DOM / Vue 依赖）
 * 挂载到 window.ExamCore
 * 职责：题型注册表、格式识别、归一化、题目条目构建
 */
(function (global) {
  'use strict';

  // 题型注册表（可扩展：新增题型在此加一行）
  const TYPE_REGISTRY = {
    fill_blank:         { label: '填空题', order: 1 },
    true_false:         { label: '判断题', order: 2 },
    single_choice:      { label: '单选题', order: 3 },
    multi_choice:       { label: '多选题', order: 4 },
    essay:              { label: '问答题', order: 5 },
    special_fill_blank: { label: '专项题', order: 6 }
  };

  function isLegacyFormat(data) {
    return data && typeof data === 'object' && !Array.isArray(data) &&
      Object.keys(data).some(k => data[k] && data[k].questions);
  }

  function normalizeLegacyQuestion(item, type, group) {
    const q = { id: item.id, type, group, question: (item.question_template || item.question), explanation: item.explanation };
    if (type === 'fill_blank' || type === 'special_fill_blank') {
      q.blanks = (item.blanks || []).map((b, i) => ({ index: i + 1, answer: b.answer }));
    } else if (type === 'true_false') {
      // 兼容多种「正确」表示：布尔 true / '√' / '对' / '正确'
      q.answer = item.answer === true || item.answer === '√' || item.answer === '对' || item.answer === '正确';
    } else if (type === 'single_choice' || type === 'multi_choice') {
      q.options = item.options || {};
      q.answer = item.answer;
    } else {
      q.answer = item.answer;
    }
    return q;
  }

  function normalizeQuestion(item) {
    if (!item || typeof item !== 'object') throw new Error('题目必须是对象。');
    const q = { id: item.id, type: item.type, group: item.group, question: item.question, explanation: item.explanation };
    if (item.type === 'fill_blank' || item.type === 'special_fill_blank') {
      q.blanks = (item.blanks || []).map((b, i) => ({ index: b.index || i + 1, answer: b.answer }));
    } else if (item.type === 'true_false') {
      q.answer = !!item.answer;
    } else if (item.type === 'single_choice' || item.type === 'multi_choice') {
      q.options = item.options || {};
      q.answer = item.answer;
    } else {
      q.answer = item.answer; // 未知题型兜底
    }
    return q;
  }

  /**
   * 归一化：把任意合法输入统一为 { meta, features, papers }
   * 兼容：新标准(view=exam-bank + papers)、顶层 papers 数组、旧格式(卷子键 + 分题型对象)
   */
  function normalizeBank(input) {
    let src = input;
    if (typeof src === 'string') {
      try { src = JSON.parse(src); } catch (e) { throw new Error('无效的 JSON 字符串：' + e.message); }
    }
    if (!src || typeof src !== 'object') throw new Error('JSON 必须是对象。');

    if (src.view === 'exam-bank' && Array.isArray(src.papers)) {
      const papers = src.papers.map(p => ({
        id: p.id, name: p.name || String(p.id),
        questions: (p.questions || []).map(normalizeQuestion)
      }));
      if (!papers.length) throw new Error('papers 为空。');
      return { meta: src.meta || {}, features: src.features || {}, papers };
    }

    if (Array.isArray(src)) {
      const papers = src.map(p => ({
        id: p.id, name: p.name || String(p.id),
        questions: (p.questions || []).map(normalizeQuestion)
      }));
      if (!papers.length) throw new Error('papers 为空。');
      return { meta: {}, features: {}, papers };
    }

    if (isLegacyFormat(src)) {
      const typeMap = {
        '填空题': 'fill_blank', '判断题': 'true_false', '单项选择题': 'single_choice',
        '多项选择题': 'multi_choice', '问答题': 'essay', '专项题': 'special_fill_blank'
      };
      const order = ['填空题', '判断题', '单项选择题', '多项选择题', '问答题', '专项题'];
      const papers = Object.keys(src).map(volKey => {
        const vol = src[volKey] || {};
        const questions = [];
        order.forEach(g => ((vol.questions && vol.questions[g]) || []).forEach(it => questions.push(normalizeLegacyQuestion(it, typeMap[g], g))));
        return { id: volKey, name: vol.paper_name || volKey, questions };
      });
      return { meta: {}, features: {}, papers };
    }

    throw new Error('无法识别该 JSON 格式（缺少 papers 数组或旧版卷子结构）。');
  }

  function optionsText(options) {
    if (!options || typeof options !== 'object') return '';
    return Object.keys(options).map(k => `${k}. ${options[k]}`).join('\n');
  }

  // 渲染答案（供展示；未知题型兜底）
  function renderAnswer(item) {
    if (item.type === 'fill_blank' || item.type === 'special_fill_blank') return (item.blanks || []).map(b => b.answer);
    if (item.type === 'true_false') return item.answer ? '正确' : '错误';
    if (item.type === 'single_choice') return (item.answer && item.options && (item.answer in item.options)) ? `${item.answer}. ${item.options[item.answer]}` : (item.answer || '');
    if (item.type === 'multi_choice') return Array.isArray(item.answer) ? item.answer.join(', ') : (item.answer || '');
    return item.answer || '';
  }

  /**
   * 构建题目条目（供记忆闯关 / 摸底速览 / 分类考试 / 错题本复用）
   * 返回结构完整的条目：保留 rawType / answer / blanks / options / explanation
   */
  function buildItems(normalized, paperId) {
    const paper = normalized.papers.find(p => String(p.id) === String(paperId)) || normalized.papers[0];
    if (!paper) return [];
    const sorted = paper.questions.slice().sort((x, y) => {
      const ox = (TYPE_REGISTRY[x.type] && TYPE_REGISTRY[x.type].order) || 99;
      const oy = (TYPE_REGISTRY[y.type] && TYPE_REGISTRY[y.type].order) || 99;
      if (ox !== oy) return ox - oy;
      return (x.id || 0) - (y.id || 0);
    });
    return sorted.map(item => {
      const typeLabel = (TYPE_REGISTRY[item.type] && TYPE_REGISTRY[item.type].label) || item.type;
      let question = item.question || '';
      if (item.type === 'single_choice' || item.type === 'multi_choice') {
        question = item.question + '\n' + optionsText(item.options);
      }
      return {
        id: item.id,
        rawType: item.type,
        typeLabel: typeLabel,
        group: item.group || typeLabel,
        question: item.question || '',
        q: question,                       // 渲染题干（含选项拼接）
        a: renderAnswer(item),             // 渲染答案
        answer: item.answer,               // 原始标准答案
        blanks: item.blanks || null,
        options: item.options || null,
        explanation: item.explanation || '',
        paper: paper.name
      };
    });
  }

  global.ExamCore = {
    TYPE_REGISTRY, normalizeBank, normalizeQuestion, buildItems, optionsText, isLegacyFormat, renderAnswer
  };
})(window);
