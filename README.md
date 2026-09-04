<div align="center">

# MemoDeck

**考试记忆系统** · JSON 驱动的离线刷题工具

[![纯静态](https://img.shields.io/badge/构建-无构建步骤-41b883?style=flat-square)](./docs/ARCHITECTURE.md)
[![离线可用](https://img.shields.io/badge/离线-完全可用-3b82f6?style=flat-square)](./docs/DEPLOYMENT.md)
[![Vue](https://img.shields.io/badge/Vue-3.5.13-4fc08d?style=flat-square)](https://vuejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](./LICENSE)

**双击 `index.html` 就能用。** 不用装 Node，不用装依赖，不用联网，不用起服务器。

**🟢 在线体验：[https://fwd001.github.io/MemoDeck/](https://fwd001.github.io/MemoDeck/)** —— GitHub Pages 自动部署，打开即测（内容与仓库一致）

</div>

---

## 它是什么

一个把「题」和「程序」彻底分开的刷题工具。程序不认识任何一门学科，它只认识一份 JSON；你换一份 JSON，它就变成那个科目的刷题 App。

背单词、刷历史、考驾照、背法条、复习认证题库——只要能把题整理成 JSON，它就能用。配合 AI，从照片到可用题库通常只要几分钟。

## 为什么不一样

**🕹️ 真的会安排复习节奏**
不是刷完一遍就完事。记住了就当场掌握、进度前移；没记住就埋到 5~7 张之后，保证中间至少隔四五道别的题才可能再次刷到，不在同一道题上原地打转。低频打扰、高频巩固，把时间花在真正记不住的题上。

**📄 题库就是 JSON，不是数据库**
可读、可改、可 diff、可版本管理。用 AI 生成、用脚本批量处理、用 Git 追踪变更，都自然而然。

**🔌 完全离线**
Vue 已本地化到 `vendor/`，零 CDN 依赖。飞机上、内网里、U 盘里都能跑。

**🎯 考完立刻知道错在哪**
客观题答错时直接展示标准答案与解析；答对自动跳下一题，答错留在本题直到你看懂。支持回看上一题，成绩页带正确率与用时。

**📕 错题本会自己变薄**
闯关「没记住」、考试答错都会**实时**把题收进错题本（全局去重，同题只留一条），中途退出考试也不丢。题目只会在错题本里被清除——在错题本练习中点「记住了」、或重考答对，才真正移出。剩下的永远是真正没掌握的。

**🤖 内置 AI 转换提示词**
点「🤖 AI 提示词」复制，配合试卷照片丢给任意大模型，直接吐出可导入的 JSON。

---

## 快速开始

### 试用（30 秒）

1. 下载或克隆本仓库
2. **双击 `index.html`**
3. 开始刷内置的历史示例题库

### 用自己的题库（3 分钟）

1. 点右上角 **🤖 AI 提示词**，复制提示词
2. 把提示词 + 你的题目截图/文本发给任意 AI
3. 拿回 JSON，点右上角 **⚙️ 数据管理 → 📋 或粘贴 JSON 文本录入**，粘贴后点「📥 应用粘贴的 JSON」

也可以直接拖拽 `.json` 文件到虚线框，或点「点击选择文件」。参考格式见 [`history-example.json`](./history-example.json)。

> 想部署到网上给别人用？见 [部署指南](./docs/DEPLOYMENT.md)，从 GitHub Pages 到 Docker 都有。

---

## 四个模式

| | 模式 | 干什么用 | 关键机制 |
|---|---|---|---|
| 🕹️ | **记忆闯关** | 日常主刷 | 记住一次即掌握；没记住埋到 5~7 张后重来 |
| 📝 | **摸底速览** | 考前快速过一遍 | 逐题展开答案，一键加入错题本 |
| 🎯 | **分类考试** | 正式自测 | 按题型筛选、随机出题、实时判分、自动跳题 |
| 📕 | **错题本** | 攻克薄弱点 | 三来源分类、加强练习、重考答对即移除 |

---

## 题库 JSON 长什么样

```json
{
  "view": "exam-bank",
  "viewVersion": "1.0.0",
  "meta": {
    "title": "初中历史题库",
    "description": "可替换任意学科"
  },
  "features": {
    "practice": {
      "enabled": true,
      "label": "记忆闯关",
      "icon": "🕹️",
      "config": {
        "passLabel": "😎 记住了 (剔除)",
        "failLabel": "😥 没记住 (重刷)"
      }
    }
  },
  "papers": [
    {
      "id": "历史示例",
      "name": "初中历史·示例卷",
      "questions": [
        {
          "id": 1,
          "type": "fill_blank",
          "group": "填空题",
          "question": "我国有文字可考的历史开始于____朝。",
          "blanks": [{ "index": 1, "answer": "商" }]
        },
        {
          "id": 2,
          "type": "single_choice",
          "group": "单项选择题",
          "question": "秦始皇统一六国是在哪一年？",
          "options": { "A": "前230年", "B": "前221年", "C": "前210年" },
          "answer": "B",
          "explanation": "前221年秦灭齐，完成统一。"
        }
      ]
    }
  ]
}
```

### 支持的题型

| `type` | 题型 | 必需字段 |
|---|---|---|
| `fill_blank` | 填空题 | `question` + `blanks: [{index, answer}]` |
| `true_false` | 判断题 | `question` + `answer: true/false` |
| `single_choice` | 单选题 | `question` + `options: {A,B,C}` + `answer: "A"` |
| `multi_choice` | 多选题 | `question` + `options` + `answer: ["A","B"]` |
| `essay` | 问答题 | `question` + `answer: "文本"` |
| `special_fill_blank` | 专项题 | `question` + `blanks` |

未知题型不会报错，会兜底显示题干和 `answer`。

`features` 是**声明式开关**：不写或 `enabled: true` 就显示该 Tab，设为 `false` 则隐藏；`label` / `icon` / `config` 可自定义界面文案。

完整规范：[`docs/EXAM_JSON_SPEC.md`](./docs/EXAM_JSON_SPEC.md) · Schema：[`exam-bank.schema.json`](./exam-bank.schema.json)

---

## 项目结构

```
memodeck/
├── index.html              # HTML 骨架 + Vue 模板（in-DOM template）
├── config.js               # 运行配置（远程题库地址 / JSON 管理服务入口）
├── default-bank.js         # 内置兜底题库（离线首启用）
├── css/
│   └── style.css           # 全部样式（响应式 / 无障碍 / 动效降级）
├── js/
│   ├── core.js             # 纯逻辑：格式识别、归一化、题目条目构建
│   ├── store.js            # localStorage 缓存 + 错题本存储
│   ├── leitner.js          # Leitner 间隔重复算法
│   ├── wrongbook.js        # 错题本数据操作
│   ├── utils.js            # 轻量工具集（shuffle/groupBy，零依赖，对齐 lodash 语义）
│   ├── ai-prompt.js        # AI 题库转换提示词
│   └── app.js              # Vue 应用：全部状态与交互
├── vendor/
│   └── vue.global.prod.js  # 本地 Vue 3.5.13（离线依赖）
├── test/
│   └── core.test.js        # 纯逻辑单元测试（node test/core.test.js，零依赖）
├── docs/
│   ├── USAGE.md            # 使用说明
│   ├── ARCHITECTURE.md     # 架构设计（面向二次开发）
│   ├── DEPLOYMENT.md       # 部署指南
│   └── EXAM_JSON_SPEC.md   # 题库 JSON 规范
├── data.json               # 你的题库（可选，已被 .gitignore 排除）
├── history-example.json    # 示例题库
├── exam-bank.schema.json   # JSON Schema
├── Dockerfile              # nginx:alpine，约 10MB
└── LICENSE                 # MIT
```

---

## 部署

纯静态，没有构建步骤。任何能托管 HTML 的地方都行。

| 方式 | 适合场景 | 说明 |
|---|---|---|
| **双击 `index.html`** | 个人单机 | 零部署，完全离线 |
| **本地服务器** | 开发验证 | `python3 -m http.server 8000` |
| **GitHub Pages** | 公开分享 | ✅ 已启用，推到 `main` 自动部署 |
| **Nginx / Apache** | 自建服务器 | 配置见部署指南，含 CORS |
| **Vercel / Netlify** | 免运维托管 | 连接 Git 自动部署 |
| **Docker** | 容器化 | `docker build -t memodeck . && docker run -p 8080:80 memodeck` |

详细步骤与配置片段见 [部署指南](./docs/DEPLOYMENT.md)。

> 本项目已上线：**[https://fwd001.github.io/MemoDeck/](https://fwd001.github.io/MemoDeck/)**（2026-09-04 跑通，内置 13 题示例历史题库，可直接试用全部功能）。每次推送 `main` 自动更新。

---

## 文档

| 文档 | 面向 | 内容 |
|---|---|---|
| [使用说明](./docs/USAGE.md) | 使用者 | 导入题库、四个模式、AI 生成、数据存储、常见问题 |
| [部署指南](./docs/DEPLOYMENT.md) | 部署者 | 6 种部署方式、配置片段、CORS、自检清单 |
| [架构设计](./docs/ARCHITECTURE.md) | 开发者 | 模块划分、数据流、算法细节、模板书写约定 |
| [JSON 规范](./docs/EXAM_JSON_SPEC.md) | 题库作者 | 完整字段定义、题型结构、旧格式兼容 |

---

## 常见问题

**双击打开是白屏？**
检查 `css/`、`js/`、`vendor/` 是否与 `index.html` 在同一目录，相对路径不能断。另外需要支持 ES2015+ 的现代浏览器。

**放了 `data.json` 没加载？**
`file://` 协议下浏览器禁止 `fetch` 本地文件，属安全限制。用本地服务器打开，或直接拖拽文件导入。

**远程链接导入失败？**
目标服务器需允许跨域（CORS）。不允许就改用「粘贴 JSON」或「选择文件」。

**数据存在哪？**
浏览器 localStorage（`examBankCache:v2`、`examWrongbook:v1`），不上传任何服务器。换设备请用「⬇️ 下载 JSON」导出再导入。

更多见 [使用说明 · 常见问题](./docs/USAGE.md#六常见问题)。

---

## 参与开发

技术栈：Vue 3.5.13（全局构建）+ 原生 CSS + 原生 JS，**无构建工具**。

这是刻意的选择——为了保住「双击即用」这个核心体验。改动时请遵守：

1. **不引入构建步骤**，不引入 ES Module（`file://` 下会被 CORS 拦截）
2. **纯逻辑不碰 DOM/Vue**：`core.js` / `leitner.js` / `store.js` / `wrongbook.js` 保持可单测
3. **模板属性值内不写 `>` 或 `=>`**，抽成 computed（原因见 [架构设计](./docs/ARCHITECTURE.md#五模板书写约定重要)）
4. **新增题型**只改 `TYPE_REGISTRY` + `normalizeQuestion()` + `renderAnswer()`
5. 保持 44px 触摸目标、可见焦点态、`prefers-reduced-motion` 降级

本地验证：

```bash
# 单元测：纯逻辑，零依赖、零框架、零构建
node test/core.test.js

# 浏览器：起个静态服务器
python3 -m http.server 8000   # 打开 http://localhost:8000
```

推送后会跑 CI，五道检查：单元测试、JS 语法、Vue 模板表达式安全（防白屏）、关键文件完整、文档链接可达。
规则见 [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)，本地可直接复现。

---

## 许可

[MIT](./LICENSE) — 自由使用、修改、分发。

第三方依赖：[Vue.js](https://vuejs.org/) 3.5.13（MIT），已本地化在 `vendor/`。
