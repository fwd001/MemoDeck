# MemoDeck · 架构设计

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
├── EXAM_CONFIG    config.js       运行配置（远程题库地址 / JSON 管理服务入口 / 三组版本号）
├── DEFAULT_BANK   default-bank.js 内置兜底题库（window 全局，供离线首启）
├── Vue            vendor/         Vue 3.5.13 全局构建（生产版）
├── ExamCore       js/core.js      纯逻辑：格式识别、归一化、条目构建
├── ExamStore      js/store.js     localStorage 读写
├── ExamLeitner    js/leitner.js   Leitner 间隔重复算法（会话内队列）
├── ExamWrongbook  js/wrongbook.js 错题本数据操作（v2：状态机 + gid 判重）
├── ExamUtils      js/utils.js     轻量工具集（shuffle / groupBy，对齐 lodash 语义）
├── ExamQueue      js/queue.js     纯逻辑：取题管线（范围 → 题型 → 排序 → 截断）
├── ExamMigration  js/migration.js v1 → v2 一次性迁移
├── ExamProgress   js/progress.js  跨会话学习进度与复习调度（SRS）
├── ExamSession    js/session.js   恢复点、分段、每日任务生成
├── ExamStats      js/stats.js     首页与趋势的统计聚合（纯函数）
├── ExamBackup     js/backup.js    全量导出 / 合并或覆盖导入 / 清空
├── ExamAIPrompt   js/ai-prompt.js AI 转换提示词文本
└── （Vue app）    js/app.js       Vue 应用：全部状态与交互
```

**加载顺序**（`index.html` 底部，顺序不可调换）：

```
default-bank.js → vendor/vue.global.prod.js → config.js
→ core.js → store.js → leitner.js → wrongbook.js
→ migration.js → progress.js → utils.js → queue.js → ai-prompt.js
→ session.js → stats.js → backup.js → app.js
```

依赖约束：`queue.js` 用 `utils.js` 的 shuffle；`session.js` 用 `progress.js` 的
`getDueQuestions`，必须排在其后。

分层原则：`core / store / leitner / wrongbook / utils / queue / migration / progress /
session / stats` **不依赖 DOM 和 Vue**，可以单独在 Node 里跑单元测试；只有 `js/app.js`
碰 Vue 和界面。`app.js` 里凡是能脱离响应式系统成立的逻辑都往外挪——判分
（`judgeObjective`）、取题（`ExamQueue`）、统计（`ExamStats`）都有唯一实现处且可单测。

> **为什么不引 lodash**：本项目为零第三方运行时依赖（`file://` 离线 + 纯逻辑零依赖单测）。lodash 全量约 530KB，而实际只有洗牌/分组两类需求。于是自建约 2KB 的 `utils.js`，函数语义对齐 lodash 同名函数；将来确有大需求时可平滑换成 `vendor/lodash.min.js`。

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
                                                     │
                        ┌────────────┬───────────────┼────────────┐
                        ▼            ▼               ▼            ▼
                    记忆闯关      摸底速览        分类考试      错题本
                  (Leitner 队列) (顺序展示)    (筛选+随机)   (独立存储)
              v2 追加：学习 / 练习 / 模拟考试 / 首页统计
              取题统一走 ExamQueue，进度统一写 ExamProgress
```

### 3.1 条目（item）结构

`buildItems()` 产出的条目是七个模式共用的渲染单元：

```js
{ id, rawType, typeLabel, group,           // 身份与分组
  question, q,                             // 原始题干 / 渲染题干（选择题已拼上选项）
  a, answer,                               // 渲染后的答案 / 标准答案原值
  blanks, options, explanation, paper,     // 题型专属字段与出处
  paperId, gid }                           // v2：跨卷唯一标识
