/* TED 双语字幕 —— 自动识别（抓 TED 音轨 → TS 转 m4a → 云端语音识别） */
(function () {
  'use strict';
  const REQ_KEY = 'tedl_asr_request';
  const CHUNK_SECONDS = 600; // 云端识别单段最长时长（本地模式另有小节）

  const $ = function (id) {
    return document.getElementById(id);
  };
  function log(t) {
    const el = $('log');
    el.textContent += (el.textContent ? '\n' : '') + t;
    el.scrollTop = el.scrollHeight;
  }

  function pickAudioUri(master) {
    // 取 TYPE=AUDIO 的分组，优先 DEFAULT=YES，其次声道多的
    const lines = String(master).split('\n').filter(function (l) {
      return l.indexOf('#EXT-X-MEDIA') === 0 && /TYPE=AUDIO/i.test(l);
    });
    let best = null;
    let bestScore = -1;
    for (const l of lines) {
      const uri = (l.match(/URI="([^"]+)"/) || [])[1];
      if (!uri) continue;
      let score = 0;
      if (/DEFAULT=YES/i.test(l)) score += 10;
      const ch = (l.match(/CHANNELS="(\d+)"/) || [])[1];
      score += Number(ch) || 0;
      if (score > bestScore) {
        bestScore = score;
        best = uri;
      }
    }
    return best;
  }

  function parsePlaylist(text) {
    // 音频清单里片头（另一个 project）与正片之间有 #EXT-X-DISCONTINUITY；
    // 丢弃首个 discontinuity 之前的分片，让音频从正片 0 秒开始。
    const lines = String(text).split('\n');
    let firstDisc = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().indexOf('#EXT-X-DISCONTINUITY') === 0) {
        firstDisc = i;
        break;
      }
    }
    const out = [];
    let dur = 0;
    lines.forEach(function (raw, i) {
      const l = raw.trim();
      if (l.indexOf('#EXTINF:') === 0) dur = parseFloat(l.slice(8)) || 0;
      else if (l && l[0] !== '#' && /\.(ts|m4s|aac|mp4)/i.test(l)) {
        if (firstDisc < 0 || i > firstDisc) out.push({ url: l, dur: dur });
        dur = 0;
      }
    });
    return out;
  }

  async function fetchBytes(url) {
    const r = await fetch(url, { credentials: 'omit' });
    if (!r.ok) throw new Error('下载音频失败 ' + r.status);
    return new Uint8Array(await r.arrayBuffer());
  }

  function concat(arrs) {
    let len = 0;
    arrs.forEach(function (a) {
      len += a.length;
    });
    const o = new Uint8Array(len);
    let off = 0;
    arrs.forEach(function (a) {
      o.set(a, off);
      off += a.length;
    });
    return o;
  }

  function transmux(arrays) {
    const t = new muxjs.mp4.Transmuxer({ remux: true });
    let init = null;
    const parts = [];
    t.on('data', function (seg) {
      if (seg.initSegment && !init) init = seg.initSegment;
      if (seg.data) parts.push(seg.data);
    });
    arrays.forEach(function (u8) {
      t.push(u8);
      t.flush();
    });
    return concat([init].concat(parts).filter(Boolean));
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

  async function transcribe(wavBytes, cfg) {
    const fd = new FormData();
    fd.append('file', new Blob([wavBytes], { type: 'audio/wav' }), 'audio.wav');
    fd.append('model', cfg.model || 'whisper-1');
    fd.append('response_format', 'verbose_json');
    if (cfg.lang) fd.append('language', cfg.lang);
    const headers = Object.assign(
      { Authorization: 'Bearer ' + (cfg.apiKey || '') },
      parseHeaderLines(cfg.headers)
    );
    const path = cfg.path || '/audio/transcriptions';
    const url = String(cfg.baseUrl || '').replace(/\/+$/, '') + (path[0] === '/' ? path : '/' + path);
    const res = await fetch(url, { method: 'POST', headers: headers, body: fd });
    if (!res.ok) {
      const t = await res.text().catch(function () {
        return '';
      });
      if (res.status === 404) {
        throw new Error('该接口不支持 ' + path + '（404）。请在设置里检查「识别路径」，或换用支持语音转写的服务。');
      }
      throw new Error('识别接口返回 ' + res.status + ' ' + t.slice(0, 200));
    }
    return res.json();
  }

  async function ensureHostPermission(url) {
    try {
      const u = new URL(url);
      const origin = u.protocol + '//' + u.host + '/*';
      if (await chrome.permissions.contains({ origins: [origin] })) return true;
      return await chrome.permissions.request({ origins: [origin] });
    } catch (e) {
      return false;
    }
  }

  /** 把 m4a 解码并重采样为 16k 单声道 Float32（Whisper 需要） */
  async function decodeToFloat32(m4aBytes) {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    let buf;
    try {
      buf = await ac.decodeAudioData(m4aBytes.buffer.slice(0));
    } finally {
      try {
        ac.close();
      } catch (e) {}
    }
    const rate = 16000;
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * rate)), rate);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return rendered.getChannelData(0);
  }

  /** Float32 -> 16bit PCM（百炼实时识别需要） */
  async function decodeToPcm16k(m4aBytes) {
    const f32 = await decodeToFloat32(m4aBytes);
    const pcm = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return pcm;
  }

  let _localAsr = null;
  let _localKey = '';

  /** 加载/复用本地 whisper 识别管道（transformers.js） */
  async function getLocalTranscriber(cfg) {
    const short = cfg.model || 'whisper-tiny.en';
    const modelId = String(short).indexOf('/') >= 0 ? short : 'onnx-community/' + short;
    const key = modelId + '|' + (cfg.dtype || 'q8');
    if (_localAsr && _localKey === key) return _localAsr;
    // 相对 asr.html 解析： src/asr/vendor/transformers.min.js
    const T = await import('./vendor/transformers.min.js');
    const env = T.env;
    env.allowLocalModels = false;
    env.remoteHost = cfg.host || 'https://hf-mirror.com';
    env.remotePathTemplate = '{model}/resolve/{revision}/';
    if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
      env.backends.onnx.wasm.numThreads = 1;
      // 本地内置 ONNX Runtime wasm（扩展 CSP 不允许加载远程脚本）
      env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('src/asr/vendor/ort/');
    }
    _localAsr = await T.pipeline('automatic-speech-recognition', modelId, {
      dtype: cfg.dtype || 'q8',
      device: 'wasm',
    });
    _localKey = key;
    return _localAsr;
  }

  /** Int16 PCM -> WAV 字节（FunASR 等本地服务对 WAV 兼容性最好） */
  function pcmToWav(pcm, rate) {
    const n = pcm.length;
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
    new Int16Array(buf, 44, n).set(pcm);
    return new Uint8Array(buf);
  }

  /** 把 PCM 发到本机转发服务，由它带上 Authorization 头转给百炼 */
  async function transcribeRelay(pcm, cfg) {
    const url = String(cfg.baseUrl || '').replace(/\/+$/, '') + '/transcribe';
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Api-Key': cfg.apiKey || '',
          'X-Model': cfg.model || 'paraformer-realtime-v2',
          'X-Sample-Rate': '16000',
          'X-Speed': String(cfg.speed || 4),
        },
        body: pcm.buffer,
      });
    } catch (e) {
      throw new Error('连不上转发服务（' + url + '）：请确认已运行 node relay.js');
    }
    if (!res.ok) {
      const t = await res.text().catch(function () {
        return '';
      });
      throw new Error('转发服务返回 ' + res.status + ' ' + t.slice(0, 200));
    }
    const j = await res.json();
    if (!j || !j.ok) throw new Error((j && j.error) || '转发服务识别失败');
    return j;
  }

  /** 接口没返回时间戳时，按句子文本长度把总时长按比例分摊 */
  function estimateSegments(text, durSec) {
    const parts = String(text || '')
      .split(/(?<=[.?!。？！])\s*/)
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
    if (!parts.length) return [];
    const total = parts.reduce(function (a, s) {
      return a + s.length;
    }, 0) || 1;
    let t = 0;
    return parts.map(function (s) {
      const d = (durSec * s.length) / total;
      const seg = { start: t, end: t + d, text: s };
      t += d;
      return seg;
    });
  }

  let busy = false;

  async function run() {
    if (busy) return;
    busy = true;
    $('start').disabled = true;
    try {
      const got = await chrome.storage.local.get(REQ_KEY);
      const req = got[REQ_KEY];
      if (!req || !req.projectId) {
        log('没有识别任务。请在 TED 演讲页点字幕条的 🎙 按钮。');
        return;
      }
      if (!req.config) {
        log('无识别配置，请在设置里选择识别方式。');
        return;
      }
      if (req.config.mode === 'relay') {
        if (!req.config.baseUrl || !req.config.apiKey) {
          log('百炼模式：请在设置里填写「百炼 API Key」与「转发地址」。');
          return;
        }
        const ok = await ensureHostPermission(req.config.baseUrl);
        if (!ok) {
          log('未授权访问转发服务地址 ' + req.config.baseUrl + '，请重试并在弹窗中选择“允许”。');
          return;
        }
      } else if (req.config.mode === 'openai') {
        if (!req.config.baseUrl) {
          log('请在设置里填写「识别接口地址」。');
          return;
        }
      }
      $('meta').textContent = (req.title || '') + ' · talk#' + req.talkId;
      const base = 'https://hls.ted.com/project_masters/' + req.projectId + '/';
      const masterUrl = base + 'manifest.m3u8' + (req.introMasterId ? '?intro_master_id=' + req.introMasterId : '');

      log('① 读取音轨列表…');
      const master = await (await fetch(masterUrl, { credentials: 'omit' })).text();
      const audioUri = pickAudioUri(master);
      if (!audioUri) throw new Error('未找到音频音轨');
      const playlist = await (await fetch(base + audioUri, { credentials: 'omit' })).text();
      const entries = parsePlaylist(playlist);
      log('   找到 ' + entries.length + ' 个音频分片');

      // 分小段识别：本地 Whisper 用 ~30s 一段（边识别边出字幕），云端用较大段
      const chunkSec = req.config.mode === 'local' ? 30 : CHUNK_SECONDS;
      const chunks = [];
      let cur = [];
      let curDur = 0;
      entries.forEach(function (e) {
        cur.push(e);
        curDur += e.dur;
        if (curDur >= chunkSec) {
          chunks.push({ items: cur, dur: curDur });
          cur = [];
          curDur = 0;
        }
      });
      if (cur.length) chunks.push({ items: cur, dur: curDur });
      log('   分为 ' + chunks.length + ' 段识别');

      const introSec = 0; // 片头分片已丢弃，音频从正片 0 秒开始
      const cues = [];
      let timeOffset = 0;
      let failed = 0;

      const saveDoc = function (partial, done) {
        return chrome.runtime.sendMessage({
          type: 'docPatchEn',
          talkId: String(req.talkId),
          title: req.title || '',
          cues: cues.slice(),
          meta: {
            enSource: 'asr',
            asr: {
              model: req.config && req.config.model,
              partial: !!partial,
              done: !!done,
              updated: Date.now(),
            },
          },
        });
      };

      for (let ci = 0; ci < chunks.length; ci++) {
        const ch = chunks[ci];
        log('② 下载音频 ' + (ci + 1) + '/' + chunks.length + '（' + Math.round(ch.dur) + 's）…');
        const arrays = [];
        for (let i = 0; i < ch.items.length; i++) {
          arrays.push(await fetchBytes(ch.items[i].url));
        }
        const m4a = transmux(arrays);
        let segs = null;
        if (req.config.mode === 'relay') {
          log('   转码 ' + (m4a.length / 1024).toFixed(0) + ' KB，解码为 PCM…');
          let pcm;
          try {
            pcm = await decodeToPcm16k(m4a);
          } catch (e) {
            failed++;
            log('   音频解码失败：' + (e.message || e));
            timeOffset += ch.dur;
            continue;
          }
          log('   PCM ' + (pcm.length / 1024 / 1024).toFixed(2) + ' MB，发送到转发服务识别…');
          let jr;
          try {
            jr = await transcribeRelay(pcm, req.config);
          } catch (e) {
            failed++;
            log('   该段识别失败：' + (e.message || e));
            timeOffset += ch.dur;
            continue;
          }
          segs = jr && Array.isArray(jr.segments) && jr.segments.length ? jr.segments : null;
          if (!segs) {
            segs = estimateSegments((jr && jr.text) || '', ch.dur);
            if (segs.length) log('   转发服务未返回时间戳，已按文本长度估算');
          }
        } else if (req.config.mode === 'local') {
          log('   转码 ' + (m4a.length / 1024).toFixed(0) + ' KB，本地 Whisper 识别中…');
          let f32;
          try {
            f32 = await decodeToFloat32(m4a);
          } catch (e) {
            failed++;
            log('   音频解码失败：' + (e.message || e));
            timeOffset += ch.dur;
            continue;
          }
          let asr;
          try {
            if (!_localAsr) log('   首次使用需加载/下载模型，请耐心等待…');
            asr = await getLocalTranscriber(req.config);
          } catch (e) {
            failed++;
            log('   模型加载失败：' + (e.message || e));
            break;
          }
          let r;
          try {
            r = await asr(f32, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 });
          } catch (e) {
            failed++;
            log('   识别失败：' + (e.message || e));
            timeOffset += ch.dur;
            continue;
          }
          segs = (r && r.chunks ? r.chunks : [])
            .map(function (c) {
              const ts = c.timestamp || [0, null];
              return {
                start: Number(ts[0]) || 0,
                end: ts[1] == null ? ch.dur : Number(ts[1]),
                text: String(c.text || '').trim(),
              };
            })
            .filter(function (s) {
              return s.text;
            });
          if (!segs.length && r && r.text) segs = estimateSegments(r.text, ch.dur);
        } else {
          log('   转码 ' + (m4a.length / 1024).toFixed(0) + ' KB，解码为 16k WAV 上传…');
          let pcm;
          try {
            pcm = await decodeToPcm16k(m4a);
          } catch (e) {
            failed++;
            log('   音频解码失败：' + (e.message || e));
            timeOffset += ch.dur;
            continue;
          }
          const wav = pcmToWav(pcm, 16000);
          let j;
          try {
            j = await transcribe(wav, req.config);
          } catch (e) {
            failed++;
            log('   该段识别失败：' + (e.message || e));
            if (/404/.test(String(e.message || e))) {
              log('   → 终止：该接口不提供语音识别，请到设置里改「识别接口地址」');
              break;
            }
            timeOffset += ch.dur;
            continue;
          }
          segs = j && Array.isArray(j.segments) && j.segments.length ? j.segments : null;
          if (!segs) {
            const text = (j && (j.text || (j.results && j.results[0] && j.results[0].text))) || '';
            segs = estimateSegments(text, ch.dur);
            if (segs.length) log('   注意：接口未返回时间戳，已按文本长度估算时间轴');
          }
        }
        (segs || []).forEach(function (s) {
          const start = Math.round((s.start + timeOffset - introSec) * 1000);
          const end = Math.round((s.end + timeOffset - introSec) * 1000);
          const text = String(s.text || '').trim();
          if (text) cues.push({ start: Math.max(0, start), end: Math.max(0, end), en: text, zh: '' });
        });
        timeOffset += ch.dur;
        log('   累计 ' + cues.length + ' 句');
        // 本地模式：每段完成就写回文档，TED 页实时看到字幕
        if (req.config.mode === 'local') {
          await saveDoc(true, false);
        }
      }

      cues.sort(function (a, b) {
        return a.start - b.start;
      });
      await saveDoc(false, true);
      $('status').textContent =
        '识别完成：' + cues.length + ' 句' + (failed ? '（' + failed + ' 段失败）' : '') + '，可关闭本页回到 TED 演讲页。';
      log('③ 完成，已保存 ' + cues.length + ' 句。回到 TED 页即可看到字幕。');
    } catch (e) {
      log('出错：' + (e.message || e));
      $('status').textContent = '识别失败';
    } finally {
      busy = false;
      $('start').disabled = false;
    }
  }

  $('start').addEventListener('click', run);

  (async function boot() {
    const got = await chrome.storage.local.get(REQ_KEY);
    const req = got[REQ_KEY];
    if (req && req.title) {
      $('meta').textContent = req.title + ' · talk#' + req.talkId + ' · 模型 ' + ((req.config && req.config.model) || 'whisper-1');
    } else {
      $('meta').textContent = '没有识别任务：请先在 TED 演讲页点 🎙。';
    }
  })();
})();