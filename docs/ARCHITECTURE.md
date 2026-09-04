# ExamMemory · 架构设计

> 面向二次开发者的实现说明。只想用这个项目？请看 [README.md](../README.md) 和 [使用说明](./USAGE.md)。

## 一、设计约束（一切的起点）

这个项目有三个硬约束，决定了全部技术选型：

| 约束 | 来源 | 带来的取舍 |
|---|---|---|
| **双击 `index.html` 即可用** | 使用者不一定有 Node / 服务器 | 不能用 ES Module（`file://` 下 CORS 会拦截），不能用构建工具 |
| **完全离线** | 内网 / 无网环境 | Vue 必须本地化，不能依赖 CDN |
| **题库由 JSON 驱动** | 题目来自不同考试科目 | 应用不能写死题型，必须注册表化 + 归一化 |

结论：**无构建步骤的纯静态应用**，用普通 `<script>` 标签 + `window` 全局命名空间组织模块。这不是偷懒，是 `file://` 兼容性的唯一可行解。

## 二、模块划分

```
window
├── EXAM_CONFIG    config.js       运行配置（远程题库地址 / JSON 管理服务入口）
├── DEFAULT_BANK   default-bank.js 内置兜底题库（window 全局，供离线首启）
├── Vue            vendor/         Vue 3.5.13 全局构建（生产版）
├── ExamCore       js/core.js      纯逻辑：格式识别、归一化、条目构建
├── ExamStore      js/store.js     localStorage 读写
├── ExamLeitner    js/leitner.js   Leitner 间隔重复算法
├── ExamWrongbook  js/wrongbook.js 错题本数据操作
├── ExamAIPrompt   js/ai-prompt.js AI 转换提示词文本
└── （Vue app）    js/app.js       Vue 应用：全部状态与交互
```

**加载顺序**（`index.html` 底部，顺序不可调换）：

```
default-bank.js → config.js → vendor/vue.global.prod.js
→ js/core.js → js/store.js → js/leitner.js → js/wrongbook.js → js/ai-prompt.js
→ js/app.js
```

分层原则：`js/core.js`、`js/leitner.js`、`js/store.js`、`js/wrongbook.js` **不依赖 DOM 和 Vue**，可以单独在 Node 里跑单元测试；只有 `js/app.js` 碰 Vue 和界面。

## 三、数据流

```
                    ┌──────────────────┐
   内置题库 ────────▶│                  │
   data.json ───────▶│  normalizeBank() │──▶ { meta, features, papers }
   远程 URL ────────▶│   （core.js）     │            │
   粘贴文本 ────────▶│                  │            ▼
   拖拽/选择文件 ───▶└──────────────────┘      buildItems(bank, paperId)
                                                     │
                                                     ▼
                                              条目数组 items[]
                                              { id, rawType, typeLabel, q, a,
                                                answer, blanks, options,
                                                explanation, paper }
                                                     │
                        ┌────────────┬───────────────┼────────────┐
                        ▼            ▼               ▼            ▼
                    记忆闯关      摸底速览        分类考试      错题本
                  (Leitner 队列) (顺序展示)    (筛选+随机)   (独立存储)
```

**数据源优先级**：localStorage 缓存 > `data.json`（仅 http/https）> 内置兜底题库。

`file://` 下浏览器禁止 `fetch` 本地文件，所以 `data.json` 自动加载只在 http/https 生效——这不影响使用，缓存和手动导入两条路依然畅通。

## 四、核心模块详解

### 4.1 `core.js` —— 归一化是全局基石

所有入口（导入 / 缓存 / 内置）的 JSON 都要先过 `normalizeBank()`，它把三种形态统一成 `{ meta, features, papers }`：

| 输入形态 | 识别条件 | 说明 |
|---|---|---|
| **标准格式** | `view === 'exam-bank'` 且 `papers` 是数组 | 推荐，见 [EXAM_JSON_SPEC.md](./EXAM_JSON_SPEC.md) |
| **顶层数组** | 根节点是数组 | 数组元素按 paper 解析 |
| **旧版格式** | 存在含 `questions` 的顶层键 | 卷子键 + 分题型对象，自动映射中文题型名 |

归一化后再由 `buildItems()` 生成渲染条目，四个 Tab 复用同一份条目结构。

**题型注册表** `TYPE_REGISTRY` 是唯一的题型声明处：