```

`gid = makeGlobalId(paperId, id)`，形如 `卷1::42`。**它是学习进度、恢复点、错题本判重
共用的主键**，跨卷、跨导入、跨会话稳定；不同卷里 id 相同的题 gid 不同。

### 3.2 两套"掌握"模型并存（重要）

| | 会话内 | 跨会话 |
|---|---|---|
| 模块 | `leitner.js`（记忆闯关、错题加强练习） | `progress.js`（学习 / 练习 / 模拟考试） |
| 掌握条件 | 记住一次即出队 | 连续答对 5 次 → `mastered` |
| 答错处置 | 埋到 5~7 张之后重现 | `streak` 归零，下次立即复习 |

两者互不干涉：闯关只管「这轮还出不出现」，progress 只管「什么时候该复习」。
判分行为本身另见 [EXAM_JSON_SPEC.md §3.2](./EXAM_JSON_SPEC.md)。

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

新增题型要动四处（`TYPE_REGISTRY` 只是入口，不是唯一改动点）：

1. `core.js` 的 `TYPE_REGISTRY` 加 `{ label, order }`；
2. `core.js` 的 `normalizeQuestion()` / `renderAnswer()` 补分支（决定是否带 `blanks` / `options`）；
3. `app.js` 的 `isObjective()` 与 `judgeObjective()` —— 决定它是系统判分还是用户自评；
4. `index.html` 里各模式的作答区模板，以及 setup 面板的题型勾选框（目前 6 个 key 写死在
   `studyTypes` / `exerciseTypes` / `examTypes` 与对应 `<label class="type-check">`）。

未知题型不会崩，会兜底显示题干和 `answer`；判分上按主观题走（不自判、等自评）。

### 4.2 `leitner.js` —— 记忆调度

```
MIN_FAIL_GAP = 5   // 答错后至少埋到 5 张之后（+0~2 随机），保证隔四五道题才重现
```

- `markPass(card)` → 判定掌握，恒返回 `{ mastered: true, card }`，卡片移出队列（进度前移）。
- `markFail(card)` → `streak = 0`，埋到 `5 + rand(0..2)` 张之后；当前卡被跳过，队首换成下一张。

队列是纯数据（卡片数组 + 每张卡的 `streak`），不碰 DOM，因此可单测。

### 4.3 `store.js` / `wrongbook.js` —— 持久化

| Key | 内容 | 读写方 |
|---|---|---|
| `examBankCache:v2` | `{ source, url, data, fetchedAt }` 题库缓存信封 | store.js |
| `examWrongbook:v1` | `{ entries: [...] }` **运行时错题本真相源** | wrongbook.js |
| `examWrongbook:v2` | 迁移导出格式（v1 条目的 v2 视图） | migration.js |
| `examProgress:v1` | `{ version, progress: { [gid]: ProgressEntry } }` | progress.js |
| `examSession:v1` | 恢复点（内部 version 2：按 mode 分桶 `resumes: { study, exercise, exam }`，考试桶含逐题答案快照 `answers`） | session.js |
| `examSettings:v1` | 每日学习量等设置 | session.js |
| `examLeitnerQueue:v1` | 闯关队列持久化 | leitner.js |
| `memo:theme` / `memo:showDataPanel` | 主题与数据面板开关 | app.js |

> 备份（`js/backup.js`）导出的是**以上全部 `exam*` 键**，新增存储键时必须同步进去。
>
> `examWrongbook:v2` 只由迁移写入、供导出使用；运行时一律以 `:v1` 为准。首页统计读的也是
> `:v1`（经 `Wrongbook.list()`），历史上这里错读过 v2 快照导致角标与首页对不上。

错题条目带 `source` 字段，取值即「在哪个模式答错的」，共五种：
`study`（学习）/ `exercise`（练习）/ `practice`（记忆闯关）/ `preview`（摸底速览）/ `exam`（两类考试）。
错题本按来源分 Tab，**Tab 列表由 `WRONG_SOURCES` 注册表派生**，只渲染真实有题的来源——
新增模式时改这张表即可，不要再往模板里硬写按钮。

**全局去重**：`wrongbook.add()` **优先按 `gid` 判重**（不看来源），同一道题只保留一条；
无 gid 的老数据回退到「题目 id + rawType」。重复入库时刷新来源为最新出错场景、
`wrongCount++`、`correctStreak` 归零、状态退回 `new`。

**入库时机**：闯关「没记住」、学习「还不会」、练习/考试答错、模拟考试交卷判错，都由 `app.js`
实时写入并刷新视图（不等流程跑完）。**未作答不计入错题本**。

**移除时机**：仅限错题本内部，且**连续答对 3 次才自动移出**（`Wrongbook.markCorrect`
状态机：1 次 `new`/`learning` → 2 次 `weak` → 3 次 `mastered` 并移除）；
在其它模式答对不会移除。分类考试的「重新考试」走的是另一条路：答对即 `removeByItem` 立刻移出。

### 4.4 `queue.js` —— 取题管线

学习 / 练习 / 模拟考试三个模式原本各有一份逐字重复的「范围过滤 → 题型过滤 → 排序 → 截断」，
现已收敛为 `ExamQueue`，纯函数、依赖全部由调用方经 `ctx` 注入（进度表、错题集合、到期集合、
每日任务调度），因此能在 Node 里被 `test/queue.test.js` 覆盖 21 项。

它同时钉死了这条不变式：**`queueCountOf()` 必须等于 `buildQueueGids().length`**。
界面上的「将学习 N 题」和实际排队数曾长期不一致（显示不应用每次数量的截断）。

### 4.5 `app.js` —— Vue 应用

使用 Vue 3 组合式 API + `setup()`，**模板留在 `index.html` 里**（in-DOM template），逻辑全在 `app.js`。这样改界面不用碰 JS，改逻辑不用碰 HTML。

`app.js` 内部的约定：凡是脱离响应式系统也能成立的逻辑，一律往外挪到上面那些纯模块。
留在 `app.js` 里的只有三类——ref 状态、computed、事件处理器。共享机制同样要抽干净：
判分 `judgeObjective`（四个模式一份）、会话计时器 `makeSessionTimer`（三个模式一份）、
滑动手势 `makeSwipe`（学习/练习一份）。

**Tab 与 URL**：`activeTab` 与 `location.hash` 双向同步（`#/study` 等）。
`manifest.json` 的桌面快捷方式依赖它，同时刷新页面不再退回首页。

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

