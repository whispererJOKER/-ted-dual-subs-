/* 极简静态服务器，仅用于本地预览： node tools/serve.cjs [port] */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const port = Number(process.argv[2] || 8756);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
};

http
  .createServer(function (req, res) {
    let p = decodeURIComponent(req.url.split('?')[0]);
    // 开发用代理： /proxy?url=<encoded>  （绕过浏览器跨域限制，仅本地测试）
    if (p === '/proxy') {
      const q = new URL(req.url, 'http://localhost');
      const target = q.searchParams.get('url');
      if (!target) {
        res.writeHead(400);
        return res.end('missing url');
      }
      fetch(target, { headers: { 'user-agent': 'Mozilla/5.0 Chrome/124' } })
        .then(function (r) {
          return r.arrayBuffer().then(function (buf) {
            res.writeHead(200, { 'Content-Type': r.headers.get('content-type') || 'application/octet-stream' });
            res.end(Buffer.from(buf));
          });
        })
        .catch(function (e) {
          res.writeHead(502);
          res.end('proxy error: ' + e.message);
        });
      return;
    }
    // 开发用：把 /hfmirror/* 转发到 hf-mirror.com（本地测试 transformers.js 模型下载）
    if (p === '/hfmirror' || p.indexOf('/hfmirror/') === 0) {
      const target = 'https://hf-mirror.com' + p.slice('/hfmirror'.length);
      fetch(target, { headers: { 'user-agent': 'Mozilla/5.0 Chrome/124' } })
        .then(function (r) {
          return r.arrayBuffer().then(function (buf) {
            res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/octet-stream' });
            res.end(Buffer.from(buf));
          });
        })
        .catch(function (e) {
          res.writeHead(502);
          res.end('hfmirror error: ' + e.message);
        });
      return;
    }
    if (p === '/') p = '/tools/preview.html';
    const file = path.join(root, p);
    if (!file.startsWith(root)) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    fs.readFile(file, function (err, data) {
      if (err) {
        res.writeHead(404);
        return res.end('not found: ' + p);
      }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(port, function () {
    console.log('预览服务已启动： http://localhost:' + port + '/tools/preview.html');
  });
