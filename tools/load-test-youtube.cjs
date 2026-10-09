/* 加载自检：用桩对象执行 youtube.js，捕获加载期（非运行时）错误。 node tools/load-test-youtube.cjs */
'use strict';
globalThis.window = globalThis;
globalThis.location = { href: 'https://www.youtube.com/watch?v=x', pathname: '/watch', origin: 'https://www.youtube.com' };
globalThis.document = {
  title: 't',
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  createElement: () => ({ style: {}, dataset: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, remove() {} }),
  head: { appendChild() {} },
  documentElement: { appendChild() {}, innerHTML: '' },
};
globalThis.addEventListener = () => {};
globalThis.postMessage = () => {};
globalThis.setInterval = () => 0;
globalThis.setTimeout = () => 0;
globalThis.fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(''), json: () => Promise.resolve({}) });
globalThis.chrome = {
  runtime: { onMessage: { addListener() {} }, sendMessage: () => Promise.resolve({}), getURL: (p) => p },
  storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() }, onChanged: { addListener() {} } },
};
globalThis.TEDL = {
  vocab: {
    KEYS: { settings: 'tedl_settings' },
    DEFAULT_SETTINGS: { ai: {}, mode: 'both', blurZh: false, fontSize: 0, transcript: false },
    getSettings: () => Promise.resolve({ ai: {}, mode: 'both', blurZh: false, fontSize: 0, transcript: false }),
    saveSettings: () => {},
    normalizeWord: (w) => w,
  },
  Overlay: class { constructor() { this.rootEl = { dataset: {} }; } mount() {} setNote() {} setStatus() {} setCues() {} renderCurrent() {} renderTranscript() {} setTranscriptOpen() {} setSpeed() {} setMode() {} setBlur() {} applyStyle() {} },
  Player: class { constructor() {} destroy() {} seek() {} setLoop() {} setLoopCue() {} playOnce() {} setSpeed() {} setOffset() {} },
  createSync: () => ({ setCues() {}, start() {}, stop() {}, forceUpdate() {}, setOffset() {} }),
  align: { align: () => [] },
};

try {
  require('../src/content/youtube.js');
  console.log('youtube.js 加载成功（无加载期错误）');
} catch (e) {
  console.log('youtube.js 加载失败：', e && e.message);
  process.exit(1);
}
