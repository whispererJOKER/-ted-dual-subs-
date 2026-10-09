/* 用真实字幕数据驱动 Overlay 的本地预览 */
(function () {
  'use strict';
  const S = window.__TEDL_SAMPLE__;
  const align = TEDL.align;

  class FakeVideo extends EventTarget {
    constructor() {
      super();
      this._t = 0;
      this.playbackRate = 1;
      this.paused = true;
      this._timer = null;
    }
    get currentTime() {
      return this._t;
    }
    set currentTime(v) {
      this._t = Math.max(0, v);
      this.dispatchEvent(new Event('seeked'));
      this.dispatchEvent(new Event('timeupdate'));
    }
    play() {
      if (this.paused) {
        this.paused = false;
        this._timer = setInterval(() => {
          this._t += this.playbackRate * 0.1;
          if (this._t > duration) {
            this.pause();
            this._t = duration;
          }
          this.dispatchEvent(new Event('timeupdate'));
          updateTimeUI();
        }, 100);
        updatePlayBtn();
      }
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
      if (this._timer) clearInterval(this._timer);
      this._timer = null;
      updatePlayBtn();
    }
  }

  const cues = align.align(S.en, S.zh);
  const duration = cues.length ? cues[cues.length - 1].end / 1000 : 60;
  const video = new FakeVideo();
  const player = new TEDL.Player(video);

  const overlay = new TEDL.Overlay({
    onPrev: () => seekRelative(-1),
    onNext: () => seekRelative(1),
    onReplay: () => {
      const c = cues[overlay.current];
      if (c) player.playOnce(c);
    },
    onLoop: (on) => {
      const c = cues[overlay.current];
      player.setLoop(on, c);
      if (on && c) player.playOnce(c);
    },
    onSeek: (ms) => {
      video.currentTime = ms / 1000;
      sync.forceUpdate();
    },
    onSpeed: (v) => player.setSpeed(v),
    onOpenVocab: () => alert('预览模式下不打开生词本'),
    onOpenSettings: () => alert('预览模式下不打开设置'),
  });
  overlay.mount();
  overlay.talkTitle = S.title;
  overlay.talkId = S.talkId;
  overlay.setCues(cues, S.title);
  overlay.renderCurrent(-1);

  const sync = TEDL.createSync(video, (idx) => {
    overlay.renderCurrent(idx);
    const c = idx >= 0 ? cues[idx] : null;
    player.setLoopCue(c);
    updateTimeUI();
  });
  sync.setCues(cues);
  sync.start();

  function seekRelative(dir) {
    let i = overlay.current + dir;
    i = Math.max(0, Math.min(cues.length - 1, i));
    if (i >= 0 && cues[i]) {
      video.currentTime = cues[i].start / 1000;
      sync.forceUpdate();
    }
  }

  /* 顶部控制 */
  const seekEl = document.getElementById('seek');
  const timeEl = document.getElementById('time');
  const playEl = document.getElementById('play');
  seekEl.max = String(duration);

  function fmt(t) {
    const s = Math.floor(t);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function updateTimeUI() {
    seekEl.value = String(video.currentTime);
    timeEl.textContent = fmt(video.currentTime) + ' / ' + fmt(duration);
  }
  function updatePlayBtn() {
    playEl.textContent = video.paused ? '播放' : '暂停';
  }
  playEl.onclick = function () {
    if (video.paused) video.play();
    else video.pause();
  };
  seekEl.oninput = function () {
    video.currentTime = Number(seekEl.value);
    sync.forceUpdate();
  };
  updateTimeUI();
  updatePlayBtn();

  /* 全屏：把字幕层移到全屏容器 */
  const fsBtn = document.getElementById('fs');
  if (fsBtn) {
    fsBtn.onclick = function () {
      const st = document.querySelector('.stage');
      if (document.fullscreenElement) document.exitFullscreen();
      else if (st.requestFullscreen) st.requestFullscreen();
    };
  }
  document.addEventListener('fullscreenchange', function () {
    overlay.attachTo(document.fullscreenElement || document.body);
  });

  /* 键盘 */
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'j') { seekRelative(1); e.preventDefault(); }
    else if (k === 'k') { seekRelative(-1); e.preventDefault(); }
    else if (k === 'r') { const c = cues[overlay.current]; if (c) player.playOnce(c); }
    else if (k === 'm') overlay.cycleMode();
    else if (k === 'h') overlay.toggleBlur();
    else if (k === 't') overlay.toggleTranscript();
  });
})();