v2.0 起为**六件套**（`index.html` 按此顺序引用）：

| 文件 | 职责 |
|---|---|
| `tokens.css` | Design Token、明暗两套变量、`#app`/`.container` 宽度约束 |
| `components.css` | 通用组件（按钮、面板、卡片、Tab 导航、弹窗、Toast、错题条目） |
| `pages.css` | 各页面作用域样式，按 `md-study-` / `md-exercise-` / `md-exam-` 前缀隔离 |
| `responsive.css` | 移动端断点覆盖 |
| `themes.css` | 深色模式与主题切换 |
| `accessibility.css` | `prefers-reduced-motion` 等可访问性降级 |

> v1 的单文件 `css/style.css` 已在 2.1.0 删除（长期不再被 `index.html` 引用）。

约定不变：

- **移动优先**：媒体查询用 `max-width` 向下覆盖，每个栅格都能塌缩为单列
- **触摸目标 ≥ 44×44px**，相邻目标间距 ≥ 8px（移动端 Tab 按钮已提到 44px，
  并把 8 个 Tab 改为单行横向滚动而不是折行——否则 44px 高度会把首屏吃掉一大截）
- **可见焦点态**：统一 `:focus-visible` 描边，键盘可达一切交互元素
- **尊重 `prefers-reduced-motion`**：动画降级为无过渡
- **背景不用纯白/纯灰**：渐变打底营造纵深
- **固定底栏必须配底部留白**：`.md-study-stage` / `.md-exam-main` 都留了
  `padding-bottom`，否则最后一个选项会被 `position: fixed` 的操作栏压住
- **靠 `opacity` + `transform` 隐藏的浮层必须同时置 `visibility: hidden`**，
  否则它会以透明状态继续拦截点击并留在键盘 Tab 序列里（移动端答题卡踩过这个坑）
- **全局兜底规则必须保持零特异度**：防 flex 溢出的 `min-width: 0` 早先写成 `#app *`
  （特异度 `1,0,0`，比任何组件规则都高），把全站 5 处 `min-width` 静默吃掉，徽标被压成
  竖椭圆。兜底类规则一律用 `* > *`（特异度 0），让组件的声明永远能盖过它

## 七、调试技巧

生产版 Vue 会吞掉模板编译错误，**排查白屏时临时把 `index.html` 里的 `vendor/vue.global.prod.js` 换成 dev 版**，然后在控制台执行：

```js
DevVue.compile(document.querySelector('#app').innerHTML)
```

能直接拿到出错的表达式。

## 八、已知边界

**数据与题库**
- **多卷筛选**：多卷时只能在数据源面板切换卷，各模式内未做卷级筛选（默认题库是单卷，价值有限）。
- **远程导入依赖 CORS**：目标服务器不允许跨域时，改用「粘贴 JSON」或「选择文件」。
- **`file://` 下无 `data.json` 自动加载**：浏览器限制，属预期行为；PWA 也只在 http(s) 下生效。
- **`features` 开关只对两个模式生效**：`practice` / `preview` 可被 `enabled: false` 隐藏，
  首页 / 学习 / 练习 / 模拟考试 / 分类考试 / 错题本是无条件挂载的。

**功能语义**
- **主观题没有自动判分**：填空 / 简答 / 专项题一律用户自评，`｜` 多空分隔符在判分路径上
  没有消费者（详见 EXAM_JSON_SPEC.md §3.2.2）。
- **两套"掌握"模型并存**：闯关的「一次即掌握」与 progress 的「连对 5 次」互不干涉，
  见 §3.2。这不算 bug，但意味着「掌握了多少」在两个入口下数字不同。
- **恢复点按模式分桶**：`examSession:v1` 内部为 `{ version: 2, resumes: { study, exercise, exam } }`，
  开始一种模式只会覆盖它自己的桶。旧的单槽数据（`version: 1`）在读取时归还到它自己的 mode 桶，
  下一次写入时落盘为 v2，无需手动迁移。`loadResumePoint` / `clearResumePoint` 的 `mode`
  参数决定读写哪个桶；`touchResumePoint(index, mode)` 的 mode 必填，该模式桶不存在时返回 false。

**交互**
- **卡片的左右滑动只在「看过答案 / 判过分」之后生效**，且纵向滚动始终交还浏览器
  （`touch-action: pan-y` + 一次性轴锁定）。桌面端同一段代码也接受鼠标拖拽。
- **生产版 Vue 会吞掉模板编译错误**，白屏时按 §七 换 dev 版排查。
