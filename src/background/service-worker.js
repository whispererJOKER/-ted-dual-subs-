/* TED 双语字幕 —— 后台 Service Worker
 * 职责：1) 词典查询（含缓存/词形回退） 2) AI 兜底翻译（OpenAI 兼容接口）
 */
'use strict';

importScripts('../lib/docstore.js');

const DICT_CACHE_KEY = 'tedl_dict_cache';
const AI_CACHE_KEY = 'tedl_ai_cache';
const INTRO_CACHE_KEY = 'tedl_intro_cache';
const DICT_MAX = 500;
const AI_MAX = 3000;
const TRANS_MAX_TRIES = 3; // 单句翻译最多尝试次数，超过视为敏感/不可翻
const transAttempts = new Map(); // 英文句 -> 已尝试次数（后台全局）

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

async function loadMap(key) {
  const got = await chrome.storage.local.get(key);
  return got[key] && typeof got[key] === 'object' ? got[key] : {};
}
async function saveMap(key, map) {
  await chrome.storage.local.set({ [key]: map });
}
function trimMap(map, max) {
  const keys = Object.keys(map);
  if (keys.length <= max) return map;
  const sorted = keys.sort((a, b) => (map[a].t || 0) - (map[b].t || 0));
  const drop = sorted.slice(0, keys.length - max);
  drop.forEach((k) => delete map[k]);
  return map;
}

/* ---------------- 词典 ---------------- */

function simplifyWord(w) {
  const forms = [];
  const add = (x) => {
    if (x && x !== w && x.length > 1) forms.push(x);
  };
  if (/ies$/.test(w)) add(w.slice(0, -3) + 'y');
  if (/(es)$/.test(w)) add(w.slice(0, -2));
  if (/s$/.test(w)) add(w.slice(0, -1));
  if (/ied$/.test(w)) add(w.slice(0, -3) + 'y');
  if (/ed$/.test(w)) {
    add(w.slice(0, -2));
    add(w.slice(0, -1));
  }
  if (/ing$/.test(w)) {
    add(w.slice(0, -3));
    add(w.slice(0, -3) + 'e');
  }
  return forms;
}

/* ---------------- 词典（中国快的「有道」为主，英文词典兜底） ---------------- */

function parseDefs(lines, word, phonetic) {
  const clean = (lines || []).filter((x) => x && x.trim());
  if (!clean.length) return null;
  const meanings = [];
  for (const line of clean) {
    const s = String(line).trim();
    if (!s) continue;
    const pm = s.match(/^([a-zA-Z]+\.(?:\s*[a-zA-Z]+\.)?)\s*(.*)$/);
    const pos = pm ? pm[1] : '';
    const rest = pm ? pm[2] : s;
    const defs = rest
      .split(/[；;]/)
      .map((d) => d.trim())
      .filter(Boolean);
    if (pos || defs.length) meanings.push({ pos, defs: defs.slice(0, 5) });
  }
  if (!meanings.length) return null;
  return {
    word,
    phonetic: phonetic ? '/' + String(phonetic).replace(/^\/|\/$/g, '') + '/' : '',
    meanings: meanings.slice(0, 3),
    audio: 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(word) + '&type=2',
  };
}

