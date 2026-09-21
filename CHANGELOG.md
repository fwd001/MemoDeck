# 更新日志

本项目所有版本均遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [2.1.0] - 2026-09-20

移动端考试体验修复 + 重复逻辑收敛。起因是手机上实测「考试点几下就不对」与
「卡片左右滑会挡住上下滑」两个反馈，随后对全项目做了一次审计。

### 修复

- **移动端纵向滚动被滑动手势吞掉**：模板上的 `@touchmove.prevent` 修饰符会无条件
  `preventDefault`，让 `app.js` 里的轴优先判断形同虚设——卡片高达 945px 而 `overflow: hidden`，
  手机上根本滚不到题干下半截。改为 `touch-action: pan-y pinch-zoom` + 一次性轴锁定。
- **客观题白送分**：判断题 `answer=false` 时 `(null==='true')===false` 返回 `true`，
  交白卷也能拿到这道题的分（实测 13 题卷交白卷得 1 分）。判分合并为唯一实现
  `judgeObjective()` 并加未作答守卫。
- **模拟考试主观题一律计错**：答了的填空/简答也被记为答错、写进度、进错题本，而成绩页
  没有任何自评入口——对以填空题为主的题库，正确率被系统性压低。
- **模拟考试未作答的题被当成答错批量塞进错题本**：交白卷实测污染 12 条。现未作答不计分、
  不写进度、不入库，成绩页单列「未作答」区；正确率分母改为已判分题数。
- **首页统计「待复习」超过题库总题数**：`weak` 把重叠维度 `due` 也加了进去
  （实测 13 题全错一遍显示 26）。
- **按天统计跨日界错位**：`_dayKey` 用 UTC 日界而趋势桶用本地日生成，东八区用户
  每天 00:00–07:59 的学习被记到前一天，影响 7 天趋势与「本周活跃天数」。
- **恢复点跨模式顶包**：`hasResume` 不分模式，且 `studyResume()` 漏了 `rp.mode` 校验，
  「练习」留下的会话会在「学习」页顶出「上次学习还没做完」。
- **开始一种模式会顶掉另一种模式的进度**：`examSession:v1` 只有一个恢复点槽位，
  「学习」暂停后去开「练习」，学习进度就被覆盖没了。改为按模式分桶（存储内部 version 2，
  读取时自动迁移旧的单槽数据），三种模式各自保留未完成的会话，互不影响。
- **恢复点位置从不持久化**：`touchResumePoint()` 只刷新时间戳，`currentIndex` 永远停在 0，
  「继续上次」每次都从第 1 题重来。
- **模拟考试退出即毁卷**：无二次确认直接清空全部作答；且考试从不写恢复点，与 README 声称的
  「考试会话恢复」相反。现退出改为暂停保留、支持从考试页续答，交卷/放弃时清除。
- **错题本三个来源 Tab 漏掉 `study` / `exercise`**：在学习或练习里答错的题只在「全部」可见，
  且标签漏出英文原词、无对应配色。改为来源注册表派生 Tab，默认停在「全部」。
- **首页错题数读的是迁移快照而非真相源**：`dashboard` 读 `examWrongbook:v2`（仅加载时写一次），
  运行时错题全写在 `:v1`，导致角标显示 2、首页显示 0。
- **简答题无法换行**：三个模式的快捷键不判断事件来源，`textarea` 里回车被吞掉并跳题。
- **移动端考试底栏遮挡与隐形点击层**：固定操作栏压住最后一个选项；答题卡收起态只有
  `opacity:0`，仍有约 60px 透明面板拦截点击、且上百个题号按钮留在键盘 Tab 序列里。
- **移动端 Tab 触摸目标 36px**，违反 README/ARCHITECTURE/DEPLOYMENT 三处声明的 44px；
  提到 44px 后改为单行横向滚动，避免 8 个 Tab 折成 4 行吃掉首屏。
- **`index.html` 末尾内联脚本被截断**（`e0f72e5` 引入），数组与闭合标签丢失，
  `window.FALLBACK_RULES` 恒为 `undefined`，`file://` 场景下载「JSON 规则」得到空文件。
- **PWA 预缓存漏 `js/backup.js`**：完全离线冷启动时备份/恢复整块功能不可用。
- **`manifest.json` 三个桌面快捷方式全部失效**：应用从不读 `location.hash`，三个入口都只
  会打开首页；第二个的 url/description 也指错模式。
