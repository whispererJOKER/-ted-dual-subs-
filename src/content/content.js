/* TED 双语字幕 —— 内容脚本入口：编排整条链路 */
(function (root) {
  'use strict';
  const TEDL = (root.TEDL = root.TEDL || {});
  if (root.__TEDL_CONTENT_LOADED__) return;
  root.__TEDL_CONTENT_LOADED__ = true;

  const LOG = '[TED双语字幕]';
  const idCache = Object.create(null);

  let state = {
    settings: null,
    video: null,
    talkId: null,
    title: '',
    cues: [],
    overlay: null,
    sync: null,
    player: null,
    lastUrl: location.href,
    token: 0,
    autoOffsetMs: 0,
    offsetMs: 0,
  };

  /** 文档（IndexedDB）访问都走后台，content script 不直接开 IDB（跨源） */
  function docGet(talkId) {
    return chrome.runtime
      .sendMessage({ type: 'docGet', talkId: String(talkId) })
      .then(function (r) {
        return r && r.ok ? r.doc : null;
      })
      .catch(function () {
        return null;
      });
  }
  function docSeed(talkId, title, cues, meta) {
    return chrome.runtime.sendMessage({ type: 'docSeed', talkId: String(talkId), title, cues, meta });
  }
  function docPatchZh(talkId, pairs) {
    return chrome.runtime.sendMessage({ type: 'docPatchZh', talkId: String(talkId), pairs });
  }

  function log() {
    // console.log.apply(console, [LOG].concat([].slice.call(arguments)));
  }

  /** 去掉网页标题里的站点后缀，得到干净的标题 */
  function cleanTitle(t) {
    let s = String(t || '').trim();
    if (/\bTED\b/i.test(s)) s = s.split('|')[0].trim(); // TED 网页标题
    s = s.replace(/\s*[-|–—]\s*YouTube\s*$/i, ''); // "... - YouTube"
    return s.trim();
  }

  function isEditable(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  }

  async function resolveTalkId() {
    const m = location.pathname.match(/\/talks\/([^/?#]+)/);
    const slug = m ? m[1] : '';
    if (!slug) return null;
    if (idCache[slug]) return idCache[slug];

    // 1) 读当前文档的 __NEXT_DATA__：必须 slug 完全一致才可信
    //    （SPA 跳转时页面里可能还是上一个演讲的旧数据，绝不能用）
    const el = document.getElementById('__NEXT_DATA__');
    if (el) {
      try {
        const nd = JSON.parse(el.textContent);
        const vd = nd && nd.props && nd.props.pageProps && nd.props.pageProps.videoData;
        if (vd && vd.id != null && vd.slug === slug) {
          idCache[slug] = String(vd.id);
          state.title = vd.title || state.title;
          return idCache[slug];
        }
      } catch (e) {
        /* ignore */
      }
    }
    // 2) 重新抓当前页面 HTML（禁缓存），并确认返回的确实是当前 slug
    try {
      const res = await fetch(location.href, { credentials: 'omit', cache: 'no-store' });
      const html = await res.text();
      const id = TEDL.ted.getTalkIdFromHtml(html);
      if (id && html.indexOf('"slug":"' + slug + '"') >= 0) {
        idCache[slug] = id;
        const tt = html.match(/"videoData":\{[^}]*"title":"([^"]+)"/);
        if (tt) state.title = tt[1];
        return id;
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  function collectVideos(rootNode, acc) {
    const vids = rootNode.querySelectorAll ? rootNode.querySelectorAll('video') : [];
    vids.forEach(function (v) {
      acc.push(v);
    });
    // 递归进入开放的 Shadow DOM
    const all = rootNode.querySelectorAll ? rootNode.querySelectorAll('*') : [];
    all.forEach(function (n) {
      if (n.shadowRoot) collectVideos(n.shadowRoot, acc);
    });
    return acc;
  }

  function findVideo() {
    const vids = collectVideos(document, []);
    if (!vids.length) return null;
    vids.sort(function (a, b) {
      return b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight;
    });
    return vids[0];
  }

  function waitFor(fn, timeoutMs, intervalMs) {
    return new Promise(function (resolve) {
      const deadline = Date.now() + (timeoutMs || 15000);
      const iv = (intervalMs || 400);
      (function poll() {
        let r = null;
        try {
          r = fn();
        } catch (e) {
          r = null;
        }
        if (r) return resolve(r);
        if (Date.now() > deadline) return resolve(null);
        setTimeout(poll, iv);
      })();
    });
  }

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
      onOpenVocab: openVocab,
      onOpenSettings: openSettings,
      onExport: exportSubtitle,
      onAsr: openAsr,
      onTranscriptToggle: function (on) {
        TEDL.vocab.saveSettings({ transcript: on });
      },
      syncScroll: true,
    });
    overlay.mount();
    state.overlay = overlay;
    handleFullscreen();
    return overlay;
  }

  /** 全屏时把字幕层移进全屏容器，否则移回 body */
  function handleFullscreen() {
    if (!state.overlay) return;
    const fs = document.fullscreenElement || document.webkitFullscreenElement || null;
    if (fs && fs.tagName !== 'VIDEO') {
      state.overlay.attachTo(fs);
    } else {
      state.overlay.attachTo(document.body);
    }
  }
  document.addEventListener('fullscreenchange', handleFullscreen);
  document.addEventListener('webkitfullscreenchange', handleFullscreen);

  function currentCue() {
    const i = state.overlay ? state.overlay.current : -1;
    return i >= 0 ? state.cues[i] : null;
  }

  function prevCue() {
    const cur = currentCue();
    if (!cur) return;
    const i = state.cues.indexOf(cur);
    const target = state.cues[Math.max(0, i - 1)];
    state.player.seek(target.start);
    state.sync.forceUpdate();
  }

  function nextCue() {
    const cur = currentCue();
    if (!cur) return;
    const i = state.cues.indexOf(cur);
    const target = state.cues[Math.min(state.cues.length - 1, i + 1)];
    state.player.seek(target.start);
    state.sync.forceUpdate();
  }

  function replayCue() {
    const cur = currentCue();
    if (cur) state.player.playOnce(cur);
  }

  function setLoop(on) {
    const cur = currentCue();
    state.player.setLoop(on, cur);
    if (on && cur) state.player.playOnce(cur);
  }

  // 由后台打开扩展页面，避开 Edge/Chrome 对新标签里 chrome-extension:// 的拦截
  function openExtensionPage(path) {
    const targetedPath = path;
    try {
      chrome.runtime.sendMessage({ type: 'openExtensionPage', path: targetedPath }, function (resp) {
        if (chrome.runtime.lastError || !resp || !resp.ok) {
          // 后台不可用时兜底
          try {
            window.open(chrome.runtime.getURL(targetedPath), '_blank');
          } catch (e) {}
        }
      });
    } catch (e) {
      try {
        window.open(chrome.runtime.getURL(targetedPath), '_blank');
      } catch (e2) {}
    }
  }

  function openVocab() {
    openExtensionPage('src/popup/popup.html');
  }

  function openSettings() {
    openExtensionPage('src/options/options.html');
  }

  const EXPORT_KEY = 'tedl_export_payload';
  const ASR_REQ_KEY = 'tedl_asr_request';

  async function exportSubtitle() {
    if (!state.cues || !state.cues.length) return;
    const payload = {
      title: state.title || cleanTitle(document.title),
      talkId: state.talkId || '',
      cues: state.cues.map(function (c) {
        return { en: c.en || '', zh: c.zh || '', start: c.start };
      }),
      updated: Date.now(),
    };
    try {
      await chrome.storage.local.set({ [EXPORT_KEY]: payload });
    } catch (e) {
      return;
    }
    openExtensionPage('src/export/export.html');
  }

  /** 触发语音识别：把任务交给后台页面处理 */
  function openAsr() {
    try {
      const info = TEDL.ted.getHlsInfo ? TEDL.ted.getHlsInfo() : null;
      if (!info || !info.projectId) {
        if (state.overlay) state.overlay.setStatus('未找到音频音轨，无法识别（可刷新页面重试）');
        console.warn('[TED双语字幕] 识别失败：未获取到 hls/projectId', info);
        return;
      }
      const ai = state.settings.ai || {};
      const mode = ai.asrMode || 'openai';
      console.log('[TED双语字幕] 打开识别，模式 =', mode, ai);
      let config;
      if (mode === 'relay') {
        // 阿里云百炼：走本机转发服务
        const relayUrl = ai.relayUrl || 'http://127.0.0.1:8788';
        const key = ai.relayKey || ai.apiKey;
        if (!key) {
          if (state.overlay) state.overlay.setStatus('百炼模式：请先在设置里填写「百炼 API Key」并保存');
          openSettings();
          return;
        }
        config = {
          mode: 'relay',
          baseUrl: relayUrl,
          apiKey: key,
          model: ai.relayModel || 'paraformer-realtime-v2',
          speed: ai.relaySpeed || 4,
        };
      } else if (mode === 'local') {
        config = {
          mode: 'local',
          model: ai.localModel || 'whisper-tiny.en',
          host: ai.localHost || 'https://hf-mirror.com',
          dtype: ai.localDtype || 'q8',
        };
      } else {
        const asrBase = ai.asrBaseUrl || ai.baseUrl;
        const asrKey = ai.asrKey || ai.apiKey;
        if (!asrBase || !asrKey) {
          if (state.overlay) state.overlay.setStatus('请先在设置里填写「识别接口地址」与 Key 并保存');
          openSettings();
          return;
        }
        config = {
          mode: 'openai',
          baseUrl: asrBase,
          apiKey: asrKey,
          model: ai.asrModel || 'whisper-1',
          path: ai.asrPath || '/audio/transcriptions',
          headers: ai.asrHeaders || '',
          lang: ai.asrLang || '',
        };
      }
      const req = {
        talkId: String(state.talkId || ''),
        projectId: info.projectId,
        introMasterId: info.introMasterId,
        title: state.title || cleanTitle(document.title),
        introOffsetMs: state.autoOffsetMs || 0,
        config: config,
        updated: Date.now(),
      };
      if (state.overlay) state.overlay.setNote('正在打开识别页…（模式：' + mode + '）');
      chrome.storage.local.set({ [ASR_REQ_KEY]: req }).then(function () {
        openExtensionPage('src/asr/asr.html');
      });
    } catch (e) {
      if (state.overlay) state.overlay.setStatus('打开识别失败：' + (e.message || e));
      console.error('[TED双语字幕] openAsr 异常', e);
    }
  }

  /** 建立/重建播放器与同步 */
  function setupPlayerAndSync() {
    if (!state.video) return;
    if (state.player) state.player.destroy();
    if (state.sync) state.sync.stop();
    state.player = new TEDL.Player(state.video);
    state.sync = TEDL.createSync(state.video, function (idx) {
      if (state.overlay) state.overlay.renderCurrent(idx);
      const cur = idx >= 0 ? state.cues[idx] : null;
      state.player.setLoopCue(cur);
    });
    state.sync.setCues(state.cues);
    applyOffset();
    state.sync.start();
  }

  /** 应用一份字幕文档（en/zh 已在文档里合并好），缺中文则补翻 */
  async function applyDoc(doc) {
    if (!doc || !doc.cues || !doc.cues.length) return;
    if (doc.talkId != null && String(doc.talkId) !== String(state.talkId)) return; // 防串号
    state.cues = doc.cues.map(function (c) {
      return { start: c.start, end: c.end, en: c.en || '', zh: c.zh || '' };
    });
    const overlay = ensureOverlay();
    if (!state.player || !state.sync) {
      await computeAutoOffset(state.talkId);
      overlay.setCues(state.cues, doc.title || state.title);
      overlay.setTranscriptOpen(state.settings.transcript);
      if (state.video) overlay.setSpeed(state.video.playbackRate || 1);
      setupPlayerAndSync();
    } else {
      overlay.setCues(state.cues, doc.title || state.title);
      state.sync.setCues(state.cues);
      applyOffset();
      state.sync.forceUpdate();
    }
    const ai = state.settings.ai || {};
    const aiReady = ai.enabled && ai.baseUrl && ai.model;
    const missing = state.cues.some(function (c) {
      return !c.zh;
    });
    if (missing && aiReady) {
      overlay.setNote('翻译中…（共 ' + state.cues.length + ' 句）');
      translateMissing();
    } else if (missing) {
      overlay.setNote('仅英文 ' + state.cues.length + ' 句 · 启用「AI 兜底翻译」可得中文');
      setTimeout(function () {
        if (state.overlay) state.overlay.setNote('');
      }, 6000);
    } else {
      overlay.setNote('');
    }
  }

  /** 后台广播：某演讲文档已更新（识别进度 / 翻译写入） */
  async function onDocUpdated(talkId) {
    if (String(talkId) !== String(state.talkId)) return;
    const doc = await docGet(state.talkId);
    if (doc) applyDoc(doc);
  }

  function applyOffset() {
    const total = state.autoOffsetMs + (Number(state.settings.offsetMs) || 0);
    state.offsetMs = total;
    if (state.sync) state.sync.setOffset(total);
    if (state.player) state.player.setOffset(total);
  }

  async function computeAutoOffset(talkId) {
    state.autoOffsetMs = 0;
    try {
      const info = TEDL.ted.getHlsInfo();
      if (!info || !info.hlsUrl) return;
      const res = await chrome.runtime.sendMessage({ type: 'getIntroOffset', hlsUrl: info.hlsUrl });
      if (res && res.ok && res.offsetMs) state.autoOffsetMs = res.offsetMs;
      log('intro offset =', state.autoOffsetMs, 'ms');
    } catch (e) {
      /* 忽略：偏移为 0 时仍可用 */
    }
  }

  async function loadSubtitles(talkId) {
    const overlay = ensureOverlay();
    overlay.setStatus('正在加载字幕…');
    const en = await TEDL.ted.fetchSubtitles(talkId, 'en');
    if (!en || !en.length) return { cues: [], hasEn: false, hasZh: false };
    let zh = null;
    const langs = TEDL.ted.getAvailableLanguages();
    const wantZh = state.settings.zhLang;
    if (!langs.length || langs.indexOf(wantZh) >= 0) {
      zh = await TEDL.ted.fetchSubtitles(talkId, wantZh);
    }
    return { cues: TEDL.align.align(en, zh), hasEn: true, hasZh: !!zh };
  }

  /** 渐进式 AI 翻译：只翻「还没有中文」的句子，边识别边补翻，可反复调用 */
  let _translating = false;
  const MAX_ATTEMPTS = 3; // 单句翻译失败最多重试次数
  const _attempts = Object.create(null); // 英文句 -> 已失败次数

  async function translateMissing() {
    if (_translating) return; // 已有翻译循环在跑，它会自动捡到新句子
    const ai = state.settings.ai || {};
    if (!ai.enabled || !ai.baseUrl || !ai.model) return;
    _translating = true;
    const myTalkId = state.talkId;
    const BATCH = 25;
    try {
      while (true) {
        if (!state.overlay || state.talkId !== myTalkId) return;
        const idxs = [];
        for (let i = 0; i < state.cues.length; i++) {
          const c = state.cues[i];
          if (!c.zh && (_attempts[c.en] || 0) < MAX_ATTEMPTS) idxs.push(i);
        }
        if (!idxs.length) break;
        const batch = idxs.slice(0, BATCH);
        const texts = batch.map(function (i) {
          return state.cues[i].en;
        });
        state.overlay.setNote('翻译中… 待翻 ' + idxs.length + ' 句');
        let res;
        try {
          res = await chrome.runtime.sendMessage({ type: 'aiTranslate', texts: texts, config: ai });
        } catch (e) {
          res = { ok: false, error: String(e) };
        }
        if (!state.overlay || state.talkId !== myTalkId) return;
        let filled = 0;
        const pairs = [];
        texts.forEach(function (en, j) {
          const t = res && res.ok && res.translations ? res.translations[j] : '';
          if (t) {
            pairs.push({ en: en, zh: t });
            filled++;
            delete _attempts[en];
          } else {
            _attempts[en] = (_attempts[en] || 0) + 1; // 记一次失败，用于重试与上限
          }
        });
        if (filled) {
          docPatchZh(state.talkId, pairs); // 写入文档（持久化，按英文原文匹配）
          const m = new Map();
          pairs.forEach(function (p) {
            m.set(p.en, p.zh);
          });
          state.cues.forEach(function (c) {
            const z = m.get(c.en);
            if (z) c.zh = z;
          });
        }
        // 刷新当前句与逐句面板，中文实时可见
        state.overlay.renderTranscript();
        state.overlay.renderCurrent(state.overlay.current);
        if (!filled) {
          // 这批全失败（接口/网络/模型问题）：等一下再重试，未到上限的句子会被下一轮捡起
          if (res && res.error) state.overlay.setNote('翻译失败，重试中：' + String(res.error).slice(0, 50));
          await new Promise(function (r) {
            setTimeout(r, 1000);
          });
          if (!state.overlay || state.talkId !== myTalkId) return;
        }
      }
    } finally {
      _translating = false;
      if (state.overlay) {
        const remain = state.cues.filter(function (c) {
          return !c.zh;
        }).length;
        if (!remain) state.overlay.setNote('');
        else state.overlay.setNote('有 ' + remain + ' 句翻译失败（已重试 ' + MAX_ATTEMPTS + ' 次）');
      }
    }
  }

  async function loadForCurrentPage() {
    const token = ++state.token;
    state.title = '';
    const video = await waitFor(findVideo, 20000, 500);
    if (!video) {
      // 页面没有视频（可能不是演讲页），直接退出
      return;
    }
    const talkId = await resolveTalkId();
    if (token !== state.token) return;
    if (!talkId) {
      const overlay = ensureOverlay();
      overlay.setStatus('未识别到 TED 演讲编号');
      return;
    }

    teardownPlayer();
    state.video = video;
    state.talkId = talkId;
    if (!state.title) state.title = cleanTitle(document.title);

    const overlay = ensureOverlay();
    overlay.talkId = talkId;
    overlay.setMode(state.settings.mode);
    overlay.setBlur(state.settings.blurZh);
    overlay.fontSize = state.settings.fontSize;
    // 切演讲时先清空显示，避免上一个演讲的字幕残留在画面上
    overlay.setCues([]);
    overlay.renderCurrent(-1);

    // 1) 先看本地文档（可能已有官方字幕或识别+翻译结果）
    const existing = await docGet(talkId);
    if (token !== state.token) return;
    if (existing && String(existing.talkId) === String(talkId) && existing.cues && existing.cues.length) {
      if (existing.title) state.title = cleanTitle(existing.title);
      await applyDoc(existing);
      log('loaded doc', talkId, existing.cues.length, 'cues');
      return;
    }

    // 2) 官方字幕
    const r = await loadSubtitles(talkId);
    if (token !== state.token) return;
    if (!r.hasEn) {
      overlay.setStatus('该演讲没有官方字幕，点 🎙 用语音识别自动生成');
      return;
    }

    state.cues = r.cues;
    overlay.setCues(state.cues, state.title);
    overlay.setTranscriptOpen(state.settings.transcript);
    overlay.setSpeed(video.playbackRate || 1);
    overlay.renderCurrent(-1);

    await computeAutoOffset(talkId);
    if (token !== state.token) return;

    setupPlayerAndSync();
    // 存成文档（官方 en+zh），后续识别/翻译都往这份文档里写
    docSeed(talkId, state.title, state.cues, {
      enSource: 'official',
      zhSource: r.hasZh ? 'official' : '',
    });
    log('loaded talk', talkId, state.cues.length, 'cues');

    const ai = state.settings.ai || {};
    if (!r.hasZh) {
      if (ai.enabled && ai.baseUrl && ai.model) translateMissing();
      else overlay.setStatus('无官方中文字幕 · 启用「AI 兜底翻译」可自动补中文');
    }
  }

  function teardownPlayer() {
    if (state.sync) {
      state.sync.stop();
      state.sync = null;
    }
    if (state.player) {
      state.player.destroy();
      state.player = null;
    }
    state.cues = [];
  }

  function teardown() {
    teardownPlayer();
    if (state.overlay && state.overlay.rootEl) {
      state.overlay.rootEl.remove();
      state.overlay.transcriptEl.remove();
      state.overlay.popover.remove();
    }
    state.overlay = null;
    state.talkId = null;
    state.title = '';
  }

  async function refreshSettings() {
    state.settings = await TEDL.vocab.getSettings();
    if (state.overlay) {
      state.overlay.setMode(state.settings.mode);
      state.overlay.setBlur(state.settings.blurZh);
      state.overlay.fontSize = state.settings.fontSize;
      state.overlay.applyStyle();
    }
    applyOffset();
  }

  /* 键盘快捷键 */
  document.addEventListener('keydown', function (e) {
    if (!state.overlay) return;
    if (isEditable(e.target)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const map = { j: nextCue, k: prevCue, r: replayCue, l: toggleLoopKey, m: cycleModeKey, h: blurKey, t: transcriptKey };
    const lk = k.toLowerCase();
    if (map[lk]) {
      e.preventDefault();
      map[lk]();
    } else if (k === '[') {
      const v = Math.max(0.5, (state.video.playbackRate || 1) - 0.1);
      state.player.setSpeed(v);
      state.overlay.setSpeed(v);
    } else if (k === ']') {
      const v = Math.min(2, (state.video.playbackRate || 1) + 0.1);
      state.player.setSpeed(v);
      state.overlay.setSpeed(v);
    } else if (k === ',') {
      e.preventDefault();
      nudgeOffset(-100);
    } else if (k === '.') {
      e.preventDefault();
      nudgeOffset(100);
    }
  });

  function nudgeOffset(delta) {
    const cur = Number(state.settings.offsetMs) || 0;
    const next = cur + delta;
    state.settings.offsetMs = next;
    TEDL.vocab.saveSettings({ offsetMs: next });
    applyOffset();
    if (state.overlay) {
      const total = state.autoOffsetMs + next;
      state.overlay.setStatus(
        '字幕微调 ' + (next > 0 ? '+' : '') + next + 'ms（含片头共 ' + total + 'ms，逗号/句号调整）'
      );
      setTimeout(function () {
        state.overlay.renderCurrent(state.overlay.current);
      }, 1200);
    }
  }

  function toggleLoopKey() {
    const on = !state.player.loopOn;
    state.overlay.btnLoop.classList.toggle('active', on);
    setLoop(on);
  }
  function cycleModeKey() {
    state.overlay.cycleMode();
    TEDL.vocab.saveSettings({ mode: state.overlay.mode });
  }
  function blurKey() {
    state.overlay.toggleBlur();
    TEDL.vocab.saveSettings({ blurZh: state.overlay.blurZh });
  }
  function transcriptKey() {
    state.overlay.toggleTranscript();
  }

  /* 单页路由变化监听 */
  setInterval(function () {
    if (location.href === state.lastUrl) return;
    state.lastUrl = location.href;
    // 立即清掉旧演讲的字幕，避免残留到新页面
    if (state.overlay) {
      state.overlay.setCues([]);
      state.overlay.renderCurrent(-1);
    }
    teardownPlayer();
    setTimeout(function () {
      if (!/\/talks\//.test(location.pathname)) {
        teardown();
        return;
      }
      loadForCurrentPage();
    }, 800);
  }, 1000);

  /* 设置变化同步 */
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes[TEDL.vocab.KEYS.settings]) refreshSettings();
  });

  /* 后台广播：文档更新 / 缓存已清除 */
  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg) return;
    if (msg.type === 'docUpdated' && msg.talkId) onDocUpdated(msg.talkId);
    if (msg.type === 'docsCleared') {
      state.cues = [];
      if (state.overlay) {
        state.overlay.setCues([]);
        state.overlay.renderCurrent(-1);
        state.overlay.setStatus('缓存已清除，重新加载字幕…');
      }
      loadForCurrentPage();
    }
  });

  /* 启动 */
  (async function boot() {
    state.settings = await TEDL.vocab.getSettings();
    if (/\/talks\//.test(location.pathname)) {
      loadForCurrentPage();
    }
  })();
})(typeof globalThis !== 'undefined' ? globalThis : this);