async function youdaoLookup(word) {
  const dicts = encodeURIComponent(JSON.stringify({ count: 99, dicts: [['ec', 'ce']] }));
  const url =
    'https://dict.youdao.com/jsonapi_s?q=' +
    encodeURIComponent(word) +
    '&le=en&dicts=' +
    dicts;
  try {
    const r = await fetch(url, { credentials: 'omit', headers: { referer: 'https://dict.youdao.com/' } });
    if (!r.ok) return null;
    const j = await r.json();
    const ec = j && j.ec;
    if (ec && Array.isArray(ec.word) && ec.word[0]) {
      const it = ec.word[0];
      const lines = [];
      (it.trs || []).forEach((t) => {
        (t.tr || []).forEach((t2) => {
          const arr = t2.l && t2.l.i;
          if (Array.isArray(arr)) arr.forEach((x) => x && lines.push(String(x)));
        });
      });
      return parseDefs(lines, word, it.usphone || it.phonetic || '');
    }
    const simple = j && j.simple;
    if (simple && Array.isArray(simple.word) && simple.word[0]) {
      return parseDefs([], word, simple.word[0].usphone || '');
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function youdaoSuggestLookup(word) {
  const url =
    'https://dict.youdao.com/suggest?num=5&ver=3&doctype=json&cache=true&q=' + encodeURIComponent(word);
  try {
    const r = await fetch(url, { credentials: 'omit', headers: { referer: 'https://dict.youdao.com/' } });
    if (!r.ok) return null;
    const j = await r.json();
    const first = j && j.data && j.data.entries && j.data.entries[0];
    if (first && first.explain) return parseDefs([first.explain], word, '');
    return null;
  } catch (e) {
    return null;
  }
}

async function englishApiLookup(word) {
  try {
    const res = await fetch(
      'https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word),
      { credentials: 'omit' }
    );
    if (!res.ok) return null;
    const arr = await res.json();
    return parseDictEntry(word, arr);
  } catch (e) {
    return null;
  }
}

function parseDictEntry(word, arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  const e = arr[0];
  let phonetic = e.phonetic || '';
  if (!phonetic && Array.isArray(e.phonetics)) {
    const p = e.phonetics.find((x) => x && x.text);
    if (p) phonetic = p.text;
  }
  const meanings = [];
  (e.meanings || []).forEach((m) => {
    const defs = (m.definitions || []).slice(0, 2).map((d) => d.definition).filter(Boolean);
    if (defs.length) meanings.push({ pos: m.partOfSpeech || '', defs });
  });
  return {
    word: e.word || word,
    phonetic: phonetic ? '/' + String(phonetic).replace(/^\/|\/$/g, '') + '/' : '',
    meanings: meanings.slice(0, 3),
    audio: Array.isArray(e.phonetics)
      ? (e.phonetics.find((x) => x && x.audio) || {}).audio || ''
      : '',
  };
}

async function dictLookup(word) {
  const w = String(word || '').toLowerCase().replace(/[^a-z'-]/g, '');
  if (!w) return { ok: false, error: 'empty' };
  const cache = await loadMap(DICT_CACHE_KEY);
  const ck = 'en:' + w;
  if (cache[ck] && cache[ck].data) return { ok: true, cached: true, data: cache[ck].data };

  const candidates = [w].concat(simplifyWord(w));
  for (const cand of candidates) {
    // 主源：有道（快、中文释义），英文词典兜底
    const parsed =
      (await youdaoLookup(cand)) || (await youdaoSuggestLookup(cand)) || (await englishApiLookup(cand));
    if (!parsed) continue;
    parsed.query = w;
    parsed.matched = cand;
    cache[ck] = { t: Date.now(), data: parsed };
    trimMap(cache, DICT_MAX);
    await saveMap(DICT_CACHE_KEY, cache);
    return { ok: true, detected: true, data: parsed };
  }
  return { ok: false, error: 'not_found', word: w };
}

/* ---------------- AI 翻译 ---------------- */

async function translateBatch(texts, cfg) {
  const numbered = texts.map((t, i) => i + 1 + '. ' + t).join('\n');
  const body = {
    model: cfg.model,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          '你是专业的字幕翻译。用户给出编号的英文句子，请逐条翻译成简体中文。' +
          '只输出与输入相同数量的行，每行格式为「编号. 译文」，不要输出任何解释或多余内容。',
      },
      { role: 'user', content: numbered },
    ],
  };
  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (cfg.apiKey || ''),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('AI 接口返回 ' + res.status + ' ' + t.slice(0, 200));
  }
  const data = await res.json();
  const content =
    data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content || ''
      : '';
  const out = new Array(texts.length).fill('');
  content.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*(\d+)\s*[.、)]\s*(.+?)\s*$/);
    if (!m) return;
    const idx = parseInt(m[1], 10) - 1;
    if (idx >= 0 && idx < out.length && !out[idx]) out[idx] = m[2];
  });
  return out;
}