```js
const TYPE_REGISTRY = {
  fill_blank:         { label: '填空题', order: 1 },
  true_false:         { label: '判断题', order: 2 },
  single_choice:      { label: '单选题', order: 3 },
  multi_choice:       { label: '多选题', order: 4 },
  essay:              { label: '问答题', order: 5 },
  special_fill_blank: { label: '专项题', order: 6 }
};
```

新增题型只需在这里加一行，并在 `normalizeQuestion()` / `renderAnswer()` 里补分支。未知题型不会崩，会兜底显示题干和 `answer`。

### 4.2 `leitner.js` —— 间隔重复

```
INTERVALS   = [5, 10, 18]   // 连续答对 1/2/3 次后，插入位置距队首的间隔
MASTER_AT   = 4             // 连续答对 4 次判定掌握，移出队列
MIN_FAIL_GAP= 5             // 答错后至少埋到 5 张之后（+0~2 随机）
```

- `markPass(card)` → `streak + 1`；达 4 次返回 `{ mastered: true }` 并剔除；否则按 `INTERVALS[streak-1]` 重新插入队列。
- `markFail(card)` → `streak = 0`，埋到 `5 + rand(0..2)` 张之后。

队列是纯数据（卡片数组 + 每张卡的 `streak`），不碰 DOM，因此可单测。

### 4.3 `store.js` / `wrongbook.js` —— 持久化

| Key | 内容 |
|---|---|
| `examBankCache:v2` | `{ source, url, data, savedAt }` 题库缓存信封 |
| `examWrongbook:v1` | 错题条目数组 |

错题条目带 `source` 字段（`practice` / `preview` / `exam`），错题本据此分三个来源 Tab 展示。

### 4.4 `app.js` —— Vue 应用

使用 Vue 3 组合式 API + `setup()`，**模板留在 `index.html` 里**（in-DOM template），逻辑全在 `app.js`。这样改界面不用碰 JS，改逻辑不用碰 HTML。

## 五、模板书写约定（重要）

> **模板属性值内一律不要写 `>` 或 `=>`。**

原因是本项目在开发过程中被 HTML 处理工具（Ardot 设计工具）自动注入过 `data-page-node-id` 属性，该工具的注入逻辑有缺陷，会把属性插入到属性值内部的 `>` 和 `=>` 中间，例如：

```html
<!-- 期望 -->
<div v-if="papers.length > 1">
<!-- 被破坏成 -->
<div v-if="papers.length data-page-node-id="xxx" > 1">
```

Vue 编译直接报错，页面白屏，且生产版 Vue 会吞掉错误信息，极难排查。

**正确做法**：把含 `>` / `=>` 的表达式抽成 computed 或 method。

```js
// ✅ 安全
const hasMultiplePapers = computed(() => currentBank.value.papers.length > 1);
const wrongItems        = computed(() => wrongEntries.value.map(e => e.item));
```

```html
<div v-if="hasMultiplePapers">…</div>
<button @click="startWrongPractice(wrongItems)">…</button>
```

现存的安全替身：`hasMultiplePapers`、`wrongItems`、`catNextLabel`。

## 六、样式约定

`css/style.css` 单文件，遵循：

- **移动优先**：媒体查询用 `max-width` 向下覆盖，每个栅格都能塌缩为单列
- **触摸目标 ≥ 44×44px**，相邻目标间距 ≥ 8px
- **可见焦点态**：统一 `:focus-visible` 描边，键盘可达一切交互元素
- **尊重 `prefers-reduced-motion`**：动画降级为无过渡
- **背景不用纯白/纯灰**：渐变打底营造纵深

## 七、调试技巧

生产版 Vue 会吞掉模板编译错误，**排查白屏时临时把 `index.html` 里的 `vendor/vue.global.prod.js` 换成 dev 版**，然后在控制台执行：

```js
DevVue.compile(document.querySelector('#app').innerHTML)
```

能直接拿到出错的表达式。

## 八、已知边界

- **多卷筛选**：多卷时只能在数据源面板切换卷，分类考试内未做卷级筛选（默认题库是单卷，价值有限）。
- **远程导入依赖 CORS**：目标服务器不允许跨域时，改用「粘贴 JSON」或「选择文件」。
- **`file://` 下无 `data.json` 自动加载**：浏览器限制，属预期行为。
