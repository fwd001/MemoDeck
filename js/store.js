/**
 * 考试记忆系统 · 本地存储层
 * 挂载到 window.ExamStore
 * 职责：题库缓存 + 错题本 的 localStorage 读写
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'examBankCache:v2';   // 题库缓存（存原始 JSON，data 结构不变，无需升版）
  const WRONGBOOK_KEY = 'examWrongbook:v1'; // 错题本
  const LEGACY_KEYS = ['examBankCache:v1', 'examBankCache:v0'];

  function read(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }
  function remove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }

  // 题库缓存
  function readCache() { return read(STORAGE_KEY); }
  function writeCache(envelope) { return write(STORAGE_KEY, envelope); }
  function clearCache() { remove(STORAGE_KEY); }
  function clearLegacyCache() { LEGACY_KEYS.forEach(remove); }

  // 错题本
  function readWrongbook() { const wb = read(WRONGBOOK_KEY); return (wb && Array.isArray(wb.entries)) ? wb : { entries: [] }; }
  function writeWrongbook(wb) { return write(WRONGBOOK_KEY, wb); }
  function clearWrongbook() { remove(WRONGBOOK_KEY); }

  global.ExamStore = {
    STORAGE_KEY, WRONGBOOK_KEY,
    readCache, writeCache, clearCache, clearLegacyCache,
    readWrongbook, writeWrongbook, clearWrongbook
  };
})(window);
