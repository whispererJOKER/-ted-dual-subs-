/* 长句切块验证： node tools/test-split.cjs */
'use strict';
let fail = 0;
function check(n, c, extra) { if (c) console.log('  PASS ' + n + (extra ? '  ' + extra : '')); else { fail++; console.log('  FAIL ' + n + (extra ? '  ' + extra : '')); } }

const CJK_CLOSE = '，。！？、；：）】》」』”’…—～.,!?;:)]}';
const CJK_OPEN = '（【《「『“‘([{';
function adjustBreak(text, b, prev) {
  let i = b;
  while (i < text.length && CJK_CLOSE.indexOf(text[i]) >= 0) i++;
  if (i !== b) b = i;
  while (b > prev + 1 && CJK_OPEN.indexOf(text[b - 1]) >= 0) b--;
  return b;
}
function textBreaks(text, k, snap) {
  const len = text.length;
  const br = [0];
  for (let i = 1; i < k; i++) {
    let idx = Math.min(len - 1, Math.max(1, Math.round((len * i) / k)));
    if (snap) {
      let j = idx;
      while (j > 0 && text[j] !== ' ') j--;
      if (j === 0) { j = idx; while (j < len && text[j] !== ' ') j++; }
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
function splitLongCues(cues, maxEn, maxZh) {
  const out = [];
  (cues || []).forEach(function (c) {
    const en = String(c.en || ''); const zh = String(c.zh || '');
    const k = Math.max(Math.ceil(en.length / maxEn), zh ? Math.ceil(zh.length / maxZh) : 1, 1);
    if (k <= 1) { out.push({ start: c.start, end: c.end, en, zh }); return; }
    const enBr = textBreaks(en, k, true);
    const zhBr = zh ? textBreaks(zh, k, false) : null;
    const total = c.end - c.start;
    for (let i = 0; i < k; i++) {
      out.push({ start: c.start + Math.round((total * i) / k), end: c.start + Math.round((total * (i + 1)) / k), en: en.slice(enBr[i], enBr[i + 1]).trim(), zh: zhBr ? zh.slice(zhBr[i], zhBr[i + 1]).trim() : '' });
    }
  });
  return out;
}

console.log('== 长英文句切块 ==');
const longEn = 'There have been three themes running through the conference which are relevant to what I want to talk about and one is the extraordinary evidence of human creativity';
const zh = '这次会议有三个主题贯穿会议始终，并且和我要谈的内容有关，其中之一就是人类创造力的伟大例证';
const cues = [{ start: 0, end: 9000, en: longEn, zh: zh }];
const r = splitLongCues(cues, 80, 36);
check('切成多块', r.length >= 3, 'k=' + r.length);
check('每块英文不太长', r.every((c) => c.en.length <= 82), r.map((c) => c.en.length).join(','));
check('英文不丢字（拼回去空格比对）', r.map((c) => c.en).join('').replace(/\s+/g, '') === longEn.replace(/\s+/g, ''), 'ok');
check('中文不丢字', r.map((c) => c.zh).join('').replace(/\s+/g, '') === zh.replace(/\s+/g, ''), 'ok');
check('时间连续且不重叠', r[0].start === 0 && r[r.length - 1].end === 9000 && r.every((c, i) => i === 0 || c.start === r[i - 1].end), JSON.stringify(r.map((c) => [c.start, c.end])));

console.log('== 短句不切 ==');
const r2 = splitLongCues([{ start: 0, end: 2000, en: 'Hello there.', zh: '你好。' }], 80, 36);
check('短句保持 1 块', r2.length === 1);

console.log('== 中文标点不落行首 ==');
const CLOSE = '，。！？、；：）】》」』”’';
const zhLong = '我认为创造力和文化知识在教育中占同样比重，所以这两方面我们应同等对待，而孩子们的天赋需要被尊重，我们不能扼杀它。';
const r3 = splitLongCues([{ start: 0, end: 8000, en: '', zh: zhLong }], 80, 36);
check('切成多块', r3.length >= 2, 'k=' + r3.length);
check('每块行首不是收尾标点', r3.slice(1).every((c) => CLOSE.indexOf(c.zh[0]) < 0), JSON.stringify(r3.map((c) => c.zh)));
check('中文不丢字', r3.map((c) => c.zh).join('').replace(/\s+/g, '') === zhLong.replace(/\s+/g, ''), 'ok');

console.log('');
if (fail) { console.log(fail + ' 项失败'); process.exit(1); }
console.log('全部通过 ✅');
