/* 预览用的 chrome API / 依赖占位，便于在普通网页里加载扩展的 content 脚本 */
(function () {
  'use strict';
  const mem = {};

  globalThis.chrome = {
    runtime: {
      sendMessage: function (msg, cb) {
        return new Promise(function (resolve) {
          if (msg && msg.type === 'dictLookup') {
            resolve({
              ok: true,
              data: {
                word: msg.word,
                phonetic: 'demo',
                meanings: [{ pos: 'n.', defs: ['预览模式下的示例释义'] }],
                audio: '',
              },
            });
          } else {
            resolve({ ok: false });
          }
        });
      },
      openOptionsPage: function () {},
      getURL: function (p) {
        return '../' + p;
      },
    },
    storage: {
      local: {
        get: function (key) {
          return Promise.resolve(typeof key === 'string' ? { [key]: mem[key] } : Object.assign({}, mem));
        },
        set: function (obj) {
          Object.assign(mem, obj);
          return Promise.resolve();
        },
      },
      onChanged: { addListener: function () {} },
    },
    permissions: {
      contains: function () {
        return Promise.resolve(true);
      },
      request: function () {
        return Promise.resolve(true);
      },
    },
  };
})();
