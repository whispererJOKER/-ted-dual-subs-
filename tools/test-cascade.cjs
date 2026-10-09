/* 翻译细拆 + 单句尝试上限(=3) 验证： node tools/test-cascade.cjs
 * 与 service-worker 的 resilient 同构。 */
'use strict';
let fail = 0;
function check(n, c, extra) { if (c) console.log('  PASS ' + n + (extra ? '  ' + extra : '')); else { fail++; console.log('  FAIL ' + n + (extra ? '  ' + extra : '')); } }

const MAX_TRIES = 3;
let attempts = new Map();
let requestLog = [];
let firstError = null;

// 模拟接口：批次里含 'X'（敏感）就整批抛错；单句 'X' 也抛错；其余成功
async function translateBatch(texts) {
  requestLog.push(texts.join('|'));
  if (texts.some((t) => t.indexOf('X') >= 0)) throw new Error('content filtered');
  return texts.map((t) => '译:' + t);
}
async function tryT(list) {
  try { return await translateBatch(list); } catch (e) { if (!firstError) firstError = String(e.message || e); return null; }
}
function bump(items) { items.forEach((it) => attempts.set(it.text, (attempts.get(it.text) || 0) + 1)); }

async function resilient(items, out) {
  if (!items.length) return;
  if (items.length === 1) {
    const it = items[0];
    while ((attempts.get(it.text) || 0) < MAX_TRIES && !out[it.gi]) {
      bump([it]);
      const r = await tryT([it.text]);
      if (r && r[0]) out[it.gi] = r[0];
    }
    return;
  }
  const active = items.filter((it) => !out[it.gi] && (attempts.get(it.text) || 0) < MAX_TRIES);
  if (!active.length) return;
  bump(active);
  const r = await tryT(active.map((it) => it.text));
  if (r) active.forEach((it, k) => { if (r[k]) out[it.gi] = r[k]; });
  const missing = active.filter((it) => !out[it.gi]);
  for (let k = 0; k < missing.length; k++) await resilient([missing[k]], out);
}

async function run(texts) {
  attempts = new Map(); requestLog = []; firstError = null;
  const out = new Array(texts.length).fill('');
  const items = texts.map((t, j) => ({ gi: j, text: t }));
  await resilient(items, out);
  return out;
}

(async function () {
  console.log('== 正常批次 ==');
  let out = await run(['a', 'b', 'c', 'd']);
  check('全部翻译', out.join(',') === '译:a,译:b,译:c,译:d', out.join(','));

  console.log('== 含 1 个敏感句 ==');
  const texts = ['good morning', 'X bad', 'how are you', 'fine thanks', 'yes'];
  out = await run(texts);
  check('敏感句留空', out[1] === '', 'out[1]=' + out[1]);
  check('其余句子全部翻出', out.filter((v, i) => i !== 1).every((v) => v.indexOf('译:') === 0), JSON.stringify(out));
  check('敏感句尝试次数 <= 3', (attempts.get('X bad') || 0) <= 3, 'tries=' + attempts.get('X bad'));
  check('正常句尝试次数 <= 3', texts.filter((t) => t !== 'X bad').every((t) => (attempts.get(t) || 0) <= 3));

  console.log('== 多个敏感句 ==');
  out = await run(['X1', 'ok1', 'X2', 'ok2']);
  check('正常句仍翻出', out[1] === '译:ok1' && out[3] === '译:ok2', JSON.stringify(out));
  check('敏感句各 <= 3 次', (attempts.get('X1') || 0) <= 3 && (attempts.get('X2') || 0) <= 3);

  console.log('');
  if (fail) { console.log(fail + ' 项失败'); process.exit(1); }
  console.log('全部通过 ✅');
})();
