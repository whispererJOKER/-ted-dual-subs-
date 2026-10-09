/* TED 双语字幕 —— 字幕层 UI
 * 负责：双语字幕条、控制栏、逐句面板、点词释义弹窗
 */
(function (root) {
  'use strict';
  const TEDL = (root.TEDL = root.TEDL || {});

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function fmt(t) {
    const s = Math.floor(t / 1000);
    const m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  }

  const MODE_LABEL = { both: '双语', en: '仅英', zh: '仅中', off: '隐藏' };
  const MODE_CYCLE = ['both', 'en', 'zh', 'off'];

  class Overlay {
    constructor(opts) {
      this.opts = opts || {};
      this.cues = [];
      this.current = -1;
      this.mode = 'both';
      this.blurZh = false;
      this.fontSize = 0;
      this.talkTitle = '';
      this.talkId = '';
      this.mounted = false;
      this.words = []; // 当前句的 word span
      this.transcriptItems = [];
    }

    mount() {
      if (this.mounted) return;
      const rootEl = el('div', 'tedl-root');
      rootEl.dataset.mode = this.mode;

      const panel = el('div', 'tedl-panel');
      const lines = el('div', 'tedl-lines');
      this.enEl = el('p', 'tedl-line tedl-en');
      this.zhEl = el('p', 'tedl-line tedl-zh');
      lines.appendChild(this.enEl);
      lines.appendChild(this.zhEl);
      panel.appendChild(lines);

      const controls = el('div', 'tedl-controls');
      const mkBtn = (act, label, title) => {
        const b = el('button', 'tedl-btn', label);
        b.type = 'button';
        b.dataset.act = act;
        b.title = title || '';
        return b;
      };
      this.btnPrev = mkBtn('prev', '⏮', '上一句 (K)');
      this.btnReplay = mkBtn('replay', '⏯', '重播本句 (R)');
      this.btnLoop = mkBtn('loop', '🔁', '循环本句 (L)');
      this.btnNext = mkBtn('next', '⏭', '下一句 (J)');
      this.btnMode = mkBtn('mode', MODE_LABEL.both, '切换字幕模式 (M)');
      this.btnBlur = mkBtn('blur', '自测', '中文遮罩自测 (H)');
      this.btnTranscript = mkBtn('transcript', '📄', '逐句面板 (T)');
      this.btnVocab = mkBtn('vocab', '📖', '生词本');
      this.btnSettings = mkBtn('settings', '⚙', '设置');
      this.btnExport = mkBtn('export', '📕', '导出字幕为 PDF');
      this.btnAsr = mkBtn('asr', '🎙', '自动识别字幕（语音转写）');
      controls.appendChild(this.btnPrev);
      controls.appendChild(this.btnReplay);
      controls.appendChild(this.btnLoop);
      controls.appendChild(this.btnNext);
      controls.appendChild(this.btnMode);
      controls.appendChild(this.btnBlur);
      controls.appendChild(el('span', 'tedl-sep'));

      const speed = el('input', 'tedl-speed');
      speed.type = 'range';
      speed.min = '0.5';
      speed.max = '2';
      speed.step = '0.1';
      speed.value = '1';
      speed.title = '语速';
      this.speedEl = speed;
      this.speedLabel = el('span', 'tedl-speed-label', '1.0×');
      controls.appendChild(speed);
      controls.appendChild(this.speedLabel);
      controls.appendChild(el('span', 'tedl-sep'));
      this.noteEl = el('span', 'tedl-note', '');
      controls.appendChild(this.noteEl);
      controls.appendChild(this.btnTranscript);
      controls.appendChild(this.btnVocab);
      controls.appendChild(this.btnSettings);
      controls.appendChild(this.btnExport);
      controls.appendChild(this.btnAsr);

      this.controlsEl = controls;
      panel.appendChild(controls);
      rootEl.appendChild(panel);
      this.rootEl = rootEl;

      // 逐句面板
      this.transcriptEl = el('aside', 'tedl-transcript');
      const th = el('div', 'tedl-transcript-head');
      th.appendChild(el('span', null, '逐句字幕'));
      const closeT = el('button', 'tedl-btn', '✕');
      closeT.type = 'button';
      closeT.dataset.act = 'transcript';
      th.appendChild(closeT);
      this.transcriptEl.appendChild(th);
      this.transcriptList = el('div', 'tedl-transcript-list');
      this.transcriptEl.appendChild(this.transcriptList);

      // 弹窗
      this.popover = el('div', 'tedl-popover');
      this.popover.style.display = 'none';

      document.body.appendChild(rootEl);
      document.body.appendChild(this.transcriptEl);
      document.body.appendChild(this.popover);

      this._bindEvents();
      this.mounted = true;
      this.applyStyle();
    }

    /** 把字幕层挂到指定容器（全屏时挂进全屏元素，退出时挂回 body） */
    attachTo(container) {
      if (!this.rootEl) return;
      const c = container && container.appendChild ? container : document.body;
      if (this.rootEl.parentNode === c) {
        this.rootEl.dataset.fs = c === document.body ? '0' : '1';
        return;
      }
      c.appendChild(this.rootEl);
      c.appendChild(this.transcriptEl);
      c.appendChild(this.popover);
      this.rootEl.dataset.fs = c === document.body ? '0' : '1';
    }

    _bindEvents() {
      const o = this.opts;
      const self = this;
      this.rootEl.addEventListener('click', function (e) {
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        const act = b.dataset.act;
        if (act === 'prev' && o.onPrev) o.onPrev();
        else if (act === 'replay' && o.onReplay) o.onReplay();
        else if (act === 'next' && o.onNext) o.onNext();
        else if (act === 'loop') {
          const on = b.classList.toggle('active');
          if (o.onLoop) o.onLoop(on);
        } else if (act === 'mode') self.cycleMode();
        else if (act === 'blur') self.toggleBlur();
        else if (act === 'transcript') self.toggleTranscript();
        else if (act === 'vocab' && o.onOpenVocab) o.onOpenVocab();
        else if (act === 'settings' && o.onOpenSettings) o.onOpenSettings();
        else if (act === 'export' && o.onExport) o.onExport();
        else if (act === 'asr' && o.onAsr) o.onAsr();
      });
      this.transcriptEl.addEventListener('click', function (e) {
        const b = e.target.closest('button[data-act="transcript"]');
        if (b) {
          self.toggleTranscript();
          return;
        }
        const item = e.target.closest('.tedl-t-item');
        if (item && o.onSeek) o.onSeek(Number(item.dataset.ms) || 0);
      });
      if (this.speedEl) {
        this.speedEl.addEventListener('input', function () {
          const v = Number(self.speedEl.value);
          self.speedLabel.textContent = v.toFixed(1) + '×';
          if (o.onSpeed) o.onSpeed(v);
        });
      }
      // 点击英文单词
      this.enEl.addEventListener('click', function (e) {
        const w = e.target.closest('.tedl-w');
        if (!w) return;
        self.showDict(w.dataset.w, w);
      });
      // 点击其它地方收起弹窗
      document.addEventListener(
        'click',
        function (e) {
          if (self.popover.style.display === 'none') return;
          if (e.target.closest('.tedl-popover') || e.target.closest('.tedl-w')) return;
          self.hidePopover();
        },
        true
      );
    }

    cycleMode() {
      const i = MODE_CYCLE.indexOf(this.mode);
      this.setMode(MODE_CYCLE[(i + 1) % MODE_CYCLE.length]);
    }

    setMode(mode) {
      this.mode = mode;
      if (this.rootEl) this.rootEl.dataset.mode = mode;
      if (this.btnMode) this.btnMode.textContent = MODE_LABEL[mode] || mode;
      this.renderCurrent(this.current);
    }

    toggleBlur() {
      this.blurZh = !this.blurZh;
      if (this.btnBlur) this.btnBlur.classList.toggle('active', this.blurZh);
      this.applyStyle();
    }

    setBlur(v) {
      this.blurZh = !!v;
      if (this.btnBlur) this.btnBlur.classList.toggle('active', this.blurZh);
      this.applyStyle();
    }

    applyStyle() {
      if (!this.rootEl) return;
      this.rootEl.classList.toggle('tedl-blur-zh', this.blurZh);
      if (this.fontSize > 0) {
        this.rootEl.style.setProperty('--tedl-font', this.fontSize + 'px');
      } else {
        this.rootEl.style.removeProperty('--tedl-font');
      }
    }

    toggleTranscript() {
      const on = !this.transcriptEl.classList.contains('open');
      this.transcriptEl.classList.toggle('open', on);
      if (this.btnTranscript) this.btnTranscript.classList.toggle('active', on);
      if (on) this.scrollToCurrent();
      if (this.opts.onTranscriptToggle) this.opts.onTranscriptToggle(on);
    }

    setTranscriptOpen(on) {
      this.transcriptEl.classList.toggle('open', !!on);
      if (this.btnTranscript) this.btnTranscript.classList.toggle('active', !!on);
    }

    setSpeed(v) {
      if (this.speedEl) this.speedEl.value = String(v);
      if (this.speedLabel) this.speedLabel.textContent = Number(v).toFixed(1) + '×';
    }

    setStatus(text) {
      if (!this.enEl) return;
      this.enEl.textContent = text || '';
      this.zhEl.textContent = '';
      this.zhEl.style.display = 'none';
    }

    setNote(text) {
      if (this.noteEl) this.noteEl.textContent = text || '';
    }

    setCues(cues, talkTitle) {
      this.cues = cues || [];
      this.talkTitle = talkTitle || this.talkTitle;
      if (this.transcriptList) this.renderTranscript();
      this.current = -1;
    }

    renderTranscript() {
      const list = this.transcriptList;
      if (!list) return;
      list.textContent = '';
      this.transcriptItems = [];
      const frag = document.createDocumentFragment();
      this.cues.forEach(function (c, i) {
        const item = el('div', 'tedl-t-item');
        item.dataset.ms = String(c.start);
        item.dataset.idx = String(i);
        const time = el('span', 'tedl-t-time', fmt(c.start));
        const en = el('div', 'tedl-t-en', c.en);
        const zh = el('div', 'tedl-t-zh', c.zh || '');
        item.appendChild(time);
        item.appendChild(en);
        item.appendChild(zh);
        frag.appendChild(item);
        this.transcriptItems.push(item);
      }, this);
      list.appendChild(frag);
    }

    scrollToCurrent() {
      const item = this.transcriptItems[this.current];
      if (!item) return;
      if (this._scrolling) return;
      const lr = this.transcriptList.getBoundingClientRect();
      const ir = item.getBoundingClientRect();
      const inView = ir.top >= lr.top && ir.bottom <= lr.bottom;
      if (inView) return;
      this._scrolling = true;
      item.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const self = this;
      setTimeout(function () {
        self._scrolling = false;
      }, 400);
    }

    renderCurrent(idx) {
      if (!this.enEl) return;
      const c = idx >= 0 ? this.cues[idx] : null;
      this.zhEl.style.display = '';
      if (!c) {
        this.enEl.textContent = '';
        this.zhEl.textContent = '';
      } else {
        this.renderWords(this.enEl, c.en);
        this.zhEl.textContent = c.zh || '';
      }
      // 面板高亮
      if (this.transcriptItems.length) {
        const prev = this.transcriptItems[this.current];
        if (prev) prev.classList.remove('active');
        const cur = this.transcriptItems[idx];
        if (cur) {
          cur.classList.add('active');
          if (this.opts.syncScroll !== false) this.scrollToCurrent();
        }
      }
      this.current = idx;
    }

    renderWords(container, text) {
      container.textContent = '';
      this.words = [];
      const parts = String(text).split(/(\s+)/);
      const frag = document.createDocumentFragment();
      const self = this;
      parts.forEach(function (p) {
        if (p === '' || /^\s+$/.test(p)) {
          frag.appendChild(document.createTextNode(p));
          return;
        }
        const span = el('span', 'tedl-w', p);
        const clean = TEDL.vocab.normalizeWord(p);
        if (clean && /[a-zA-Z]/.test(clean)) {
          span.dataset.w = clean;
          self.words.push(span);
        } else {
          span.classList.add('tedl-w-plain');
        }
        frag.appendChild(span);
      });
      container.appendChild(frag);
    }

    setActiveWord(currentWord) {
      this.words.forEach(function (w) {
        w.classList.toggle('active', w.dataset.w === currentWord);
      });
    }

    /* ---- 点词释义 ---- */
    async showDict(word, anchor) {
      if (!word) return;
      this.setActiveWord(word);
      this._dictAnchor = anchor;
      this.popover.style.display = 'block';
      this.popover.innerHTML =
        '<div class="tedl-pop-head"><span class="tedl-pop-word">' +
        word +
        '</span><button class="tedl-btn tedl-pop-close" type="button">✕</button></div>' +
        '<div class="tedl-pop-body">查询中…</div>';
      this.positionPopover(anchor);
      const self = this;
      this.popover.querySelector('.tedl-pop-close').onclick = function () {
        self.hidePopover();
      };
      let res;
      try {
        res = await chrome.runtime.sendMessage({ type: 'dictLookup', word: word });
      } catch (e) {
        res = { ok: false, error: String(e) };
      }
      if (this.popover.style.display === 'none') return;
      const body = this.popover.querySelector('.tedl-pop-body');
      if (!res || !res.ok) {
        body.innerHTML = '<div class="tedl-pop-none">未找到释义</div>';
        this._currentDict = { word: word };
      } else {
        this._currentDict = res.data;
        this.renderDict(body, res.data);
      }
      this.addSaveButton();
      // 内容渲染完成后高度变化，重新定位在字幕条上方
      this.positionPopover(this._dictAnchor);
    }

    renderDict(body, data) {
      let html = '';
      if (data.phonetic) html += '<div class="tedl-pop-phon">/' + data.phonetic.replace(/^\/|\/$/g, '') + '/</div>';
      const defs = [];
      (data.meanings || []).forEach(function (m) {
        m.defs.forEach(function (d) {
          defs.push((m.pos ? '<i>' + m.pos + '</i> ' : '') + d);
        });
      });
      if (defs.length) {
        html += '<ol class="tedl-pop-defs">' + defs.slice(0, 4).map((d) => '<li>' + d + '</li>').join('') + '</ol>';
      } else {
        html += '<div class="tedl-pop-none">无释义</div>';
      }
      body.innerHTML = html;
      const self = this;
      if (data.audio) {
        const btn = el('button', 'tedl-btn tedl-pop-audio', '🔊 发音');
        btn.type = 'button';
        btn.onclick = function () {
          new Audio(data.audio).play().catch(function () {});
        };
        body.insertBefore(btn, body.firstChild);
      }
    }

    addSaveButton() {
      const body = this.popover.querySelector('.tedl-pop-body');
      const self = this;
      const save = el('button', 'tedl-btn tedl-pop-save', '＋ 收藏生词');
      save.type = 'button';
      save.onclick = async function () {
        const d = self._currentDict || {};
        const ctx = self.current >= 0 && self.cues[self.current] ? self.cues[self.current].en : '';
        const c = self.current >= 0 ? self.cues[self.current] : null;
        const defs = (d.meanings || []).reduce(function (acc, m) {
          m.defs.forEach(function (x) {
            acc.push((m.pos ? m.pos + '. ' : '') + x);
          });
          return acc;
        }, []);
        await TEDL.vocab.addWord({
          word: (d.word || d.query || '').trim(),
          phonetic: d.phonetic || '',
          defs: defs,
          context: ctx,
          talkTitle: self.talkTitle,
          talkId: self.talkId,
          time: c ? c.start : 0,
        });
        save.textContent = '已收藏 ✓';
        save.classList.add('saved');
        save.disabled = true;
      };
      body.appendChild(save);
    }

    positionPopover(anchor) {
      if (!anchor) return;
      const pw = 340;
      const panel = this.rootEl ? this.rootEl.querySelector('.tedl-panel') : null;
      // 面板的顶边：弹出框始终放在字幕条面板上方，避免遮挡字幕
      const pr = panel ? panel.getBoundingClientRect() : anchor.getBoundingClientRect();
      const r = anchor.getBoundingClientRect();
      let left = r.left + r.width / 2 - pw / 2;
      left = Math.max(12, Math.min(left, window.innerWidth - pw - 12));
      this.popover.style.width = pw + 'px';
      this.popover.style.left = left + 'px';
      const ph = this.popover.offsetHeight || 120;
      let y = pr.top - ph - 10;
      if (y < 12) y = 12;
      this.popover.style.top = y + 'px';
    }

    hidePopover() {
      this.popover.style.display = 'none';
      this.setActiveWord('');
    }
  }

  TEDL.Overlay = Overlay;
})(typeof globalThis !== 'undefined' ? globalThis : this);
