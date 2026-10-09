/* 抓取一个真实 TED 演讲的英/中字幕，生成本地预览数据 tools/sample-data.js
 * 运行： node tools/fetch-data.cjs [slug]
 */
'use strict';
require('../src/lib/align.js');
require('../src/lib/ted.js');
const fs = require('fs');
const path = require('path');
const ted = globalThis.TEDL.ted;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

const slug = process.argv[2] || 'sir_ken_robinson_do_schools_kill_creativity';

(async function () {
  const res = await fetch('https://www.ted.com/talks/' + slug, { headers: { 'user-agent': UA } });
  const html = await res.text();
  const talkId = ted.getTalkIdFromHtml(html);
  const tm = html.match(/"title":"([^"]+)"/);
  const title = tm ? tm[1] : slug;

  const en = await ted.fetchSubtitles(talkId, 'en');
  const zh = await ted.fetchSubtitles(talkId, 'zh-cn');

  const out =
    '/* 自动生成，用于本地预览。重新生成： node tools/fetch-data.cjs */\n' +
    'window.__TEDL_SAMPLE__ = {\n' +
    '  talkId: ' + JSON.stringify(talkId) + ',\n' +
    '  title: ' + JSON.stringify(title) + ',\n' +
    '  en: ' + JSON.stringify(en) + ',\n' +
    '  zh: ' + JSON.stringify(zh) + '\n' +
    '};\n';
  const file = path.join(__dirname, 'sample-data.js');
  fs.writeFileSync(file, out);
  console.log('写出 ' + file + '  talkId=' + talkId + ' title=' + title);
  console.log('en=' + (en ? en.length : 0) + ' zh=' + (zh ? zh.length : 0));
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
