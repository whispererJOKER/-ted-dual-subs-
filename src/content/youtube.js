/* TED 双语字幕 —— YouTube 支持（复用字形层 / 同步 / 播放控制 / 生词本） */
(function (root) {
  'use strict';
  const TEDL = (root.TEDL = root.TEDL || {});
  if (root.__TEDL_YT_LOADED__) return;
  root.__TEDL_YT_LOADED__ = true;

  const EXPORT_KEY = 'tedl_export_payload';
  const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
  const state = {
    settings: null,
    video: null,
    videoId: null,
    title: '',
    cues: [],
    overlay: null,
    sync: null,
    player: null,
    offsetMs: 0,
    injected: false,
  };

  function talkId(id) {
    return 'yt:' + id;
  }

  /** 去掉网页标题里的站点后缀（"xxx - YouTube"） */
  function cleanTitle(t) {
    return String(t || '')
      .replace(/\s*[-|–—]\s*YouTube\s*$/i, '')
      .trim();
  }

  function openExtensionPage(path) {
    try {
      chrome.runtime.sendMessage({ type: 'openExtensionPage', path: path }, function (resp) {
        if (chrome.runtime.lastError || !resp || !resp.ok) {
          try {
            window.open(chrome.runtime.getURL(path), '_blank');
          } catch (e) {}
        }
      });
    } catch (e) {
      try {
        window.open(chrome.runtime.getURL(path), '_blank');
      } catch (e2) {}
    }
  }

  function docGet(id) {
    return chrome.runtime
      .sendMessage({ type: 'docGet', talkId: talkId(id) })
      .then(function (r) {
        return r && r.ok ? r.doc : null;
      })
      .catch(function () {
        return null;
      });
  }
  function docSeed(id, title, cues, meta) {
    return chrome.runtime.sendMessage({ type: 'docSeed', talkId: talkId(id), title: title, cues: cues, meta: meta });
  }
  function docPatchZh(id, pairs) {
    return chrome.runtime.sendMessage({ type: 'docPatchZh', talkId: talkId(id), pairs: pairs });
  }

  function waitFor(fn, timeoutMs, intervalMs) {
    return new Promise(function (resolve) {
      const deadline = Date.now() + (timeoutMs || 15000);
      (function poll() {
        let r = null;
        try {
          r = fn();
        } catch (e) {
          r = null;
        }
        if (r) return resolve(r);
        if (Date.now() > deadline) return resolve(null);
        setTimeout(poll, intervalMs || 500);
      })();
    });
  }

  function findVideo() {
    return (
      document.querySelector('video.html5-main-video') ||
      document.querySelector('#movie_player video') ||
      document.querySelector('video')
    );
  }

  function currentVideoId() {
    try {
      const u = new URL(location.href);
      return u.searchParams.get('v') || '';
    } catch (e) {
      return '';
    }
  }

  /* ---------- 字幕轨抓取 ---------- */
  function inject() {
    if (state.injected) return;
    state.injected = true;
    try {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('src/content/yt-inject.js');
      s.onload = function () {
        s.remove();
      };
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  }

  function parseJson3(j) {
    const evs = (j && j.events) || [];
    return evs
      .filter(function (e) {
        return e.segs && e.segs.length;
      })
      .map(function (e) {
        return {
          startTime: e.tStartMs || 0,
          duration: e.dDurationMs || 0,
          content: e.segs
            .map(function (s) {
              return s.utf8 || '';
            })
            .join('')
            .replace(/\s+/g, ' ')
            .trim(),
        };
      })
      .filter(function (c) {
        return c.content;
      });
  }

  function parseXml(xml) {
    try {
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const nodes = doc.getElementsByTagName('text');
      const out = [];
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        const start = parseFloat(el.getAttribute('start')) || 0;
        const dur = parseFloat(el.getAttribute('dur')) || 0;
        const content = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (content) out.push({ startTime: Math.round(start * 1000), duration: Math.round(dur * 1000), content: content });
      }
      return out.length ? out : null;
    } catch (e) {
      return null;
    }
  }

  function parseCaptions(txt) {
    const s = String(txt || '').trim();
    if (!s) return null;
    if (s[0] === '{') {
      try {
        return parseJson3(JSON.parse(s));
      } catch (e) {
        return null;
      }
    }
    if (s[0] === '<') return parseXml(s);
    return null;
  }

  let _pfSeq = 0;
  const _pfWait = {};
  window.addEventListener('message', function (e) {
    if (e.source !== window) return;
    const d = e.data;
    if (d && d.source === 'tedl-yt-fetch-res' && _pfWait[d.id]) {
      const cb = _pfWait[d.id];
      delete _pfWait[d.id];
      cb(d);
    }
  });
  function pageFetch(url, timeoutMs) {
    return new Promise(function (resolve) {
      const id = 'pf' + ++_pfSeq;
      const timer = setTimeout(function () {
        delete _pfWait[id];
        resolve(null);
      }, timeoutMs || 15000);
      _pfWait[id] = function (d) {
        clearTimeout(timer);
        resolve(d && d.ok ? d.text : null);
      };
      window.postMessage({ source: 'tedl-yt-fetch', id: id, url: url }, '*');
    });
  }

  function stripSigned(baseUrl) {
    try {
      const u = new URL(baseUrl, location.origin);
      ['exp', 'xoaf', 'xowf', 'xospf', 'variant', 'pot', 'potc', 'c', 'cver', 'rn', 'alr'].forEach(function (k) {
        u.searchParams.delete(k);
      });
      return u.toString();
    } catch (e) {
      return null;
    }
  }
  function withFmt(baseUrl, fmt, tlang) {
    try {
      const u = new URL(baseUrl, location.origin);
      u.searchParams.delete('fmt');
      u.searchParams.set('fmt', fmt);
      if (tlang) u.searchParams.set('tlang', tlang);
      else u.searchParams.delete('tlang');
      return u.toString();
    } catch (e) {
      return null;
    }
  }
  function legacyUrl(videoId, lang, kind, fmt, tlang) {
    const p = new URLSearchParams();
    p.set('v', videoId);
    p.set('lang', lang);
    if (kind) p.set('kind', kind);
    p.set('fmt', fmt);
    if (tlang) p.set('tlang', tlang);
    return 'https://www.youtube.com/api/timedtext?' + p.toString();
  }

  async function tryUrl(url, debug, label) {
    if (!url) return null;
    let txt = await pageFetch(url, 8000);
    if (txt == null) {
      try {
        const res = await fetch(url, { credentials: 'include' });
        txt = await res.text();
      } catch (e) {
        if (debug) console.log('[TED双语字幕] 直连失败', label, (e && e.message) || String(e));
      }
    }
    if (txt == null) {
      try {
        const res = await fetch(url, { credentials: 'omit' });
        txt = await res.text();
      } catch (e) {}
    }
    if (txt == null) {
      if (debug) console.log('[TED双语字幕] 请求全失败', label);
      return null;
    }
    const caps = parseCaptions(txt);
    if (debug && !(caps && caps.length)) {
      console.log('[TED双语字幕] 空响应', label, 'len=' + txt.length, '预览=' + JSON.stringify(txt.slice(0, 120)));
    }
    return caps;
  }

  /** 多策略取字幕：原地址 / 去掉 PO-token 参数 / 传统 timedtext 直链 */
  async function getCaptions(track, tlang, videoId, debug) {
    const base = track && track.baseUrl;
    const kind = (track && track.kind) || '';
    const lang = (track && track.languageCode) || 'en';
    const cands = [];
    if (base) {
      cands.push([withFmt(base, 'json3', tlang), 'base/json3']);
      cands.push([withFmt(base, 'srv1', tlang), 'base/srv1']);
      const s = stripSigned(base);
      cands.push([withFmt(s, 'json3', tlang), 'nostrip/json3']);
      cands.push([withFmt(s, 'srv1', tlang), 'nostrip/srv1']);
    }
    [kind, 'asr', ''].forEach(function (k) {
      cands.push([legacyUrl(videoId, lang, k, 'json3', tlang), 'legacy:' + (k || '-') + '/json3']);
    });
    for (let i = 0; i < cands.length; i++) {
      const caps = await tryUrl(cands[i][0], debug, cands[i][1]);
      if (caps && caps.length) {
        if (debug) console.log('[TED双语字幕] ✓ 字幕来源 =', cands[i][1], caps.length + '句');
        return caps;
      }
    }
    return null;
  }

  function isCJK(ch) {
    return /[\u3000-\u303f\u3040-\u9fff\uff00-\uffef]/.test(ch);
  }
  /** 智能拼接：中文之间不加空格，英文之间加空格 */
  function smartJoin(a, b) {
    if (!a) return b || '';
    if (!b) return a;
    const l = a[a.length - 1];
    const r = b[0];
    return isCJK(l) || isCJK(r) ? a + b : a + ' ' + b;
  }

  /** 把 YouTube ASR 的碎片字幕按句子重组：句末标点/停顿过大/过长时切分 */
  function regroupSentences(caps) {
    if (!caps || !caps.length) return caps;
    const out = [];
    let cur = null;
    const endRe = /[.?!。？！…]["'”’)\]]?\s*$/;
    const MAX_LEN = 140;
    const MAX_DUR = 9000;
    const MAX_GAP = 1600;

    function flush() {
      if (cur && cur.content) {
        out.push({
          startTime: cur.startTime,
          duration: Math.max(0, cur.end - cur.startTime),
          content: cur.content.trim(),
        });
      }
      cur = null;
    }

    for (let i = 0; i < caps.length; i++) {
      const c = caps[i];
      const start = c.startTime;
      const end = c.startTime + (c.duration || 0);
      const text = String(c.content || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (!cur) {
        cur = { startTime: start, end: end, content: text };
      } else {
        const gap = start - cur.end;
        if (gap > MAX_GAP) {
          flush();
          cur = { startTime: start, end: end, content: text };
        } else {
          cur.content = smartJoin(cur.content, text);
          cur.end = Math.max(cur.end, end);
        }
      }
      if (endRe.test(text) || cur.content.length >= MAX_LEN || cur.end - cur.startTime >= MAX_DUR) {
        flush();
      }
    }
    flush();
    return out.length ? out : caps;
  }

  const CJK_CLOSE = '，。！？、；：）】》」』”’…—～.,!?;:)]}';
  const CJK_OPEN = '（【《「『“‘([{';
  /** 标点禁则：避免行首出现收尾标点、行尾出现开引号 */
  function adjustBreak(text, b, prev) {
    let i = b;
    while (i < text.length && CJK_CLOSE.indexOf(text[i]) >= 0) i++;
    if (i !== b) b = i;
    while (b > prev + 1 && CJK_OPEN.indexOf(text[b - 1]) >= 0) b--;
    return b;
  }

  /** 计算把文本分成 k 段的断点下标（snap=英文按空格断，避免切词） */
  function textBreaks(text, k, snap) {
    const len = text.length;
    const br = [0];
    for (let i = 1; i < k; i++) {
      let idx = Math.min(len - 1, Math.max(1, Math.round((len * i) / k)));
      if (snap) {
        let j = idx;
        while (j > 0 && text[j] !== ' ') j--;
        if (j === 0) {
          j = idx;
          while (j < len && text[j] !== ' ') j++;
        }
        idx = j;
      }
      idx = adjustBreak(text, idx, br[br.length - 1]);
      if (idx <= br[br.length - 1]) idx = Math.min(len, br[br.length - 1] + 1);
      if (idx > len) idx = len;
      br.push(idx);
    }
    br.push(len);
    return br;
  }

  /** 把过长的字幕块切成更短的显示块（时间按字符比例分配），避免占屏过多行 */
  function splitLongCues(cues, maxEn, maxZh) {
    const out = [];
    (cues || []).forEach(function (c) {
      const en = String(c.en || '');
      const zh = String(c.zh || '');
      const k = Math.max(
        Math.ceil(en.length / maxEn),
        zh ? Math.ceil(zh.length / maxZh) : 1,
        1
      );
      if (k <= 1) {
        out.push({ start: c.start, end: c.end, en: en, zh: zh });
        return;
      }
      const enBr = textBreaks(en, k, true);
      const zhBr = zh ? textBreaks(zh, k, false) : null;
      const total = c.end - c.start;
      for (let i = 0; i < k; i++) {
        out.push({
          start: c.start + Math.round((total * i) / k),
          end: c.start + Math.round((total * (i + 1)) / k),
          en: en.slice(enBr[i], enBr[i + 1]).trim(),
          zh: zhBr ? zh.slice(zhBr[i], zhBr[i + 1]).trim() : '',
        });
      }
    });
    return out;
  }

  function pickEn(tracks) {
    const en = (tracks || []).filter(function (t) {
      return /^en/i.test(t.languageCode);
    });
    return en.find(function (t) {
      return t.kind !== 'asr';
    }) || en[0] || null;
  }

  /* ---------- 渲染 ---------- */
  function ensureOverlay() {
    if (state.overlay) return state.overlay;
    const overlay = new TEDL.Overlay({
      onPrev: prevCue,
      onNext: nextCue,
      onReplay: replayCue,
      onLoop: setLoop,
      onSeek: function (ms) {
        state.player.seek(ms);
      },
      onSpeed: function (v) {
        state.player.setSpeed(v);
      },
      onOpenVocab: function () {
        openExtensionPage('src/popup/popup.html');
      },
      onOpenSettings: function () {
        openExtensionPage('src/options/options.html');
      },
      onExport: exportSubtitle,
      onAsr: function () {
        overlay.setNote('YouTube 暂不支持语音识别（该功能用于 TED）');
        setTimeout(function () {
          overlay.setNote('');
        }, 2500);
      },
      onTranscriptToggle: function (on) {
        TEDL.vocab.saveSettings({ transcript: on });
      },
      syncScroll: true,
    });
    overlay.mount();
    overlay.rootEl.dataset.yt = '1';
    state.overlay = overlay;
    return overlay;
  }

  function currentCue() {
    const i = state.overlay ? state.overlay.current : -1;
    return i >= 0 ? state.cues[i] : null;
  }
  function prevCue() {
    const c = currentCue();
    if (!c) return;
    const i = state.cues.indexOf(c);
    state.player.seek(state.cues[Math.max(0, i - 1)].start);
    state.sync.forceUpdate();
  }
  function nextCue() {
    const c = currentCue();
    if (!c) return;
    const i = state.cues.indexOf(c);
    state.player.seek(state.cues[Math.min(state.cues.length - 1, i + 1)].start);
    state.sync.forceUpdate();
  }
  function replayCue() {
    const c = currentCue();
    if (c) state.player.playOnce(c);
  }
  function setLoop(on) {
    const c = currentCue();
    state.player.setLoop(on, c);
    if (on && c) state.player.playOnce(c);
  }

  function setupPlayerAndSync(video) {
    if (state.player) state.player.destroy();
    if (state.sync) state.sync.stop();
    state.player = new TEDL.Player(video);
    state.sync = TEDL.createSync(video, function (idx) {
      if (state.overlay) state.overlay.renderCurrent(idx);
      state.player.setLoopCue(idx >= 0 ? state.cues[idx] : null);
    });
    state.sync.setCues(state.cues);
    state.sync.setOffset(0);
    state.player.setOffset(0);
    state.sync.start();
  }

  function applyCues(overlay, cues, title, video) {
    state.cues = cues;
    overlay.setCues(state.cues, title || state.title);
    overlay.setTranscriptOpen(state.settings.transcript);
    overlay.setSpeed(video.playbackRate || 1);
    overlay.renderCurrent(-1);
    setupPlayerAndSync(video);
    const ai = state.settings.ai || {};
    const missing = state.cues.some(function (c) {
      return !c.zh;
    });
    if (missing && ai.enabled && ai.baseUrl && ai.model) {
      overlay.setNote('翻译中…（共 ' + state.cues.length + ' 句）');
      translateMissing();
    } else if (missing) {
      overlay.setNote('仅英文 ' + state.cues.length + ' 句 · 启用「AI 兜底翻译」可得中文');
    } else {
      overlay.setNote('');
    }
  }

  let _translating = false;
  async function translateMissing() {
    if (_translating) return;
    const ai = state.settings.ai || {};
    if (!ai.enabled || !ai.baseUrl || !ai.model) return;
    _translating = true;
    const myId = state.videoId;
    try {
      while (true) {
        if (!state.overlay || state.videoId !== myId) return;
        const idxs = [];
        for (let i = 0; i < state.cues.length; i++) if (!state.cues[i].zh) idxs.push(i);
        if (!idxs.length) break;
        const batch = idxs.slice(0, 25);
        const texts = batch.map(function (i) {
          return state.cues[i].en;
        });
        let res;
        try {
          res = await chrome.runtime.sendMessage({ type: 'aiTranslate', texts: texts, config: ai });
        } catch (e) {
          res = { ok: false };
        }
        if (!state.overlay || state.videoId !== myId) return;
        const pairs = [];
        texts.forEach(function (en, j) {
          const t = res && res.ok && res.translations ? res.translations[j] : '';
          if (t) pairs.push({ en: en, zh: t });
        });
        if (!pairs.length) break;
        docPatchZh(state.videoId, pairs);
        const m = new Map();
        pairs.forEach(function (p) {
          m.set(p.en, p.zh);
        });
        state.cues.forEach(function (c) {
          const z = m.get(c.en);
          if (z) c.zh = z;
        });
        state.overlay.renderTranscript();
        state.overlay.renderCurrent(state.overlay.current);
      }
    } finally {
      _translating = false;
    }
  }

  function exportSubtitle() {
    if (!state.cues.length) return;
    const payload = {
      title: state.title || cleanTitle(document.title),
      talkId: talkId(state.videoId),
      cues: state.cues.map(function (c) {
        return { en: c.en, zh: c.zh || '', start: c.start };
      }),
      updated: Date.now(),
    };
    chrome.storage.local.set({ [EXPORT_KEY]: payload }).then(function () {
      openExtensionPage('src/export/export.html');
    });
  }

  /* ---------- 主流程 ---------- */
  function normalizeTrack(t) {
    return {
      baseUrl: t.baseUrl,
      languageCode: t.languageCode,
      kind: t.kind || '',
      isTranslatable: t.isTranslatable !== false,
    };
  }

  /** 从字符串里按 key 提取其后的 JSON 对象（大括号配对） */
  function extractObjectAfter(html, key) {
    const i = html.indexOf('"' + key + '":');
    if (i < 0) return null;
    let j = html.indexOf('{', i);
    if (j < 0) return null;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let k = j; k < html.length; k++) {
      const ch = html[k];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return html.slice(j, k + 1);
      }
    }
    return null;
  }

  let _ytcfg = { apiKey: INNERTUBE_KEY, context: null, transcriptParams: null };

  /** 抓 watch 页，一次性取出 API Key、INNERTUBE_CONTEXT、字幕轨、transcript params */
  async function fetchWatchConfig(videoId) {
    const out = { apiKey: INNERTUBE_KEY, context: null, tracks: [], transcriptParams: null };
    try {
      const res = await fetch('https://www.youtube.com/watch?v=' + encodeURIComponent(videoId), {
        credentials: 'include',
        cache: 'no-store',
      });
      const html = await res.text();
      const km = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
      if (km) out.apiKey = km[1];
      const ctxStr = extractObjectAfter(html, 'INNERTUBE_CONTEXT');
      if (ctxStr) {
        try {
          out.context = JSON.parse(ctxStr);
        } catch (e) {}
      }
      const tm = html.match(/"captionTracks":(\[.*?\])/s);
      if (tm) {
        try {
          const arr = JSON.parse(tm[1].replace(/\\u0026/g, '&'));
          if (Array.isArray(arr)) out.tracks = arr.map(normalizeTrack);
        } catch (e) {}
      }
      const pm = html.match(/"getTranscriptEndpoint":\{"params":"([^"]+)"/);
      if (pm) out.transcriptParams = pm[1];
    } catch (e) {
      console.warn('[TED双语字幕] 抓 watch 配置失败', e && e.message);
    }
    return out;
  }

  /** 直接抓 YouTube 视频页 HTML 里的字幕轨（不依赖注入脚本） */
  async function tracksFromHtml(videoId) {
    try {
      const res = await fetch('https://www.youtube.com/watch?v=' + encodeURIComponent(videoId), {
        credentials: 'include',
        cache: 'no-store',
      });
      const html = await res.text();
      const m = html.match(/"captionTracks":(\[.*?\])/s);
      if (m) {
        const arr = JSON.parse(m[1].replace(/\\u0026/g, '&'));
        if (Array.isArray(arr) && arr.length) return arr.map(normalizeTrack);
      }
    } catch (e) {
      console.warn('[TED双语字幕] 抓取 YouTube 字幕轨失败：', e && e.message);
    }
    return [];
  }

  /** 用 Innertube player 的 ANDROID / IOS 客户端取字幕轨（其 baseUrl 通常不需要 PO token） */
  async function innertubeTracks(videoId, client) {
    const clientCtx =
      client === 'IOS'
        ? { clientName: 'IOS', clientVersion: '20.10.4', hl: 'en' }
        : { clientName: 'ANDROID', clientVersion: '20.10.38', hl: 'en' };
    try {
      const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          context: { client: clientCtx },
          videoId: videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });
      const text = await res.text();
      let j = null;
      try {
        j = JSON.parse(text);
      } catch (e) {}
      const status = j && j.playabilityStatus && j.playabilityStatus.status;
      const list =
        j &&
        j.captions &&
        j.captions.playerCaptionsTracklistRenderer &&
        j.captions.playerCaptionsTracklistRenderer.captionTracks;
      console.log('[TED双语字幕] innertube(' + client + ') status=' + status + ' 轨=' + (Array.isArray(list) ? list.length : 0));
      if (Array.isArray(list) && list.length) return list.map(normalizeTrack);
    } catch (e) {
      console.warn('[TED双语字幕] innertube(' + client + ') 失败', e && e.message);
    }
    return [];
  }
  function mergeTracks(a, b) {
    const seen = Object.create(null);
    const out = [];
    a.concat(b).forEach(function (t) {
      const k = t.languageCode + '|' + (t.kind || '');
      if (!seen[k]) {
        seen[k] = 1;
        out.push(t);
      }
    });
    return out;
  }

  /** 从 watch 页 HTML 里取 get_transcript 的 params */
  async function transcriptParamsFromHtml(videoId) {
    if (_ytcfg.transcriptParams) return _ytcfg.transcriptParams;
    const cfg = await fetchWatchConfig(videoId);
    if (cfg.transcriptParams) return cfg.transcriptParams;
    return null;
  }

  /** 用同一套 INNERTUBE_CONTEXT 调 /next 拿 transcript params */
  async function transcriptParamsFromNext(videoId) {
    try {
      const res = await fetch(
        'https://www.youtube.com/youtubei/v1/next?key=' + _ytcfg.apiKey + '&prettyPrint=false',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            context: _ytcfg.context || {
              client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'en', gl: 'US' },
            },
            videoId: videoId,
          }),
        }
      );
      const s = await res.text();
      const m = s.match(/"getTranscriptEndpoint":\{"params":"([^"]+)"/);
      if (m) return m[1];
    } catch (e) {
      console.warn('[TED双语字幕] 取 transcript params(next) 失败', e && e.message);
    }
    return null;
  }

  function findInitialSegments(obj) {
    let found = null;
    (function walk(o) {
      if (found || !o || typeof o !== 'object') return;
      if (Array.isArray(o)) {
        for (let i = 0; i < o.length && !found; i++) walk(o[i]);
        return;
      }
      if (o.transcriptSegmentListRenderer && Array.isArray(o.transcriptSegmentListRenderer.initialSegments)) {
        found = o.transcriptSegmentListRenderer.initialSegments;
        return;
      }
      for (const k in o) {
        if (found) return;
        walk(o[k]);
      }
    })(obj);
    return found;
  }

  function segmentsToCaps(segs) {
    const out = [];
    (segs || []).forEach(function (s) {
      const r = s && s.transcriptSegmentRenderer;
      if (!r) return;
      let text = '';
      if (r.snippet && Array.isArray(r.snippet.runs)) {
        text = r.snippet.runs
          .map(function (rr) {
            return rr.text || '';
          })
          .join('');
      } else if (r.snippet && r.snippet.simpleText) {
        text = r.snippet.simpleText;
      }
      const start = Number(r.startMs) || 0;
      const end = Number(r.endMs) || 0;
      if (text) out.push({ startTime: start, duration: Math.max(0, end - start), content: text });
    });
    return out.length ? out : null;
  }

  function parseTranscriptResponse(j) {
    const segs = findInitialSegments(j);
    const caps = segmentsToCaps(segs);
    if (caps) return caps;
    // 兜底：整段 JSON 里正则找
    try {
      const txt = JSON.stringify(j);
      const out = [];
      const re = /"transcriptSegmentRenderer":\{(.*?)\}\}?\s*\}?(?=,|\])/g;
      let m;
      while ((m = re.exec(txt))) {
        const body = m[1];
        const sm = body.match(/"startMs":"?(\d+)"?/);
        const em = body.match(/"endMs":"?(\d+)"?/);
        const texts = (body.match(/"text":"((?:[^"\\]|\\.)*)"/g) || []).map(function (x) {
          try {
            return JSON.parse('{' + x + '}').text;
          } catch (e) {
            return '';
          }
        });
        const content = texts.join('');
        if (content) {
          const start = sm ? Number(sm[1]) : 0;
          const end = em ? Number(em[1]) : 0;
          out.push({ startTime: start, duration: Math.max(0, end - start), content: content });
        }
      }
      if (out.length) return out;
    } catch (e) {}
    return null;
  }

  /** 走 get_transcript 接口（不需要 timedtext / PO token） */
  async function innertubeGetTranscript(videoId, debug) {
    let params = await transcriptParamsFromNext(videoId);
    if (!params) params = await transcriptParamsFromHtml(videoId);
    if (!params) {
      if (debug) console.log('[TED双语字幕] 未获取到 transcript params');
      return null;
    }
    if (debug) console.log('[TED双语字幕] 已获取 transcript params，请求 get_transcript…');
    try {
      const res = await fetch(
        'https://www.youtube.com/youtubei/v1/get_transcript?key=' + _ytcfg.apiKey + '&prettyPrint=false',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            context: _ytcfg.context || {
              client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'en', gl: 'US' },
            },
            params: params,
          }),
        }
      );
      const text = await res.text();
      let j = null;
      try {
        j = JSON.parse(text);
      } catch (e) {}
      const caps = j ? parseTranscriptResponse(j) : null;
      if (debug && !(caps && caps.length)) {
        console.log('[TED双语字幕] get_transcript 无分句 status=' + res.status + ' len=' + text.length + ' 预览=' + JSON.stringify(text.slice(0, 400)));
      }
      if (debug) console.log('[TED双语字幕] get_transcript 返回', caps ? caps.length + '句' : '空');
      return caps;
    } catch (e) {
      if (debug) console.warn('[TED双语字幕] get_transcript 失败', e && e.message);
      return null;
    }
  }

  let _pendingTracks = null;
  let _loadingId = null;
  let _fail = null;
  async function startWatch() {
    const id = currentVideoId();
    if (!id) return;
    if (id === state.videoId && state.cues.length) return;
    if (_loadingId === id) return;
    if (_fail && _fail.id === id && Date.now() - _fail.t < 10000) return;
    _loadingId = id;
    console.log('[TED双语字幕] 开始处理 YouTube 视频', id);
    // 一次性抓 watch 页配置：API Key / INNERTUBE_CONTEXT / 字幕轨 / transcript params
    const cfg = await fetchWatchConfig(id);
    _ytcfg = { apiKey: cfg.apiKey, context: cfg.context, transcriptParams: cfg.transcriptParams };
    console.log('[TED双语字幕] ytcfg: key=' + (cfg.apiKey ? 'yes' : 'no') + ' context=' + (cfg.context ? 'yes' : 'no') + ' params=' + (cfg.transcriptParams ? 'yes' : 'no'));
    let tracks = (_pendingTracks && _pendingTracks.videoId === id && _pendingTracks.captionTracks) || cfg.tracks || [];
    const itA = await innertubeTracks(id, 'ANDROID');
    let it = itA;
    if (!it.length) it = await innertubeTracks(id, 'IOS');
    if (it.length) tracks = mergeTracks(it, tracks);
    if (!tracks.length) tracks = await tracksFromHtml(id);
    _loadingId = null;
    if (id !== currentVideoId()) return;
    console.log('[TED双语字幕] 字幕轨数量 =', tracks.length);
    if (!tracks.length) {
      const ov = ensureOverlay();
      ov.setStatus('该视频没有可用字幕轨');
      _fail = { id: id, t: Date.now() };
      return;
    }
    try {
      await loadVideo({ videoId: id, title: document.title, captionTracks: tracks });
    } catch (e) {
      console.error('[TED双语字幕] loadVideo 异常', e);
    }
    if (!state.cues.length) _fail = { id: id, t: Date.now() };
  }

  async function loadVideo(payload) {
    const videoId = payload.videoId;
    if (!videoId || videoId !== currentVideoId()) return;
    if (state.videoId === videoId && state.cues.length) return;
    const video = await waitFor(findVideo, 15000, 400);
    if (!video) return;
    if (videoId !== currentVideoId()) return;

    state.video = video;
    state.videoId = videoId;
    state.title = cleanTitle(payload.title || document.title);

    const overlay = ensureOverlay();
    overlay.talkId = talkId(videoId);
    overlay.setMode(state.settings.mode);
    overlay.setBlur(state.settings.blurZh);
    overlay.fontSize = state.settings.fontSize;
    overlay.setCues([]);
    overlay.renderCurrent(-1);

    // 本地文档优先（含已翻译中文）
    const existing = await docGet(videoId);
    if (existing && existing.cues && existing.cues.length) {
      applyCues(overlay, existing.cues.map(function (c) {
        return { start: c.start, end: c.end, en: c.en, zh: c.zh || '' };
      }), existing.title || state.title, video);
      return;
    }

    const tracks = payload.captionTracks || [];
    if (!tracks.length) {
      overlay.setStatus('该视频没有可用字幕');
      return;
    }
    overlay.setStatus('正在加载字幕…');
    const enTrack = pickEn(tracks) || tracks[0];
    console.log('[TED双语字幕] 选中字幕轨', enTrack.languageCode, enTrack.kind || '-', '可翻译=' + (enTrack.isTranslatable !== false), '共' + tracks.length + '条');
    // 用 Android/iOS 客户端返回的 baseUrl 直接取（通常不带 exp=xpe）
    let en = await getCaptions(enTrack, null, videoId, true);
    console.log('[TED双语字幕] 英文字幕 cue 数 =', en ? en.length : 0);
    if (!en || !en.length) {
      overlay.setStatus('字幕请求失败：已尝试多种方式仍未取到。请把 Console 里「字幕来源/失败」那几行发我');
      return;
    }
    let zh = null;
    // 1) 视频自带中文字幕轨优先
    const zhTrack = tracks.find(function (t) {
      return /^zh/i.test(t.languageCode);
    });
    if (zhTrack) {
      try {
        zh = await getCaptions(zhTrack, null, videoId, false);
      } catch (e) {}
    }
    // 2) 用英文字幕轨做自动翻译（多试几个语言代码）
    if (!zh) {
      const codes = ['zh-Hans', 'zh-CN', 'zh'];
      for (let i = 0; i < codes.length && !zh; i++) {
        try {
          zh = await getCaptions(enTrack, codes[i], videoId, true);
        } catch (e) {}
      }
    }
    // 按句子重组，避免 ASR 把句子切成碎片/两句合并
    en = regroupSentences(en);
    if (zh) zh = regroupSentences(zh);
    console.log('[TED双语字幕] YouTube 字幕：en=' + en.length + ' zh=' + (zh ? zh.length : 0) + ' 轨道=' + (enTrack.languageCode + (enTrack.kind ? '/' + enTrack.kind : '')) + ' 可翻译=' + (enTrack.isTranslatable !== false) + (zhTrack ? ' 有中文字幕轨' : ''));
    const cues = splitLongCues(TEDL.align.align(en, zh), 80, 36);
    docSeed(videoId, state.title, cues, { enSource: 'youtube', zhSource: zh ? 'youtube' : '' });
    applyCues(overlay, cues, state.title, video);
  }

  /* 接收注入脚本的播放器信息（可作为更快的来源） */
  window.addEventListener('message', function (e) {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== 'tedl-yt') return;
    if (!d.videoId || d.videoId !== currentVideoId()) return;
    if (d.captionTracks && d.captionTracks.length) _pendingTracks = d;
    if (d.videoId === state.videoId && state.cues.length) return;
    startWatch();
  });

  /* SPA 导航：换视频时清屏并重新处理 */
  let lastHref = location.href;
  setInterval(function () {
    if (location.href === lastHref) return;
    lastHref = location.href;
    const id = currentVideoId();
    if (!id || id === state.videoId) return;
    state.cues = [];
    state.videoId = null;
    if (state.overlay) {
      state.overlay.setCues([]);
      state.overlay.renderCurrent(-1);
    }
    if (state.sync) state.sync.stop();
    inject();
    startWatch();
  }, 1000);

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes[TEDL.vocab.KEYS.settings]) {
      TEDL.vocab.getSettings().then(function (s) {
        state.settings = s;
        if (state.overlay) {
          state.overlay.setMode(s.mode);
          state.overlay.setBlur(s.blurZh);
          state.overlay.fontSize = s.fontSize;
          state.overlay.applyStyle();
        }
      });
    }
  });

  (async function boot() {
    console.log('[TED双语字幕] YouTube 内容脚本已加载', location.href);
    try {
      state.settings = await TEDL.vocab.getSettings();
    } catch (e) {
      console.error('[TED双语字幕] 读取设置失败', e);
      state.settings = TEDL.vocab.DEFAULT_SETTINGS;
    }
    if (/^\/watch/.test(location.pathname)) {
      inject();
      startWatch();
    }
  })();
})(typeof globalThis !== 'undefined' ? globalThis : this);