async function aiTranslate(texts, cfg) {
  if (!cfg || !cfg.baseUrl || !cfg.model) {
    return { ok: false, error: 'AI 未配置（缺少 Base URL 或模型名）' };
  }
  const cache = await loadMap(AI_CACHE_KEY);
  const result = new Array(texts.length).fill('');
  const todoIdx = [];
  const todoText = [];
  texts.forEach((t, i) => {
    const key = hashStr(cfg.model + '|zh|' + t);
    if (cache[key] && cache[key].v) result[i] = cache[key].v;
    else {
      todoIdx.push(i);
      todoText.push(t);
    }
  });

  const CHUNK = 25;
  let failed = 0;
  let firstError = null;

  async function tryT(list) {
    try {
      return await translateBatch(list, cfg);
    } catch (e) {
      if (!firstError) firstError = String(e.message || e);
      return null;
    }
  }
  function bump(items) {
    items.forEach(function (it) {
      transAttempts.set(it.text, (transAttempts.get(it.text) || 0) + 1);
    });
  }

  // 策略：整批翻译；缺的句子「逐句」细拆；每句最多尝试 TRANS_MAX_TRIES(=3) 次，
  // 超过即判定为敏感/不可翻，放弃，避免无休止重试。
  async function resilient(items, out) {
    if (!items.length) return;
    if (items.length === 1) {
      const it = items[0];
      while ((transAttempts.get(it.text) || 0) < TRANS_MAX_TRIES && !out[it.gi]) {
        bump([it]);
        const r = await tryT([it.text]);
        if (r && r[0]) out[it.gi] = r[0];
      }
      return;
    }
    const active = items.filter(function (it) {
      return !out[it.gi] && (transAttempts.get(it.text) || 0) < TRANS_MAX_TRIES;
    });
    if (!active.length) return;
    bump(active);
    const r = await tryT(active.map(function (it) {
      return it.text;
    }));
    if (r) {
      active.forEach(function (it, k) {
        if (r[k]) out[it.gi] = r[k];
      });
    }
    const missing = active.filter(function (it) {
      return !out[it.gi];
    });
    for (let k = 0; k < missing.length; k++) await resilient([missing[k]], out);
  }

  for (let i = 0; i < todoText.length; i += CHUNK) {
    const chunk = todoText.slice(i, i + CHUNK);
    const out = new Array(chunk.length).fill('');
    const items = chunk.map(function (t, j) {
      return { gi: j, text: t };
    });
    await resilient(items, out);
    for (let j = 0; j < chunk.length; j++) {
      const gi = todoIdx[i + j];
      const v = out[j];
      if (v) {
        result[gi] = v;
        cache[hashStr(cfg.model + '|zh|' + texts[gi])] = { v: v, t: Date.now() };
      } else {
        failed++;
      }
    }
  }
  if (todoText.length) {
    trimMap(cache, AI_MAX);
    await saveMap(AI_CACHE_KEY, cache);
  }
  return { ok: true, translations: result, failed, error: firstError };
}

/* ---------------- 片头偏移 ---------------- */

