/* TED 双语字幕 —— 设置页 */
(function () {
  'use strict';
  const V = TEDL.vocab;
  const $ = function (id) {
    return document.getElementById(id);
  };

  function collect() {
    return {
      mode: $('mode').value,
      zhLang: ($('zhLang').value || 'zh-cn').trim(),
      fontSize: Number($('fontSize').value) || 0,
      blurZh: $('blurZh').checked,
      transcript: $('transcript').checked,
      offsetMs: Number($('offsetMs').value) || 0,
      ai: {
        enabled: $('aiEnabled').checked,
        baseUrl: $('baseUrl').value.trim(),
        model: $('model').value.trim(),
        asrMode: $('asrMode').value,
        relayUrl: $('relayUrl').value.trim() || 'http://127.0.0.1:8788',
        relayKey: $('relayKey').value.trim(),
        relayModel: $('relayModel').value.trim() || 'paraformer-realtime-v2',
        relaySpeed: Number($('relaySpeed').value) || 4,
        localModel: $('localModel').value || 'whisper-tiny.en',
        localHost: $('localHost').value.trim() || 'https://hf-mirror.com',
        asrBaseUrl: $('asrBaseUrl').value.trim(),
        asrKey: $('asrKey').value.trim(),
        asrModel: $('asrModel').value.trim() || 'whisper-1',
        asrPath: $('asrPath').value.trim() || '/audio/transcriptions',
        asrHeaders: $('asrHeaders').value,
        asrLang: $('asrLang').value.trim(),
        apiKey: $('apiKey').value.trim(),
      },
    };
  }

  async function load() {
    const s = await V.getSettings();
    $('mode').value = s.mode;
    $('zhLang').value = s.zhLang;
    $('fontSize').value = s.fontSize;
    $('blurZh').checked = !!s.blurZh;
    $('transcript').checked = !!s.transcript;
    $('offsetMs').value = s.offsetMs || 0;
    $('aiEnabled').checked = !!(s.ai && s.ai.enabled);
    $('baseUrl').value = (s.ai && s.ai.baseUrl) || '';
    $('model').value = (s.ai && s.ai.model) || '';
    $('asrBaseUrl').value = (s.ai && s.ai.asrBaseUrl) || '';
    $('asrKey').value = (s.ai && s.ai.asrKey) || '';
    $('asrModel').value = (s.ai && s.ai.asrModel) || 'whisper-1';
    $('asrPath').value = (s.ai && s.ai.asrPath) || '/audio/transcriptions';
    $('asrHeaders').value = (s.ai && s.ai.asrHeaders) || '';
    $('asrLang').value = (s.ai && s.ai.asrLang) || '';
    $('asrMode').value = (s.ai && s.ai.asrMode) || 'openai';
    $('relayUrl').value = (s.ai && s.ai.relayUrl) || 'http://127.0.0.1:8788';
    $('relayKey').value = (s.ai && s.ai.relayKey) || '';
    $('relayModel').value = (s.ai && s.ai.relayModel) || 'paraformer-realtime-v2';
    $('relaySpeed').value = (s.ai && s.ai.relaySpeed) || 4;
    $('localModel').value = (s.ai && s.ai.localModel) || 'whisper-tiny.en';
    $('localHost').value = (s.ai && s.ai.localHost) || 'https://hf-mirror.com';
    toggleAsrMode();
    $('apiKey').value = (s.ai && s.ai.apiKey) || '';
  }

  function originPattern(baseUrl) {
    try {
      const u = new URL(baseUrl);
      return u.protocol + '//' + u.host + '/*';
    } catch (e) {
      return null;
    }
  }

  async function ensurePermission(baseUrl) {
    const pattern = originPattern(baseUrl);
    if (!pattern) return { ok: false, error: 'Base URL 无效' };
    try {
      const has = await chrome.permissions.contains({ origins: [pattern] });
      if (has) return { ok: true };
      const granted = await chrome.permissions.request({ origins: [pattern] });
      return { ok: granted, error: granted ? '' : '未授予访问该接口地址的权限' };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  $('save').addEventListener('click', async function () {
    const s = collect();
    if (s.ai.enabled && s.ai.baseUrl) {
      const perm = await ensurePermission(s.ai.baseUrl);
      if (!perm.ok) {
        $('saved').textContent = '保存失败：' + perm.error;
        return;
      }
    }
    if (s.ai.asrBaseUrl) {
      const perm2 = await ensurePermission(s.ai.asrBaseUrl);
      if (!perm2.ok) {
        $('saved').textContent = '保存失败（识别接口）：' + perm2.error;
        return;
      }
    }
    if (s.ai.asrMode === 'relay' && s.ai.relayUrl) {
      const perm3 = await ensurePermission(s.ai.relayUrl);
      if (!perm3.ok) {
        $('saved').textContent = '保存失败（转发地址）：' + perm3.error;
        return;
      }
    }
    await V.saveSettings(s);
    $('saved').textContent = '已保存 ✓';
    setTimeout(function () {
      $('saved').textContent = '';
    }, 2000);
  });

  $('test').addEventListener('click', async function () {
    const s = collect();
    const res0 = $('testResult');
    if (!s.ai.baseUrl || !s.ai.model) {
      res0.textContent = '请先填写 Base URL 和模型名';
      return;
    }
    const perm = await ensurePermission(s.ai.baseUrl);
    if (!perm.ok) {
      res0.textContent = perm.error;
      return;
    }
    res0.textContent = '测试中…';
    try {
      const r = await chrome.runtime.sendMessage({ type: 'aiTest', config: s.ai });
      res0.textContent = r && r.ok ? '连接成功，示例译文：' + (r.sample || '(空)') : '失败：' + ((r && r.error) || '未知错误');
    } catch (e) {
      res0.textContent = '失败：' + String(e);
    }
  });

  // 生成 1 秒静音 WAV，用于探测识别接口是否存在该路由
  function silentWav() {
    const rate = 16000;
    const n = rate; // 1s
    const buf = new ArrayBuffer(44 + n * 2);
    const dv = new DataView(buf);
    const w = function (o, s) {
      for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
    };
    w(0, 'RIFF');
    dv.setUint32(4, 36 + n * 2, true);
    w(8, 'WAVE');
    w(12, 'fmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true);
    dv.setUint32(28, rate * 2, true);
    dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true);
    w(36, 'data');
    dv.setUint32(40, n * 2, true);
    return new Uint8Array(buf);
  }

  function parseHeaderLines(text) {
    const h = {};
    String(text || '')
      .split(/\r?\n/)
      .forEach(function (line) {
        const i = line.indexOf(':');
        if (i > 0) {
          const k = line.slice(0, i).trim();
          const v = line.slice(i + 1).trim();
          if (k) h[k] = v;
        }
      });
    return h;
  }

  $('testAsr').addEventListener('click', async function () {
    const s = collect();
    const out = $('testAsrResult');
    const base = s.ai.asrBaseUrl || s.ai.baseUrl;
    const key = s.ai.asrKey || s.ai.apiKey;
    if (!base) {
      out.textContent = '请先填写识别接口地址（或上面的 Base URL）';
      return;
    }
    const perm = await ensurePermission(base);
    if (!perm.ok) {
      out.textContent = perm.error;
      return;
    }
    out.textContent = '测试中…';
    const fd = new FormData();
    fd.append('file', new Blob([silentWav()], { type: 'audio/wav' }), 'test.wav');
    fd.append('model', s.ai.asrModel || 'whisper-1');
    fd.append('response_format', 'verbose_json');
    if (s.ai.asrLang) fd.append('language', s.ai.asrLang);
    const headers = Object.assign({ Authorization: 'Bearer ' + (key || '') }, parseHeaderLines(s.ai.asrHeaders));
    const path = s.ai.asrPath || '/audio/transcriptions';
    const url = base.replace(/\/+$/, '') + (path[0] === '/' ? path : '/' + path);
    try {
      const r = await fetch(url, { method: 'POST', headers: headers, body: fd });
      const t = await r.text();
      if (r.ok) out.textContent = '识别接口可用 ✓';
      else if (r.status === 404)
        out.textContent = '该地址不支持 ' + path + '（404）：请检查路径或换用支持语音识别的服务';
      else out.textContent = '返回 ' + r.status + '：' + t.slice(0, 140);
    } catch (e) {
      out.textContent = '失败：' + String(e.message || e);
    }
  });

  function toggleAsrMode() {
    const m = $('asrMode').value;
    $('asrOpenai').style.display = m === 'openai' ? '' : 'none';
    $('asrRelay').style.display = m === 'relay' ? '' : 'none';
    $('asrLocal').style.display = m === 'local' ? '' : 'none';
  }
  $('asrMode').addEventListener('change', function () {
    toggleAsrMode();
    // 立即保存识别方式，避免忘记点“保存设置”
    V.saveSettings({ ai: { asrMode: $('asrMode').value } });
  });

  $('testRelay').addEventListener('click', async function () {
    const out = $('testRelayResult');
    const url = ($('relayUrl').value.trim() || 'http://127.0.0.1:8788').replace(/\/+$/, '');
    out.textContent = '测试中…';
    const perm = await ensurePermission(url);
    if (!perm.ok) {
      out.textContent = '需要授权访问本机服务：' + perm.error;
      return;
    }
    try {
      const r = await fetch(url + '/health');
      const j = await r.json().catch(function () {
        return {};
      });
      out.textContent = r.ok ? '转发服务在线 ✓' + (j.upstream ? '（上游 ' + j.upstream + '）' : '') : '返回 ' + r.status;
    } catch (e) {
      out.textContent = '连不上转发服务，请确认已运行 node relay.js（' + String(e.message || e) + '）';
    }
  });

  $('clearCache').addEventListener('click', async function () {
    const out = $('clearCacheResult');
    if (!confirm('确定清除所有已保存的字幕/翻译缓存？不可撤销（设置与生词本会保留）。')) return;
    out.textContent = '清除中…';
    try {
      const r = await chrome.runtime.sendMessage({ type: 'cacheClear' });
      out.textContent = r && r.ok ? '已清除 ✓（回到 TED 页会自动重新加载字幕）' : '失败：' + ((r && r.error) || '未知');
    } catch (e) {
      out.textContent = '失败：' + String(e);
    }
  });

  load();
})();
