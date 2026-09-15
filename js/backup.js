/**
 * MemoDeck · 数据备份与恢复
 * 挂载到 window.ExamBackup
 *
 * 导出：把所有 localStorage 键打包成一个 JSON Blob → 触发 a[download]
 * 导入：file input 选 JSON → 解析 → 校验 → 覆盖/合并写入
 *
 * 导出格式（带 metadata，向前兼容）：
 *   {
 *     "memodeckVersion": "2.x",
 *     "schema": 1,
 *     "exportedAt": "2026-09-15T10:00:00.000Z",
 *     "storage": {
 *       "examBankCache:v2": { ...raw value... },
 *       "examProgress:v1":   { ...raw value... },
 *       "examSession:v1":    { ...raw value... },
 *       "examSettings:v1":   { ...raw value... },
 *       "examWrongbook:v1":  { ...raw value... },
 *       "examWrongbook:v2":  { ...raw value... },
 *       "examLeitnerQueue:v1": { ...raw value... }
 *     }
 *   }
 *
 * 策略：只导出/导入以 `exam` 开头的键（干净、不影响其它应用）
 */
(function (global) {
  'use strict';

  const PREFIX = 'exam';
  // 从 config.js 统一版本源读取
const EXPORT_VERSION = (window.MEMODECK_VERSION && window.MEMODECK_VERSION.BACKUP) || '2.0';
  const EXPORT_SCHEMA = 1;

  // —— 内部：收集所有 exam* 键 ——
  function collect() {
    var obj = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k || k.indexOf(PREFIX) !== 0) continue;
      var raw = localStorage.getItem(k);
      try { obj[k] = raw ? JSON.parse(raw) : null; }
      catch (e) { obj[k] = raw; /* 非 JSON 原始值，原样存 */ }
    }
    return obj;
  }

  function exportPayload() {
    return {
      memodeckVersion: EXPORT_VERSION,
      schema: EXPORT_SCHEMA,
      exportedAt: new Date().toISOString(),
      storage: collect()
    };
  }

  // —— 导出：生成 JSON 并触发下载 ——
  function exportBackup() {
    var payload = exportPayload();
    var json = JSON.stringify(payload, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    a.href = url;
    a.download = 'MemoDeck-backup-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    return payload;
  }

  // —— 导入校验 ——
  function validate(data) {
    if (!data || typeof data !== 'object') return '备份文件不是有效的 JSON 对象';
    if (!data.storage || typeof data.storage !== 'object') return '备份文件缺少 storage 字段';
    if (data.schema && data.schema > EXPORT_SCHEMA) return '备份版本过高，请先升级 MemoDeck';
    return null;
  }

  /**
   * 导入备份
   * @param {File|string|object} source
   * @param {object} [opts]
   * @param {'replace'|'merge'} [opts.mode='merge']  replace=先清所有 exam* 键再写入；merge=逐个覆盖
   * @returns {Promise<{ok:boolean, msg:string, keys:number}>}
   */
  function importBackup(source, opts) {
    opts = opts || {};
    var mode = opts.mode || 'merge';

    return new Promise(function (resolve, reject) {
      // source 是 File
      if (source && typeof File !== 'undefined' && source instanceof File) {
        var reader = new FileReader();
        reader.onload = function () {
          try { finish(reader.result); }
          catch (e) { reject({ ok: false, msg: '文件解析失败：' + e.message }); }
        };
        reader.onerror = function () { reject({ ok: false, msg: '文件读取失败' }); };
        reader.readAsText(source);
        return;
      }
      // source 是 string JSON
      if (typeof source === 'string') { finish(source); return; }
      // source 已经是 object
      if (source && typeof source === 'object') { finish(JSON.stringify(source)); return; }
      reject({ ok: false, msg: '不支持的 source 类型' });

      function finish(text) {
        var data = typeof text === 'string' ? JSON.parse(text) : text;
        var err = validate(data);
        if (err) { reject({ ok: false, msg: err }); return; }

        var keys = Object.keys(data.storage);
        if (mode === 'replace') {
          // 清所有 exam* 键
          var toDelete = [];
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (k && k.indexOf(PREFIX) === 0) toDelete.push(k);
          }
          toDelete.forEach(function (k) { localStorage.removeItem(k); });
        }

        // 写入
        var written = 0;
        keys.forEach(function (k) {
          if (data.storage[k] === null || data.storage[k] === undefined) {
            localStorage.removeItem(k);
          } else {
            localStorage.setItem(k, JSON.stringify(data.storage[k]));
          }
          written++;
        });

        resolve({
          ok: true,
          msg: '成功导入 ' + written + ' 个数据键',
          keys: written
        });
      }
    });
  }

  /**
   * 清空所有 exam* 键（危险！）
   */
  function clearAll() {
    var removed = [];
    for (var i = localStorage.length - 1; i >= 0; i--) {
      var k = localStorage.key(i);
      if (k && k.indexOf(PREFIX) === 0) {
        localStorage.removeItem(k);
        removed.push(k);
      }
    }
    return removed;
  }

  global.ExamBackup = {
    EXPORT_VERSION, EXPORT_SCHEMA,
    collect, exportPayload, exportBackup,
    validate, importBackup,
    clearAll
  };
})(typeof window !== 'undefined' ? window : globalThis);