function hlsInfoFromUrl(url) {
  if (!url) return null;
  const pm = String(url).match(/project_masters\/(\d+)\//);
  const im = String(url).match(/intro_master_id=(\d+)/);
  return { projectId: pm ? pm[1] : null, introMasterId: im ? im[1] : null };
}

function introOffsetFromMetadata(meta) {
  const domains = meta && meta.domains;
  if (!Array.isArray(domains)) return 0;
  let ms = 0;
  for (let i = 0; i < domains.length; i++) {
    const d = domains[i];
    if (d && d.primaryDomain) break;
    ms += (Number(d && d.duration) || 0) * 1000;
  }
  return Math.round(ms);
}

async function getIntroOffset(hlsUrl) {
  const info = hlsInfoFromUrl(hlsUrl);
  if (!info || !info.projectId) return { ok: true, offsetMs: 0 };
  const key = info.projectId + ':' + (info.introMasterId || '');
  const cache = await loadMap(INTRO_CACHE_KEY);
  if (cache[key] != null) return { ok: true, offsetMs: cache[key], cached: true };
  const url =
    'https://hls.ted.com/project_masters/' +
    info.projectId +
    '/metadata.json' +
    (info.introMasterId ? '?intro_master_id=' + info.introMasterId : '');
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return { ok: false, offsetMs: 0, error: 'HTTP ' + res.status };
    const meta = await res.json();
    const ms = introOffsetFromMetadata(meta);
    cache[key] = ms;
    await saveMap(INTRO_CACHE_KEY, cache);
    return { ok: true, offsetMs: ms };
  } catch (e) {
    return { ok: false, offsetMs: 0, error: String(e.message || e) };
  }
}

/* ---------------- 消息路由 ---------------- */

function broadcastAll(msg) {
  try {
    chrome.tabs.query({ url: 'https://www.ted.com/talks/*' }, function (tabs) {
      (tabs || []).forEach(function (t) {
        try {
          chrome.tabs.sendMessage(t.id, msg);
        } catch (e) {}
      });
    });
  } catch (e) {}
}

function broadcastDoc(talkId) {
  broadcastAll({ type: 'docUpdated', talkId: String(talkId) });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;
  if (msg.type === 'cacheClear') {
    const keys = [
      'tedl_asr_result',
      'tedl_zh_cache',
      'tedl_ai_cache',
      'tedl_dict_cache',
      'tedl_intro_cache',
      'tedl_export_payload',
      'tedl_asr_request',
    ];
    Promise.resolve(TEDL.docstore.destroy())
      .then(function () {
        return chrome.storage.local.remove(keys);
      })
      .then(function () {
        broadcastAll({ type: 'docsCleared' });
        sendResponse({ ok: true });
      })
      .catch(function (e) {
        sendResponse({ ok: false, error: String(e) });
      });
    return true;
  }
  if (msg.type === 'docGet') {
    TEDL.docstore
      .get(msg.talkId)
      .then((doc) => sendResponse({ ok: true, doc }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === 'docSeed') {
    TEDL.docstore
      .seed(msg.talkId, msg.title, msg.cues || [], msg.meta || {})
      .then((doc) => {
        broadcastDoc(msg.talkId);
        sendResponse({ ok: true, doc });
      })
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === 'docPatchEn') {
    TEDL.docstore
      .patchEn(msg.talkId, { title: msg.title, cues: msg.cues || [], meta: msg.meta || {} })
      .then((doc) => {
        broadcastDoc(msg.talkId);
        sendResponse({ ok: true, count: (doc.cues || []).length });
      })
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === 'docPatchZh') {
    TEDL.docstore
      .patchZh(msg.talkId, msg.pairs || [])
      .then(() => {
        broadcastDoc(msg.talkId);
        sendResponse({ ok: true });
      })
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === 'dictLookup') {
    dictLookup(msg.word)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === 'getIntroOffset') {
    getIntroOffset(msg.hlsUrl)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, offsetMs: 0, error: String(e) }));
    return true;
  }
  if (msg.type === 'openExtensionPage') {
    try {
      chrome.tabs.create({ url: chrome.runtime.getURL(msg.path || '') }, function (tab) {
        sendResponse({ ok: !!tab, error: chrome.runtime.lastError ? String(chrome.runtime.lastError) : '' });
      });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
    return true;
  }
  if (msg.type === 'aiTranslate') {
    aiTranslate(msg.texts || [], msg.config || {})
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === 'aiTest') {
    translateBatch(['Hello, this is a connectivity test.'], msg.config || {})
      .then((r) => sendResponse({ ok: true, sample: r[0] || '' }))
      .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  }
  return false;
});
