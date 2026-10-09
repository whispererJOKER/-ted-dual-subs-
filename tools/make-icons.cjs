/* 生成扩展图标 PNG（TED 红底 + 白色字幕条图案），无需依赖库。
 * 运行： node tools/make-icons.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (function () {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function png(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a) => {
    const i = (y * size + x) * 4;
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = a;
  };
  const radius = size * 0.22;
  const inCorner = (x, y) => {
    const cx = x < radius ? radius : x > size - radius - 1 ? size - radius - 1 : x;
    const cy = y < radius ? radius : y > size - radius - 1 ? size - radius - 1 : y;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  };
  // 红底
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inCorner(x, y)) set(x, y, 230, 43, 30, 255);
      else set(x, y, 0, 0, 0, 0);
    }
  }
  // 白色字幕条：两条圆角横杠
  const bar = (bx, by, bw, bh) => {
    const r = bh / 2;
    for (let y = by; y < by + bh; y++) {
      for (let x = bx; x < bx + bw; x++) {
        const cx = Math.min(Math.max(x, bx + r), bx + bw - r);
        const cy = by + r;
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r * r) set(x, y, 255, 255, 255, 255);
      }
    }
  };
  const m = size * 0.22;
  const w = size - m * 2;
  const bh = Math.max(2, Math.round(size * 0.13));
  bar(Math.round(m), Math.round(size * 0.32 - bh / 2), Math.round(w), bh);
  bar(Math.round(m + w * 0.18), Math.round(size * 0.62 - bh / 2), Math.round(w * 0.82), bh);
  return png(size, size, buf);
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
[16, 32, 48, 128].forEach((s) => {
  const file = path.join(outDir, 'icon' + s + '.png');
  fs.writeFileSync(file, render(s));
  console.log('写出 ' + file);
});
console.log('图标生成完成');
