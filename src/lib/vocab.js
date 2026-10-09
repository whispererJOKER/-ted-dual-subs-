/* 设置与生词本的持久化（chrome.storage.local） */
(function (root) {
  'use strict';
  const TEDL = (root.TEDL = root.TEDL || {});

  const KEYS = { settings: 'tedl_settings', vocab: 'tedl_vocab' };

  const DEFAULT_SETTINGS = {
    mode: 'both', // both | en | zh | off
    zhLang: 'zh-cn', // 目标语言（中文）代码
    fontSize: 0, // 0 = 自动
    blurZh: false, // 中文遮罩自测
    autoReplay: false, // 打开页面自动暂停并逐句
    transcript: false, // 显示逐句面板
    syncScroll: true,
    offsetMs: 0, // 字幕手动微调（毫秒），正数=字幕更晚
    ai: {
      enabled: false,
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      model: 'deepseek-chat',
      asrBaseUrl: '',
      asrKey: '',
      asrModel: 'whisper-1',
      asrPath: '/audio/transcriptions',
      asrHeaders: '',
      asrLang: '',
      asrMode: 'openai',
      relayUrl: 'http://127.0.0.1:8788',
      relaySpeed: 4,
      localModel: 'whisper-tiny.en',
      localHost: 'https://hf-mirror.com',
      localDtype: 'q8',
    },
  };

  function storage() {
    return chrome.storage.local;
  }

  function deepMerge(base, patch) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    if (!patch || typeof patch !== 'object') return out;
    Object.keys(patch).forEach(function (k) {
      const v = patch[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object') {
        out[k] = deepMerge(base[k], v);
      } else {
        out[k] = v;
      }
    });
    return out;
  }

  async function getSettings() {
    const got = await storage().get(KEYS.settings);
    const saved = got[KEYS.settings] || {};
    return deepMerge(DEFAULT_SETTINGS, saved);
  }

  async function saveSettings(patch) {
    const cur = await getSettings();
    const next = deepMerge(cur, patch);
    await storage().set({ [KEYS.settings]: next });
    return next;
  }

  async function getVocab() {
    const got = await storage().get(KEYS.vocab);
    return Array.isArray(got[KEYS.vocab]) ? got[KEYS.vocab] : [];
  }

  async function setVocab(list) {
    await storage().set({ [KEYS.vocab]: list });
    return list;
  }

  function normalizeWord(w) {
    return String(w || '').toLowerCase().replace(/[^a-z'-]/g, '');
  }

  /** 收藏一个生词；已存在则更新释义/上下文 */
  async function addWord(entry) {
    const word = normalizeWord(entry.word);
    if (!word) return null;
    const list = await getVocab();
    const now = Date.now();
    const existing = list.find(function (e) {
      return e.word === word;
    });
    if (existing) {
      existing.defs = entry.defs && entry.defs.length ? entry.defs : existing.defs;
      existing.phonetic = entry.phonetic || existing.phonetic;
      existing.context = entry.context || existing.context;
      existing.count = (existing.count || 1) + 1;
      existing.updatedAt = now;
      await setVocab(list);
      return existing;
    }
    const item = {
      id: 'w_' + now + '_' + Math.random().toString(36).slice(2, 8),
      word: word,
      phonetic: entry.phonetic || '',
      defs: entry.defs || [],
      context: entry.context || '',
      talkTitle: entry.talkTitle || '',
      talkId: entry.talkId || '',
      time: entry.time || 0,
      count: 1,
      addedAt: now,
      updatedAt: now,
    };
    list.unshift(item);
    await setVocab(list);
    return item;
  }

  async function removeWord(id) {
    const list = await getVocab();
    const next = list.filter(function (e) {
      return e.id !== id;
    });
    await setVocab(next);
    return next;
  }

  async function clearVocab() {
    await setVocab([]);
  }

  function csvCell(v) {
    const s = String(v == null ? '' : v).replace(/"/g, '""');
    return '"' + s + '"';
  }

  /** 导出 CSV（Excel 友好，带 BOM） */
  function toCSV(list) {
    const header = ['word', 'phonetic', 'definition', 'context', 'talk', 'addedAt'];
    const rows = list.map(function (e) {
      return [
        e.word,
        e.phonetic || '',
        (e.defs || []).join(' | '),
        e.context || '',
        e.talkTitle || '',
        new Date(e.addedAt || Date.now()).toISOString(),
      ]
        .map(csvCell)
        .join(',');
    });
    return '\ufeff' + header.join(',') + '\n' + rows.join('\n');
  }

  /** 导出 Anki 导入用的 TSV（front \t back） */
  function toTSV(list) {
    return list
      .map(function (e) {
        const back = (e.phonetic ? '/' + e.phonetic + '/ ' : '') + (e.defs || []).join('; ');
        const ctx = e.context ? '\n' + e.context : '';
        return [e.word, (back + ctx).replace(/\t/g, ' ')].join('\t');
      })
      .join('\n');
  }

  TEDL.vocab = {
    KEYS: KEYS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    getSettings: getSettings,
    saveSettings: saveSettings,
    getVocab: getVocab,
    setVocab: setVocab,
    addWord: addWord,
    removeWord: removeWord,
    clearVocab: clearVocab,
    normalizeWord: normalizeWord,
    toCSV: toCSV,
    toTSV: toTSV,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TEDL.vocab;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
