/* YouTube json3 解析 + URL 规整 验证： node tools/test-youtube.cjs */
'use strict';
let fail = 0;
function check(n, c, extra) { if (c) console.log('  PASS ' + n + (extra ? '  ' + extra : '')); else { fail++; console.log('  FAIL ' + n + (extra ? '  ' + extra : '')); } }

function normalizeUrl(baseUrl, tlang) {
  let url = String(baseUrl || '').replace(/[&?]fmt=[^&]*/g, '');
  if (!url) return null;
  url += (url.indexOf('?') >= 0 ? '&' : '?') + 'fmt=json3';
  if (tlang) url += '&tlang=' + encodeURIComponent(tlang);
  return url;
}
function parseJson3(j) {
  const evs = (j && j.events) || [];
  return evs
    .filter((e) => e.segs && e.segs.length)
    .map((e) => ({
      startTime: e.tStartMs || 0,
      duration: e.dDurationMs || 0,
      content: e.segs.map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim(),
    }))
    .filter((c) => c.content);
}

console.log('== URL 规整 ==');
check('追加 fmt=json3', normalizeUrl('https://x/api/timedtext?v=1&lang=en') === 'https://x/api/timedtext?v=1&lang=en&fmt=json3');
check('替换已有 fmt', normalizeUrl('https://x/api/timedtext?v=1&fmt=srv3') === 'https://x/api/timedtext?v=1&fmt=json3');
check('加 tlang', normalizeUrl('https://x/t?v=1', 'zh-Hans') === 'https://x/t?v=1&fmt=json3&tlang=zh-Hans');

console.log('== json3 解析 ==');
const j = {
  events: [
    { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'Hello ' }, { utf8: 'world' }] },
    { tStartMs: 2000, dDurationMs: 1500, segs: [{ utf8: '\n' }] }, // 仅换行，应跳过
    { tStartMs: 3500, dDurationMs: 1800, segs: [{ utf8: 'How are you?' }] },
  ],
};
const caps = parseJson3(j);
check('跳过空事件', caps.length === 2, 'len=' + caps.length);
check('合并 segs', caps[0].content === 'Hello world', caps[0].content);
check('时间戳毫秒', caps[1].startTime === 3500 && caps[1].duration === 1800);

// 与 align 对接（TED 字幕同结构）
require('../src/lib/align.js');
const cues = globalThis.TEDL.align.align(caps, [{ startTime: 0, duration: 2000, content: '你好，世界' }, { startTime: 3500, duration: 1800, content: '你好吗？' }]);
check('align 生成双语', cues.length === 2 && cues[0].zh === '你好，世界' && cues[1].en === 'How are you?', JSON.stringify(cues));

console.log('');
if (fail) { console.log(fail + ' 项失败'); process.exit(1); }
console.log('全部通过 ✅');
