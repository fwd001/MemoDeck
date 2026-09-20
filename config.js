/**
 * MemoDeck · 运行配置 + 版本号（全项目统一来源）
 *
 * ⚠️ 升级版本要同步三处：本文件的 APP_VERSION、index.html 的 <meta name="version">、
 *    service-worker.js 的 VERSION。
 *    前两者之外之所以要重写一遍：SW 是独立 worker，读不到 window；HTML meta 是静态的。
 *    这个手工清单由 CI 的「检查版本号三处一致」兜底，漏改会直接拦下。
 *
 *    default-bank.js / history-example.json 里的 viewVersion 是【数据格式版本】，
 *    与应用版本解耦，独立升级。
 */
window.EXAM_CONFIG = {
  /**
   * 默认远程题库地址。
   * 部署到 http(s) 环境时，应用会优先尝试加载该地址；加载失败自动回退到内置题库。
   * file:// 协议下不会发起该请求（浏览器限制 fetch 本地文件）。
   * 留空字符串可完全禁用自动远程拉取。
   */
  defaultRemoteUrl: './data.json',

  /**
   * JSON 管理服务的入口地址（可选功能）。
   * - 留空：页面隐藏「🛠 JSON 管理服务」按钮，不影响其它功能。
   * - 填写：填写完整的 http(s) 地址，例如 'https://json.example.com/'。
   * 注意：仅在内网 / 自建环境使用，请勿把内网 IP 提交到公开仓库。
   */
  jsonManagerUrl: '',

  /* ============================================================
   * 版本号（升级时只改这三个值）
   * ============================================================ */

  /** MemoDeck 应用版本 — 语义化 SemVer，也是 SW 缓存命名空间
      ⚠️ 必须与 index.html 的 <meta name="version"> 和 service-worker.js 的 VERSION
         完全一致；CI 的「版本号三处一致」检查会拦住不同步的提交。 */
  APP_VERSION: '2.1.0',
  /** 备份文件 schema 版本 — 用于导出/导入时判断是否需要迁移 */
  BACKUP_VERSION: '2.0',
  /** 题库 JSON (exam-bank) 格式版本 — ai-prompt.js / FALLBACK_RULES / app.js 自动读取
     已有题库数据文件（default-bank.js / history-example.json）保持各自 viewVersion 不变 */
  VIEW_VERSION: '1.0.0'
};

// 便捷命名空间：后面所有 JS 文件直接用 window.MEMODECK_VERSION.APP 等
window.MEMODECK_VERSION = {
  APP:    window.EXAM_CONFIG.APP_VERSION,
  BACKUP: window.EXAM_CONFIG.BACKUP_VERSION,
  VIEW:   window.EXAM_CONFIG.VIEW_VERSION
};