- **首页快捷入口跳错 Tab**：「模拟考试」跳到分类考试、「摸底速览」跳到模拟考试。
- **取题计数与实际队列不一致**：学习/练习的「将学习 N 题」不应用每次数量的截断；
  自定义范围填 `start>end` 时徽标显示正数而队列为空；错题本徽标算全部错题数而排队只取本卷。
- **选项徽标不是圆（全站 `min-width` 被静默吃掉）**：`tokens.css` 的 flex 防溢出兜底写成
  `#app *`，特异度 `(1,0,0)` 比任何组件规则都高，于是 6 处 `min-width` 声明全部失效——
  分类考试的 A/B/C 徽标被压成 10.5×26 的竖椭圆，成绩卡（110px）、答案序号（40px）、
  远程导入输入框（桌面 220px / ≤600px 100%）、Tab 角标（18px）同样被压。
  改为零特异度的 `* > *`，兜底范围不变、组件声明重新生效。
  ⚠️ 副作用：移动端「数据管理」里的远程导入输入框现在按作者本意独占整行，三个按钮换到下一行。
- **语义色填充面上的白字对比度不达标**：答对/答错徽标、`记住了 / 没记住` 按钮、错题角标、
  到期徽章、答题卡当前格、toast 错误态、自评估按钮 hover 等 11 处，白字压 `--success`
  (#34C759) 只有 **2.22:1**、压 `--danger` (#FF3B30) **3.55:1**，深色模式因语义色更亮反而更差
  （2.02 / 3.41）。这些文字是 11–16px 加粗，按 WCAG 不算「大文本」，适用 4.5:1 那一档。
  修法走双档：浅色模式新增「承载文字的填充档」`--success-fill` #1E7A32 / `--danger-fill`
  #D70015（实测 5.41 / 5.38:1），深色模式把 `--on-accent` 压成近黑（实测 5.76–10.39:1）。
  品牌蓝 `--primary` 压白字 4.02:1 按决定保留，作为已知偏差写进 ARCHITECTURE。
  顺带删掉两条与基线同值的空 hover（`.md-study-pass-btn:hover` / `.md-study-fail-btn:hover`）
  和 `.btn.good` / `.btn.bad` 被写两遍的背景声明。
  CI 新增第 9 步「检查对比度不变量」：禁止硬编码白色前景（必须 `--on-accent`）、禁止把
  `--success` / `--danger` 直接当填充底（纯装饰条走白名单）。正向通过；在临时副本里注入
  两处违规均被准确报出并 exit 1。
- **移动端模拟考试卡片错位**：`.md-exam-main` 在 `@media (max-width: 760px)` 里改成
  `flex-direction: column`，但行方向遗留的 `align-items: flex-start` 没跟着改 —— 列方向下它
  的意思是「不拉伸交叉轴」，实测题目卡只有 309.6px 而容器 358px 且左贴边。改为 `stretch`
  （卡片与答题卡切换条都撑满 358px）；同时 `.md-exam-question` 的 `flex: 1`（= `flex-basis:0`）
  在列方向压的是高度，改成 `flex: 1 1 auto`。
- **移动端答题卡最后一行被操作栏盖住**：`.md-exam-sheet` 写死 `bottom: 60px`，而底部操作栏
  实际占到底边 78px（padding 10+10 + 按钮 44 + 边框 2 + 离底 12），且操作栏 z-index 更高。
  改为 `bottom: calc(78px + env(safe-area-inset-bottom, 0px))`。
- **固定底栏没做刘海屏安全区**：`.md-study-footer` / `.md-exam-footer` / `.md-exam-sheet` /
  `.toast` 的 `bottom` 全部补上 `+ env(safe-area-inset-bottom, 0px)`，两处底部留白
  （`.md-study-stage` / `.md-exam-main` 的 `padding-bottom`）同步跟上 —— `body` 上的
  `padding-bottom: env(...)` 对 `position: fixed` 无效，而 manifest 是 `display: standalone`。
- **顶部没有让出刘海/状态条安全区**：`viewport-fit=cover` + `display: standalone` 下首屏
  header 会顶进状态条。`#app` 的 `padding-top` 改为 `calc(16px + env(safe-area-inset-top, 0px))`
  （底部同类问题上一轮已修，顶部是漏掉的另一半）。
- **移动端答题卡题号格子只有 20–27px**：`@media` 里把网格固定成 `repeat(10, 1fr)`，
  实测格子 27.5px（390 宽）/ 20.5px（320 宽），远低于项目自己声明的 44px 触摸目标。
  改为 `repeat(auto-fill, minmax(44px, 1fr))`，列数随宽度自适应 —— 实测格子
  46.8px（390）/ 51px（358）/ 55.8px（320）。
  （顺带纠正我上一版写进 ARCHITECTURE 的错误结论：我当时说移动端「5 列会自然长到
  48–53px」，实际上移动端早被改成 10 列了，那句话是错的，现已按实测改写。）
- 移动端全量复查（390px 与 320px 两档，各功能都在**运行态**下扫）：8 个入口无横向溢出
  （`scrollWidth` 与容器等宽）、无其它「列方向不拉伸」错位；错题本含数据时来源 Tab 与状态
  分布正常；考试交卷后的成绩卡纵向排布、130px 环形正确率、未作答单列均正常。
- **系统深色 + 手动选浅色时，深色底色漏进浅色界面**：`tokens.css` 的
  `@media (prefers-color-scheme: dark)` 组件硬编码块没有 `data-theme` 守卫，里面是写死的
  深色 rgba，于是远程导入输入框、粘贴框、切卷下拉、今日进度条、拖拽区在「系统 dark +
  用户手动 light」下会顶着深色底。7 条选择器统一加 `html:not([data-theme="light"])` 前缀
  （auto 模式下 `applyTheme` 是移除属性，所以 auto 与手动 dark 两种情况仍照常命中）。
- **分类考试的题号徽标和练习/模拟考试长得不一样**：26px vs 24px、`--surface-2` vs
  `--fill-primary`、14px vs 13px，而且只有练习/考试在移动端降到 22px、分类考试不降。
  统一为 24px（≤600px 降到 22px）+ `--fill-primary` + `vertical-align: middle`。
- **14 处背景声明从未生效**：`--surface-sub` 被引用 14 次却全站没有定义，无 fallback 的
  `var()` 让整条 `background` 在 computed-value 阶段静默失效——练习/考试的选项行、禁用的
  填空/简答输入框、若干小徽标全是透明底。`.toast` 同理引用了未定义的 `--on-primary`，
  浅色主题下蓝底上顶着继承来的深色文字。两个 token 补进 `tokens.css`
  （`--surface-sub` 走 `--fill-secondary`，明暗两套自动跟随），CI 新增「CSS 变量必须有定义」检查。
- **题号标签压住题干**（我上一轮引入的回归）：删除确认无用的 `.md-exercise-card-head .tag`
  时只删了选择器列表里的一行，留下悬空逗号，`.tag { position: static }` 被并给了下一条的
  `.question`，标签退回绝对定位 —— 实测「填空题」标签与「第 1 题」重叠 41%，PC 与移动端都在。
  已整块还原为独立规则，重叠检测恢复为空。教训写进 ARCHITECTURE §6
- **移动端顶部 Tab 首尾各被切一刀**：`.tab-nav` 在横向滚动态下仍保留基线的
  `justify-content: center`，溢出量被均分到两侧、负方向滚不回去（实测第一个 Tab 在
  `scrollLeft=0` 时位于 `left: -184.6px`，容器宽 358 而内容宽 575）。改为 `flex-start`
  并加 `scroll-padding-inline`，实测首尾均完整可见、最后一个 Tab 可滚到。

### 新增

- **hash 深链**：`#/study` `#/exam` 等直达对应入口，刷新不再退回首页（同时让 manifest
  shortcuts 真正可用）。
- **`js/queue.js`（`ExamQueue`）纯逻辑模块**：三套逐字重复的取题管线（范围→题型→排序→
  截断）收敛为一处，依赖全部由调用方注入，可在 Node 单测。
- **`test/queue.test.js` 21 项**，含 48 个 (scope × strategy × perSession) 组合的
  不变式遍历：`queueCountOf() === buildQueueGids().length`。
- **`EXAM_JSON_SPEC.md` 新增 §3.2 判分规则**：此前全仓库没有任何一处定义「怎么算对」，
  规范只讲数据结构、测试没有一条判分断言——这正是白送分 bug 能长期存在的土壤。

### 变更

- **作答控件收敛为一套共享组件**：分类考试的 `.option-btn` / `.opt-key` 与练习、模拟考试的
  `.md-exercise-option` / `.md-exercise-opt-key` / `.md-exercise-tf*` / `.md-exercise-feedback*`
  合并为 `components.css` 里的 `.md-opt-list` / `.md-opt` / `.md-opt-key` / `.md-tf` /
  `.md-tf-btn` / `.md-feedback`，状态语义统一为 `selected` → `correct` → `wrong`。
  顺带修掉四处不一致：分类考试选项没有 `:focus-visible` 焦点环、`:hover` 在禁用态仍生效、
  判断题按钮在分类考试里是另一套 `.btn good/bad` + `picked`（现与其它模式同款中性按钮 +
  `selected`，`picked` 规则随之成为死代码并删除）、反馈条 `.feedback.ok` 的边框与背景同色
  （等于没有边框，现改用 `--success-border` / `--danger-border`）。
- 移除模板里 5 处**从未有定义**的类：`md-home-quick`、`md-home-trend`（首页两张卡片上的
  空修饰符）、`resume-actions` ×3（恢复横幅的按钮组包装）。它们在六份 CSS 里一条规则都
  没有，纯粹是「看着像有样式」的误导源。元素本身保留，布局不变。
- **补齐触摸目标（iOS HIG 44×44pt）**：项目文档一直声明「触摸目标 ≥ 44px」，实际有 6 类
  交互控件低于这个值 —— `.btn.small`(32)、`.btn-text`(32)、`.wb-tabs button`(40)、
  `.md-study-per .per-chip`(≈29 无 min-height)、`.paper-switch select`(40)、
  `.cat-type-select`(40)。移动端补偿集中写在 `responsive.css` 的 600px 块（与既有
  `.tab-nav button` 同一套做法，桌面指针操作不强行放大）；两个 select 直接按 44 全局设，
  与相邻的 `.btn` / `.src-actions input` 对齐。答题卡题号是有意例外（桌面 5 列约 32px
  走指针，移动端面板变宽后自然到 48–53px）。
- 输入框合并为一份实现：练习与考试的 `.md-exercise-blank-input` / `.md-exercise-essay-input`
  和分类考试（还兼着手动录题表单）的 `.cat-answer-input`，统一为 `components.css` 的
  `.md-field`（多行加 `.tall`），10 处模板同步。合并时暴露并修掉一个特异度坑：
  `tokens.css` 里 `input[type="text"] / textarea / select` 基础档的特异度是 `(0,1,1)`，
  反而吃掉 `(0,1,0)` 组件类的边框与禁用态（`.md-field` 的边框在 `<input>` 上不生效），
  现整体包进 `:where(...)` 归零 —— 与 `#app *` 那次是同一个坑的第二个变体。
- 颜色 token 收口：新增 `--on-accent`（填充 accent 之上的前景色），替换全站 13 处硬编码
  `color: #fff`；上一版临时命名的 `--on-primary` 一并改名，因为它实际也用在 success /
  danger 底上。取值不变（`#FFFFFF`），纯改名 + 去硬编码，改对比度从此只动一处。
- 断点覆盖整理（部分）：作答控件的移动端紧凑档从 `pages.css` 移进 `responsive.css`，与共享
  组件的分工对齐；新组件的颜色全部走 token，无一处硬编码。`pages.css` 仍留 3 处页面级
  `@media`（首页 / 学习 / 考试），逐条核对过没有被后面的基础规则同特异度顶掉，要不要一并
  收拢待定。
- 会话计时器 `makeSessionTimer`、滑动手势 `makeSwipe` 各收敛为一份实现（原本三处、两处）。
- `examSession:v1` 内部结构由单槽升级为按模式分桶（`version: 2`），旧数据读取时自动归位，
  不需要手动迁移；`touchResumePoint()` 增加必填的 mode 参数。新增 3 项用例覆盖分桶隔离、
  「touch 只写自己的桶」与 v1→v2 迁移。
- `_examPersist()` 不再为拿 `startedAt` 回读存储，直接用内存里的 `examStartAt`（续答时它已
  由 `examResume()` 还原成原开始时间），考试页每次跳题少一次读写解析。
- CI 改为跑满三个套件（此前只跑 `core.test.js`，`extensions.test.js` 里一条红断言在主分支
  上躺了 5 天没人发现）；本地与 CI 共用 `npm test`。
- 消除测试时间炸弹：`computeWeekTrend` 断言原本把日期写死，只在它被写下的那天能过。
- `js/app.js` 净减约 195 行；新增纯逻辑层与可单测边界写入 `ARCHITECTURE.md`。
- 删除死代码：`css/style.css`（273 行，v1 单文件遗留，长期不被 `index.html` 引用）、
  `.feedback-pass` / `.feedback-fail` 动画（注释说「mark 后由 js 加 class」，实际从无 JS 应用）、
  `index.html` 里 184 个 `data-page-node-id`（外部工具残留，无代码读取）；
  CI「关键文件完整」检查由 `css/style.css` 改盯六件套 CSS。
- 删掉 3 条**永不命中**的空状态图标规则（`section[v-show*="wrongbook"] .empty-hint::before`
  与摸底速览/分类考试两条）：Vue 把 `v-show` 编译成 `style`，DOM 里根本没有该属性
  （实测 `document.querySelectorAll('[v-show]').length === 0`），所以那三个场景的专属插画
  从未出现过，只剩默认的书本图标。默认图标保留。
- **外壳图标从 emoji 换成矢量符号表**：`index.html` 新增 `<svg class="icon-defs">` 符号表
  （13 个 24×24 线性图标，`stroke: currentColor`，与首页空状态插画同一套画法），Tab 栏 8 个
  入口与主题切换三枚按钮改用 `<use href="#i-<tabKey>">`。彩色 emoji 是「这是个网页 / 这是个
  原型」最强的信号之一，而且 emoji 不跟随主题与文字色（深色模式下截图里那排彩色图标明显浮在
  界面上）。题库 `features[].icon` 仍然优先（给了就用，没给才用矢量图标），所以外部题库的
  自定义入口名/图标契约没变；`default-bank.js` 的 `features.practice.icon: "🕹️"` 删掉，
  否则 8 个 Tab 里 7 个线性 + 1 个彩色 emoji 比全用 emoji 更难看。
  实测 1280×900 明/暗两档：8 个 Tab 全部渲染 `<svg>`、`emojiLeft: false`、图标 16.1px、
  条高 44px；`npm test` 88 项全绿。
- **原生感基线（第一轮：去掉浏览器默认行为留下的网页痕迹）**，集中在 `tokens.css` 新增的
  「原生观感基线」一节，全部走零特异度选择器（`:where` / `*`），组件规则随时可覆盖：
  界面外壳不可选中与长按（按钮 / Tab / 标签 / 表头 / 标题 / `label` / `summary`，并配
  `-webkit-touch-callout: none`），表单控件与题干文本重新放行（实测 `.btn`/`.header h1`/
  `.tab-nav button`/`.tag` 计算值为 `none`，`input`/`textarea` 为 `text`，`.question` 为 `auto`）；
  滚动条改为悬在内容边缘的 3px 细条、不占布局宽度（Windows Chrome 的 17px 常驻轨道是最难藏的
  网页痕迹，`.tab-nav` 原有的完全隐藏仍生效）；`overscroll-behavior-y: none` 关掉橡皮筋与
  下拉刷新；`text-size-adjust: 100%` 关掉 iOS 的自动字号放大；全局 `-webkit-tap-highlight-color:
  transparent`（原来只有 `.btn` 和两个作答控件有）。
- `setup()` 返回值瘦身：删掉 18 个模板从不引用的绑定（返回值只服务模板，应用没有 `this.`，
  用不上就是死重），含 write-only 的 `exerciseStudentAnswer` 与只声明未使用的 `showCustomForm`。
- 深色模式的重复覆盖收拢：`tokens.css` 的 `@media dark` 块与 `themes.css` 的手动 dark 块里，
  有 6 条规则只是把基线在深色下的同一个值重写一遍（`.tab-nav`、`.tab-nav button.active`、
  `textarea.paste-box`、`.paper-switch select`、`.md-home-today-bar`、`:focus-visible` 那组——
  例如写死的 `rgba(118,118,128,.24)` 就是深色 `--fill-primary`），删掉后两块只剩真正不同的
  3 条。实测手动 dark 下各元素计算值与删除前逐一相同。
- CSS 去重：`tokens.css` 里与 `accessibility.css` 完全相同的 `prefers-reduced-motion` 块、
  重复的 `* { box-sizing: border-box }`、一条指向不存在的规则的 `.md-exercise-card-head .tag`、
  以及一段下面没有规则的孤立注释，全部删掉（实测行为不变：box-sizing 仍全局生效）。

### 文档

- `ARCHITECTURE.md`：补齐 v2 六个模块与真实加载顺序、条目结构、8 个存储键、错题判重键
  与五种来源、移除阈值（连续答对 3 次，非「即清除」）、六件套样式与两条新踩的硬规则、
  「两套掌握模型并存」与已知边界。
- `README.md` / `USAGE.md`：四个模式更正为八个入口，错题移除规则按代码实际行为重写。
- `EXAM_JSON_SPEC.md`：修正把 `exam` 键标成「摸底速览」的错误（应用里 `exam`=模拟考试、
  `preview`=摸底速览），并写明目前只有 `practice`/`preview` 两个 `features` 键被真正消费。

## [2.0.0] - 2026-09-16

> 本节为补记。当时版本号已同步到三处（`config.js`、`index.html`、`service-worker.js`），
> 但 CHANGELOG 一直没写，`CHANGELOG.md` 停在 1.0.0 + 一节 Unreleased。

**Design System + PWA + 学习进度层**（`615ae7f`、`e0f72e5`）

- 样式由单文件 `css/style.css` 重构为六件套：`tokens` / `components` / `pages` /
  `responsive` / `themes` / `accessibility`，含深色模式与 auto/light/dark 主题切换
- PWA：`manifest.json` + `service-worker.js`（HTML network-first、静态资源 cache-first +
  stale-while-revalidate）、品牌图标、`display: standalone`
- 新增五个纯逻辑模块：`progress.js`（跨会话 SRS，连对 5 次掌握）、`session.js`（恢复点 /
  分段 / 每日任务）、`stats.js`（首页聚合）、`migration.js`（v1→v2 迁移）、`backup.js`
  （全量导出与合并/覆盖导入）
- 新增首页 / 学习 / 练习 / 模拟考试四个 Tab，与 v1 四模式并存
- 版本号统一由 `config.js` 提供 `APP_VERSION` / `BACKUP_VERSION` / `VIEW_VERSION`

以下条目原属 `[Unreleased]`，随 2.0.0 一并发布：

### 变更

- **记忆闯关掌握判定**：取消「连续答对 4 次才算掌握」，改为**记住一次即掌握**，进度条当场前移；没记住的卡埋到 5~7 张之后才可能再出现（`js/leitner.js` 简化为 pass=剔除 / fail=埋卡）
- **错题本实时入库 + 全局去重**：闯关「没记住」、考试答错即时写入错题本（不等流程结束，中途退出不丢）；同题跨来源只保留一条，来源刷新为最新出错场景（`js/wrongbook.js` `add()` 改为按 id+rawType 全局判重）
- **错题移除规则收紧**：题只在错题本内被清除——练习中点「记住了」、重考答对、手动移除/清空；在其它模式答对不再自动移除
- **AI 提示词改为弹窗**：由页面底部常驻面板改为居中弹窗，点遮罩/「✕ 关闭」退出

### 新增

- 分类考试填空题（多空）答案框下新增 **「｜ 插入分隔符」**按钮，一键在光标处插入 `|`，无需手动输入符号

### 测试

- 单元测试随新语义更新：Leitner 改为「一次掌握 + 埋卡间隔」断言；错题本增加跨来源全局去重用例
- 新增 `js/utils.js`（shuffle / groupBy，语义对齐 lodash、零依赖）的 4 项用例 —— **26 项全绿**

### 工程

- 评估后不引入 lodash 全量（约 530KB，与纯离线/零依赖定位冲突）；改为自建轻量工具集
  `js/utils.js`（约 2KB），替换 app.js 中 3 处手写洗牌（含不均衡的 `sort(()=>Math.random()-0.5)`）
  与 2 处手写分组逻辑，业务行为不变
- **GitHub Pages 上线**：Settings → Pages → Source 切换为 `GitHub Actions`，`.github/workflows/deploy.yml`
  跑通（第 2 次部署即成功）；线上 **https://fwd001.github.io/MemoDeck/** 已验证 HTTP 200，之后推 `main` 自动更新
- 部署实战记录与排障经验写入 `docs/DEPLOYMENT.md` 3.5 节；README 顶部新增「在线体验」入口

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
