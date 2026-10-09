/* TED 双语字幕 —— 生词本弹窗 */
(function () {
  'use strict';
  const V = TEDL.vocab;
  let allWords = [];

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function highlightContext(ctx, word) {
    if (!ctx) return '';
    const safe = esc(ctx);
    if (!word) return safe;
    const re = new RegExp('\\b(' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')\\b', 'gi');
    return safe.replace(re, '<span class="hl">$1</span>');
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function render() {
    const q = ($('search').value || '').trim().toLowerCase();
    const list = $('list');
    const words = allWords.filter(function (w) {
      if (!q) return true;
      return (
        w.word.indexOf(q) >= 0 ||
        (w.defs || []).join(' ').toLowerCase().indexOf(q) >= 0 ||
        (w.context || '').toLowerCase().indexOf(q) >= 0
      );
    });
    $('count').textContent = String(allWords.length);
    $('empty').style.display = allWords.length ? 'none' : 'block';
    list.innerHTML = '';
    words.forEach(function (w) {
      const card = document.createElement('div');
      card.className = 'word';
      const defs = (w.defs || []).map(function (d) {
        return '<li>' + esc(d) + '</li>';
      }).join('');
      card.innerHTML =
        '<div class="word-top">' +
        '<span class="word-text">' + esc(w.word) + '</span>' +
        (w.phonetic ? '<span class="word-phon">/' + esc(w.phonetic) + '/</span>' : '') +
        (w.count > 1 ? '<span class="word-count">收藏 ' + w.count + ' 次</span>' : '') +
        '</div>' +
        (defs ? '<ul class="word-defs">' + defs + '</ul>' : '') +
        (w.context ? '<div class="word-ctx">' + highlightContext(w.context, w.word) + '</div>' : '') +
        '<div class="word-foot">' +
        '<button class="btn" data-act="speak">🔊 发音</button>' +
        '<button class="btn" data-act="del">删除</button>' +
        '</div>';
      card.querySelector('[data-act="del"]').onclick = async function () {
        await V.removeWord(w.id);
        await load();
      };
      card.querySelector('[data-act="speak"]').onclick = function () {
        try {
          const u = new SpeechSynthesisUtterance(w.word);
          u.lang = 'en-US';
          speechSynthesis.speak(u);
        } catch (e) {}
      };
      list.appendChild(card);
    });
  }

  async function load() {
    allWords = await V.getVocab();
    render();
  }

  async function loadSettings() {
    const s = await V.getSettings();
    $('blurZh').checked = !!s.blurZh;
    $('aiEnabled').checked = !!(s.ai && s.ai.enabled);
  }

  $('search').addEventListener('input', render);

  $('blurZh').addEventListener('change', function (e) {
    V.saveSettings({ blurZh: e.target.checked });
  });
  $('aiEnabled').addEventListener('change', function (e) {
    V.saveSettings({ ai: { enabled: e.target.checked } });
  });

  $('exportCsv').addEventListener('click', function () {
    if (!allWords.length) return;
    download('ted-vocab.csv', V.toCSV(allWords), 'text/csv;charset=utf-8');
  });
  $('exportTsv').addEventListener('click', function () {
    if (!allWords.length) return;
    download('ted-vocab-anki.txt', V.toTSV(allWords), 'text/plain;charset=utf-8');
  });
  $('clearAll').addEventListener('click', async function () {
    if (!allWords.length) return;
    if (confirm('确定清空全部 ' + allWords.length + ' 个生词？此操作不可撤销。')) {
      await V.clearVocab();
      await load();
    }
  });
  $('openOptions').addEventListener('click', function () {
    try {
      chrome.runtime.openOptionsPage();
    } catch (e) {
      window.open(chrome.runtime.getURL('src/options/options.html'), '_blank');
    }
  });

  load();
  loadSettings();
})();
