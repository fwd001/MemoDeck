# 更新日志

本项目所有版本均遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-09-04

首个正式版本。从「单文件 v1 骨架」重构为「纯离线、分模块、功能完整」的应用，需求文档 33 项全部落地。

### 新增

**核心能力**
- Vue 3.5.13 本地化到 `vendor/`，去除 CDN 依赖，双击 `index.html`（`file://`）即可离线运行
- Leitner 间隔重复算法：答错埋到 5~7 张之后，连续答对按 5 → 10 → 18 张间隔递增，连续 4 次判定掌握
- 题库 JSON 归一化：兼容标准格式（`view: "exam-bank"` + `papers`）、顶层 `papers` 数组、旧版卷子结构
- 声明式 `features` 配置：由 JSON 决定启用哪些模式，可自定义标签、图标、按钮文案

**四个模式**
- 🕹️ 记忆闯关：Leitner 队列 + 自评，进度条与掌握数实时更新
- 📝 摸底速览：逐题展开答案，一键加入错题本
- 🎯 分类考试：按题型筛选（多选/全选）、随机出题、实时判分、手动加题
- 📕 错题本：按来源分三档，查看 / 加强练习 / 重新考试 / 单条移除 / 清空

**数据管理**
- 五种导入方式：远程链接、粘贴 JSON、拖拽文件、选择文件、同目录 `data.json`
- 导出：下载 JSON、复制到剪贴板、下载 JSON 规则
- localStorage 缓存，优先级：缓存 > `data.json`（http/https）> 内置题库
- 一键清空缓存并重载

**AI 集成**
- 内置题库转换提示词（照片 / 文本 → exam-bank JSON），界面可复制、可下载

**交互增强（分类考试）**
- 答对后自动进入下一题（约 0.6s 延迟）
- 「← 上一题」回看已答题，通过答题快照完整恢复作答状态
- 考试中随时「✕ 退出考试」，回到设置页重新选择
- 成绩页显示正确率与用时

### 修复

- 客观题答错时未展示正确答案 —— 现在判断/单选/多选题答错会立即展示标准答案与解析
- 导出的 JSON 缺少 `view` / `viewVersion`，导致无法重新导入 —— 新增 `serializeBank()` 统一补全
- 旧版格式中判断题答案为布尔 `true` 时被误判为错误 —— 现在兼容 `true` / `'√'` / `'对'` / `'正确'`
- 切换试卷时分类考试、摸底速览状态未重置，残留旧数据 —— `switchPaper()` 现在完整重置

### 变更

- 代码从 `index.html` 拆分为 `js/core.js`、`store.js`、`leitner.js`、`wrongbook.js`、`ai-prompt.js`、`app.js` 六个模块，纯逻辑层不依赖 DOM/Vue
- 硬编码的内网 JSON 管理服务地址抽离到 `config.js`，默认值留空并隐藏对应入口

### 文档

- 新增 README、[使用说明](./docs/USAGE.md)、[架构设计](./docs/ARCHITECTURE.md)、[部署指南](./docs/DEPLOYMENT.md)、[JSON 规范](./docs/EXAM_JSON_SPEC.md)
- 新增 `Dockerfile`（nginx:alpine）、MIT LICENSE、`.gitignore`

### 工程

- 新增 `test/core.test.js`：22 项纯逻辑单元测试，覆盖题库归一化（三种输入格式）、题型渲染、
  Leitner 间隔重复、错题本去重与移除。**零依赖、零框架、零构建**，`node test/core.test.js` 直接跑
- 新增 `.github/workflows/deploy-pages.yml`：推到 `main` 自动部署 GitHub Pages
- 新增 `.github/workflows/ci.yml`：单元测试 + JS 语法 + Vue 模板表达式安全 + 关键文件完整 + 文档链接可达

---

## 已知边界

- 多卷时只能在数据源面板切换卷，分类考试内未做卷级筛选
- 远程链接导入依赖目标服务器允许 CORS
- `file://` 协议下 `data.json` 不会自动加载（浏览器安全限制）
