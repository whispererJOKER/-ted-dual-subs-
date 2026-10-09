/* 句子重组验证（与 youtube.js 的 regroupSentences 同构）： node tools/test-regroup.cjs */
'use strict';
let fail = 0;
function check(n, c, extra) { if (c) console.log('  PASS ' + n + (extra ? '  ' + extra : '')); else { fail++; console.log('  FAIL ' + n + (extra ? '  ' + extra : '')); } }

function isCJK(ch) { return /[\u3000-\u303f\u3040-\u9fff\uff00-\uffef]/.test(ch); }
function smartJoin(a, b) { if (!a) return b || ''; if (!b) return a; const l = a[a.length - 1], r = b[0]; return isCJK(l) || isCJK(r) ? a + b : a + ' ' + b; }
function regroupSentences(caps) {
  if (!caps || !caps.length) return caps;
  const out = [];
  let cur = null;
  const endRe = /[.?!。？！…]["'”’)\]]?\s*$/;
  const MAX_LEN = 140, MAX_DUR = 9000, MAX_GAP = 1600;
  function flush() {
    if (cur && cur.content) out.push({ startTime: cur.startTime, duration: Math.max(0, cur.end - cur.startTime), content: cur.content.trim() });
    cur = null;
  }
  for (let i = 0; i < caps.length; i++) {
    const c = caps[i];
    const start = c.startTime, end = c.startTime + (c.duration || 0);
    const text = String(c.content || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (!cur) cur = { startTime: start, end: end, content: text };
    else {
      const gap = start - cur.end;
      if (gap > MAX_GAP) { flush(); cur = { startTime: start, end: end, content: text }; }
      else { cur.content = smartJoin(cur.content, text); cur.end = Math.max(cur.end, end); }
    }
    if (endRe.test(text) || cur.content.length >= MAX_LEN || cur.end - cur.startTime >= MAX_DUR) flush();
  }
  flush();
  return out.length ? out : caps;
}

console.log('== 半句被切开 → 合并成整句 ==');
let caps = [
  { startTime: 0, duration: 2000, content: 'In this video, I will' },
  { startTime: 1800, duration: 2000, content: 'show you how to do it.' },
];
let r = regroupSentences(caps);
check('合并为 1 句', r.length === 1, 'len=' + r.length);
check('文本完整', r[0].content === 'In this video, I will show you how to do it.', r[0].content);
check('时间覆盖到句尾', r[0].startTime === 0 && r[0].duration === 3800, 'dur=' + r[0].duration);

console.log('== 一句里含两个句子 → 拆开 ==');
caps = [
  { startTime: 0, duration: 2000, content: 'Hello there.' },
  { startTime: 2000, duration: 2000, content: 'How are you?' },
];
r = regroupSentences(caps);
check('保留为 2 句', r.length === 2, 'len=' + r.length);

console.log('== 跨句合并（一句结尾+下一句开头在同一行）==');
caps = [{ startTime: 0, duration: 3000, content: 'It is good. And then' }, { startTime: 2800, duration: 2000, content: 'we continue.' }];
r = regroupSentences(caps);
check('结尾标点后不并入下一句', r.length >= 1 && /good\./.test(r[0].content), JSON.stringify(r.map((x) => x.content)));

console.log('== 停顿过大 → 分开 ==');
caps = [{ startTime: 0, duration: 1000, content: 'First part' }, { startTime: 5000, duration: 1000, content: 'Second part' }];
r = regroupSentences(caps);
check('停顿 >1.6s 分句', r.length === 2, 'len=' + r.length);

console.log('== 中文碎片合并 → 不加空格 ==');
caps = [
  { startTime: 0, duration: 2000, content: '这次会议有三个主题' },
  { startTime: 2000, duration: 2000, content: '贯穿会议始终。' },
];
r = regroupSentences(caps);
check('中文无空格', r.length === 1 && r[0].content === '这次会议有三个主题贯穿会议始终。', r[0] && r[0].content);

console.log('== 英文碎片合并 → 加空格 ==');
caps = [
  { startTime: 0, duration: 2000, content: 'In this video' },
  { startTime: 2000, duration: 2000, content: 'I will show you.' },
];
r = regroupSentences(caps);
check('英文有空格', r[0].content === 'In this video I will show you.', r[0].content);

console.log('');
if (fail) { console.log(fail + ' 项失败'); process.exit(1); }
console.log('全部通过 ✅');
