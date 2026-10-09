/* 核心逻辑的 Node 端验证：真实抓取一个 TED 演讲，验证
 *   talkId 解析 / 语言列表 / 双语对齐 / 二分查找定位
 * 运行： node tools/test-core.cjs
 */
'use strict';
require('../src/lib/align.js');
require('../src/lib/ted.js');

const ted = globalThis.TEDL.ted;
const align = globalThis.TEDL.align;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

const SLUG = 'sir_ken_robinson_do_schools_kill_creativity';
let failures = 0;
function check(name, cond, extra) {
  if (cond) {
    console.log('  PASS ' + name + (extra ? '  ' + extra : ''));
  } else {
    failures++;
    console.log('  FAIL ' + name + (extra ? '  ' + extra : ''));
  }
}

(async function main() {
  console.log('== 1. 抓取页面并解析 talkId ==');
  const res = await fetch('https://www.ted.com/talks/' + SLUG, { headers: { 'user-agent': UA } });
  const html = await res.text();
  const talkId = ted.getTalkIdFromHtml(html);
  check('页面可访问', res.status === 200, 'status=' + res.status);
  check('解析出 talkId', talkId === '66', 'talkId=' + talkId);

  console.log('== 2. 解析可用语言列表 ==');
  const langs = ted.languagesFromHtml(html);
  check('语言数量 > 10', langs.length > 10, 'count=' + langs.length);
  check('包含 zh-cn', langs.indexOf('zh-cn') >= 0);
  check('包含 en', langs.indexOf('en') >= 0);

  console.log('== 3. 抓取英 / 中官方字幕 ==');
  const en = await ted.fetchSubtitles(talkId, 'en');
  const zh = await ted.fetchSubtitles(talkId, 'zh-cn');
  check('英文字幕非空', Array.isArray(en) && en.length > 50, 'en cues=' + (en && en.length));
  check('中文字幕非空', Array.isArray(zh) && zh.length > 20, 'zh cues=' + (zh && zh.length));
  const missing = await ted.fetchSubtitles(talkId, 'zz-not-exist');
  check('不存在的语言返回 null', missing === null);

  console.log('== 4. 双语对齐 ==');
  const cues = align.align(en, zh);
  check('对齐后条数 == 英文条数', cues.length === en.length, 'cues=' + cues.length);
  const withZh = cues.filter(function (c) { return c.zh && c.zh.length; });
  const ratio = withZh.length / cues.length;
  check('多数 cue 匹配到中文', ratio > 0.8, 'ratio=' + ratio.toFixed(2));
  const zhSet = {};
  align.toCues(zh).forEach(function (z) { zhSet[z.text] = true; });
  check('中文只取单块、无拼接', withZh.every(function (c) { return zhSet[c.zh]; }));
  check('cue 结构完整', cues.every(function (c) {
    return typeof c.start === 'number' && typeof c.end === 'number' && c.end >= c.start && typeof c.en === 'string';
  }));
  check('正文换行被规整', cues.every(function (c) { return c.en.indexOf('\n') === -1 && c.zh.indexOf('\n') === -1; }));

  console.log('== 5. 二分查找定位 ==');
  const mid = cues[Math.floor(cues.length / 2)];
  const idxAtStart = align.findCueIndex(cues, mid.start + 1);
  const idxAtMid = align.findCueIndex(cues, Math.floor((mid.start + mid.end) / 2));
  check('真实数据·句首命中自身', cues[idxAtStart] === mid, 'idx=' + idxAtStart);
  check('真实数据·句中命中自身', cues[idxAtMid] === mid, 'idx=' + idxAtMid);

  const synth = [
    { start: 0, end: 1000 },
    { start: 2000, end: 3000 },
    { start: 5000, end: 6000 },
  ];
  check('合成·t=500 -> 0', align.findCueIndex(synth, 500) === 0);
  check('合成·句末容差内 -> 0', align.findCueIndex(synth, 1300) === 0);
  check('合成·超过容差 -> -1', align.findCueIndex(synth, 1600) === -1);
  check('合成·第二句 -> 1', align.findCueIndex(synth, 2500) === 1);
  check('合成·t<0 -> -1', align.findCueIndex(synth, -1) === -1);
  check('合成·末尾之后 -> -1', align.findCueIndex(synth, 6500) === -1);

  console.log('== 6. 样例输出 ==');
  const sample = cues[Math.floor(cues.length / 3)];
  console.log('  t=' + sample.start + 'ms');
  console.log('  EN: ' + sample.en);
  console.log('  ZH: ' + (sample.zh || '(空)'));

  console.log('== 7. 片头偏移（时间对齐修复）==');
  const hls = 'https://hls.ted.com/project_masters/1253/manifest.m3u8?intro_master_id=9294';
  const info = ted.hlsInfoFromUrl(hls);
  check('解析 projectId', info.projectId === '1253', 'id=' + info.projectId);
  check('解析 introMasterId', info.introMasterId === '9294');
  const metaRes = await fetch(
    'https://hls.ted.com/project_masters/1253/metadata.json?intro_master_id=9294',
    { headers: { 'user-agent': UA } }
  );
  const meta = await metaRes.json();
  const offset = ted.parseIntroOffset(meta);
  check('片头偏移 = 3504ms', offset === 3504, 'offset=' + offset);

  // 播放器自带的 VTT 第一句时间，应 = 偏移 + 接口第一句
  const vttRes = await fetch(
    'https://hls.ted.com/project_masters/1253/subtitles/en/full.vtt?intro_master_id=9294',
    { headers: { 'user-agent': UA } }
  );
  const vtt = await vttRes.text();
  const vm = vtt.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
  const vttFirstMs = vm ? (+vm[1] * 3600 + +vm[2] * 60 + +vm[3]) * 1000 + +vm[4] : 0;
  check('VTT首句 = 偏移 + 接口首句', Math.abs(vttFirstMs - (offset + en[0].startTime)) <= 2,
    'vtt=' + vttFirstMs + ' api=' + en[0].startTime + ' offset=' + offset);

  // 应用偏移后，播放器时间应命中第一句
  const playerT = en[0].startTime + offset;
  check('播放器5607ms -> 第0句', align.findCueIndex(cues, playerT - offset) === 0);

  console.log('');
  if (failures) {
    console.log('结果：' + failures + ' 项失败');
    process.exit(1);
  } else {
    console.log('结果：全部通过 ✅');
  }
})().catch(function (e) {
  console.error('测试异常：', e);
  process.exit(1);
});
