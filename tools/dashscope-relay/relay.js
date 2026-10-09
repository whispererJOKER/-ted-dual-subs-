/* TED 字幕扩展 —— 阿里云百炼 Paraformer 实时语音识别 本地转发服务
 *
 * 作用：浏览器扩展无法给 WebSocket 握手加 Authorization 头，也拿不到公网音频 URL。
 * 本服务在本机接收扩展发来的 PCM 音频，带上 Authorization 头连到百炼的实时识别
 * WebSocket，把识别结果以 JSON 返回。
 *
 * 运行：
 *   cd tools/dashscope-relay
 *   npm install        (安装 ws 依赖)
 *   node relay.js      (默认监听 127.0.0.1:8788)
 *
 * 环境变量：
 *   PORT       监听端口，默认 8788
 *   DASHSCOPE_WS  上游地址，默认 wss://dashscope.aliyuncs.com/api-ws/v1/inference
 */
'use strict';
const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 8788);
const UPSTREAM = process.env.DASHSCOPE_WS || 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'content-type,x-api-key,x-model,x-sample-rate,x-speed'
  );
  // 允许浏览器(含扩展页)从公网上下文访问本机私有网络
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

/** 用百炼实时识别识别一段 PCM(16bit/单声道)，返回 { ok, segments, text } */
function runDashscope(pcm, opts) {
  return new Promise((resolve, reject) => {
    const taskId = crypto.randomUUID();
    let ws;
    try {
      ws = new WebSocket(UPSTREAM, {
        headers: {
          Authorization: 'Bearer ' + opts.apiKey,
          'X-DashScope-DataInspection': 'enable',
        },
      });
    } catch (e) {
      return reject(e);
    }

    const sentences = Object.create(null);
    let settled = false;
    let safety = null;

    function cleanup() {
      if (safety) clearTimeout(safety);
    }
    function finishOk() {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        ws.close();
      } catch (e) {}
      const segments = Object.keys(sentences)
        .map((k) => sentences[k])
        .filter((s) => s && s.text)
        .map((s) => ({
          start: (Number(s.begin_time) || 0) / 1000,
          end: (Number(s.end_time) || 0) / 1000,
          text: s.text,
        }))
        .sort((a, b) => a.start - b.start);
      resolve({ ok: true, segments: segments, text: segments.map((s) => s.text).join('') });
    }
    function fail(err) {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        ws.close();
      } catch (e) {}
      reject(err);
    }

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
          payload: {
            task_group: 'audio',
            task: 'asr',
            function: 'recognition',
            model: opts.model,
            parameters: { format: 'pcm', sample_rate: opts.sampleRate },
            input: {},
          },
        })
      );
    });

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        return;
      }
      const ev = msg.header && msg.header.event;
      if (ev === 'task-started') {
        streamAudio();
      } else if (ev === 'result-generated') {
        const s = msg.payload && msg.payload.output && msg.payload.output.sentence;
        if (s) {
          const id = s.sentence_id != null ? String(s.sentence_id) : 'b' + s.begin_time;
          sentences[id] = s;
        }
      } else if (ev === 'task-finished') {
        finishOk();
      } else if (ev === 'task-failed') {
        const m = (msg.header && (msg.header.error_message || msg.header.error_code)) || 'task-failed';
        fail(new Error('百炼识别失败：' + m));
      }
    });

    ws.on('error', (e) => fail(e));

    function streamAudio() {
      const frame = Math.round((opts.sampleRate * 2) / 10); // 100ms 的 16bit 单声道
      const gap = Math.max(0, Math.round(100 / opts.speed)); // speed 倍速（1=实时）
      let i = 0;
      (function next() {
        if (settled) return;
        if (i >= pcm.length) {
          try {
            ws.send(
              JSON.stringify({
                header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
                payload: { input: {} },
              })
            );
          } catch (e) {}
          safety = setTimeout(finishOk, 20000); // 收尾兜底
          return;
        }
        try {
          ws.send(pcm.subarray(i, Math.min(i + frame, pcm.length)));
        } catch (e) {
          return fail(e);
        }
        i += frame;
        setTimeout(next, gap);
      })();
    }
  });
}

const server = http.createServer((req, res) => {
  setCors(res);
  const path = req.url.split('?')[0];
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  if (req.method === 'GET' && path === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, upstream: UPSTREAM }));
  }
  if (req.method !== 'POST' || path !== '/transcribe') {
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'not found' }));
  }

  const apiKey = req.headers['x-api-key'] || '';
  const model = req.headers['x-model'] || 'paraformer-realtime-v2';
  const sampleRate = Number(req.headers['x-sample-rate'] || 16000);
  const speed = Number(req.headers['x-speed'] || 4) || 4;
  if (!apiKey) {
    res.writeHead(400, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: '缺少 X-Api-Key 请求头' }));
  }

  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('error', (e) => {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
  });
  req.on('end', () => {
    const pcm = Buffer.concat(chunks);
    if (!pcm.length) {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: '空音频' }));
    }
    const started = Date.now();
    console.log(
      '[relay] 收到 ' + (pcm.length / 1024 / 1024).toFixed(2) + ' MB PCM，model=' + model + ' rate=' + sampleRate + ' speed=' + speed
    );
    runDashscope(pcm, { apiKey, model, sampleRate, speed })
      .then((r) => {
        console.log('[relay] 完成，' + r.segments.length + ' 句，用时 ' + ((Date.now() - started) / 1000).toFixed(1) + 's');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(r));
      })
      .catch((e) => {
        console.error('[relay] 失败：' + (e.message || e));
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  百炼识别转发服务已启动');
  console.log('  监听：  http://127.0.0.1:' + PORT);
  console.log('  上游：  ' + UPSTREAM);
  console.log('  扩展设置里的「转发地址」填：http://127.0.0.1:' + PORT);
  console.log('');
});
