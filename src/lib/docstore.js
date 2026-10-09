/* TED 双语字幕 —— 每个演讲一份字幕文档（IndexedDB）
 * 单一事实来源：cues:[{start,end,en,zh}]，识别只写 en、翻译只写 zh，字段级合并。
 * 仅在扩展环境（后台/扩展页/offscreen）使用；content script 因跨源原因走消息调用。
 */
(function (root) {
  'use strict';
  const TEDL = (root.TEDL = root.TEDL || {});
  const DB_NAME = 'tedl';
  const STORE = 'docs';

  let _db = null;

  function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (resolve, reject) {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = function () {
        const db = r.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'talkId' });
      };
      r.onsuccess = function () {
        _db = r.result;
        resolve(_db);
      };
      r.onerror = function () {
        reject(r.error);
      };
    });
  }

  function close() {
    if (_db) {
      try {
        _db.close();
      } catch (e) {}
      _db = null;
    }
  }

  /** 关闭并删除整个字幕库（清除所有历史字幕/翻译） */
  function destroy() {
    close();
    return new Promise(function (resolve) {
      const r = indexedDB.deleteDatabase(DB_NAME);
      r.onsuccess = function () {
        resolve();
      };
      r.onerror = function () {
        resolve();
      };
      r.onblocked = function () {
        resolve();
      };
    });
  }

  function req(r) {
    return new Promise(function (resolve, reject) {
      r.onsuccess = function () {
        resolve(r.result);
      };
      r.onerror = function () {
        reject(r.error);
      };
    });
  }

  /* ---------- 纯函数（可单测） ---------- */

  function startKey(ms) {
    return Math.round((Number(ms) || 0) / 50) * 50; // 50ms 归并，容忍细微时间差
  }

  /** 合并英文轨道：以 incoming 更新 en，保留已有 zh，不删除已有的句子 */
  function mergeEn(existing, incoming) {
    const map = new Map();
    (existing || []).forEach(function (c) {
      map.set(startKey(c.start), { start: c.start, end: c.end, en: c.en || '', zh: c.zh || '' });
    });
    (incoming || []).forEach(function (c) {
      const k = startKey(c.start);
      const cur = map.get(k);
      if (cur) {
        if (c.en) cur.en = c.en;
        if (c.end) cur.end = c.end;
      } else {
        map.set(k, { start: c.start, end: c.end, en: c.en || '', zh: '' });
      }
    });
    return Array.from(map.values()).sort(function (a, b) {
      return a.start - b.start;
    });
  }

  /** 写入中文：pairs=[{en,zh}]，按英文原文匹配填入 zh */
  function applyZh(cues, pairs) {
    const m = new Map();
    (pairs || []).forEach(function (p) {
      if (p && p.en) m.set(p.en, p.zh || '');
    });
    (cues || []).forEach(function (c) {
      const z = m.get(c.en);
      if (z) c.zh = z;
    });
    return cues;
  }

  /* ---------- 文档读写 ---------- */

  async function get(talkId) {
    const db = await openDB();
    const s = db.transaction(STORE, 'readonly').objectStore(STORE);
    const doc = await req(s.get(String(talkId)));
    return doc || null;
  }

  async function _patch(talkId, mut) {
    const db = await openDB();
    return new Promise(function (resolve, reject) {
      const t = db.transaction(STORE, 'readwrite');
      const s = t.objectStore(STORE);
      const g = req(s.get(String(talkId)));
      g.then(function (existing) {
        const doc = existing || {
          talkId: String(talkId),
          title: '',
          cues: [],
          meta: {},
          created: Date.now(),
        };
        mut(doc);
        doc.updated = Date.now();
        const p = req(s.put(doc));
        p.then(function () {
          resolve(doc);
        }).catch(reject);
      }).catch(reject);
    });
  }

  /** 用识别（英文）结果更新：只动 en，保留 zh */
  function patchEn(talkId, payload) {
    return _patch(talkId, function (doc) {
      if (payload.title) doc.title = payload.title;
      doc.cues = mergeEn(doc.cues, payload.cues);
      doc.meta = Object.assign({}, doc.meta, payload.meta || {});
    });
  }

  /** 写入翻译：只动 zh */
  function patchZh(talkId, pairs) {
    return _patch(talkId, function (doc) {
      doc.cues = applyZh(doc.cues, pairs);
      doc.meta = Object.assign({}, doc.meta, { zhUpdated: Date.now() });
    });
  }

  /** 种子：官方字幕（en+zh）一次性写入 */
  function seed(talkId, title, cues, meta) {
    return _patch(talkId, function (doc) {
      if (title) doc.title = title;
      doc.cues = mergeEn(doc.cues, cues);
      doc.cues = applyZh(
        doc.cues,
        (cues || []).map(function (c) {
          return { en: c.en, zh: c.zh };
        })
      );
      doc.meta = Object.assign({}, doc.meta, meta || {});
    });
  }

  async function remove(talkId) {
    const db = await openDB();
    const s = db.transaction(STORE, 'readwrite').objectStore(STORE);
    await req(s.delete(String(talkId)));
  }

  async function list() {
    const db = await openDB();
    const s = db.transaction(STORE, 'readonly').objectStore(STORE);
    const all = await req(s.getAll());
    return all || [];
  }

  TEDL.docstore = {
    open: openDB,
    close: close,
    destroy: destroy,
    get: get,
    seed: seed,
    patchEn: patchEn,
    patchZh: patchZh,
    remove: remove,
    list: list,
    mergeEn: mergeEn,
    applyZh: applyZh,
    startKey: startKey,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { mergeEn: mergeEn, applyZh: applyZh, startKey: startKey };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
