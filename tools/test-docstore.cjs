/* 文档合并逻辑单测： node tools/test-docstore.cjs */
'use strict';
const { mergeEn, applyZh, startKey } = require('../src/lib/docstore.js');
let fail = 0;
function check(name, cond, extra) {
  if (cond) console.log('  PASS ' + name + (extra ? '  ' + extra : ''));
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
}

console.log('== mergeEn 保留 zh ==');
let doc = mergeEn([], [
  { start: 2103, end: 4678, en: 'Good morning. How are you?' },
  { start: 4702, end: 6105, en: '(Audience) Good.' },
]);
doc = applyZh(doc, [{ en: 'Good morning. How are you?', zh: '早上好，还好吗？' }]);
check('写入中文', doc[0].zh === '早上好，还好吗？');

// 识别进度再次写英文（不含 zh）——必须不丢中文
doc = mergeEn(doc, [
  { start: 2103, end: 4678, en: 'Good morning. How are you?' },
  { start: 4702, end: 6105, en: '(Audience) Good.' },
  { start: 6129, end: 7797, en: "It's been great, hasn't it?" },
]);
check('进度写英文后中文仍在', doc[0].zh === '早上好，还好吗？', 'zh=' + doc[0].zh);
check('新增句已加入', doc.length === 3);
check('新增句 zh 为空', doc[2].zh === '');

console.log('== 50ms 归并 ==');
const a = mergeEn([{ start: 1000, end: 2000, en: 'A', zh: '甲' }], [{ start: 1020, end: 2000, en: 'A2' }]);
check('相近时间视为同句（保留 zh）', a.length === 1 && a[0].zh === '甲' && a[0].en === 'A2', JSON.stringify(a));

console.log('== applyZh 按英文匹配 ==');
const cues = [{ en: 'X', zh: '' }, { en: 'Y', zh: '' }, { en: 'X', zh: '' }];
applyZh(cues, [{ en: 'X', zh: '叉' }, { en: 'Y', zh: '歪' }]);
check('匹配填空', cues[0].zh === '叉' && cues[1].zh === '歪' && cues[2].zh === '叉');

console.log('');
if (fail) { console.log(fail + ' 项失败'); process.exit(1); }
console.log('全部通过 ✅');
