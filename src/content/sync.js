/* TED 双语字幕 —— 播放同步：把 video.currentTime 映射到当前字幕句 */
(function (root) {
  'use strict';
  const TEDL = (root.TEDL = root.TEDL || {});

  function createSync(video, onCue) {
    let raf = null;
    let cues = [];
    let lastIdx = -2;
    let tolerance = 400;
    let enabled = true;
    let offsetMs = 0; // 播放器片头偏移：字幕时间 = 播放器时间 - offset

    function evaluate() {
      if (!enabled || !video || !cues.length) return;
      const t = video.currentTime * 1000 - offsetMs;
      const idx = TEDL.align.findCueIndex(cues, t, tolerance);
      if (idx !== lastIdx) {
        lastIdx = idx;
        try {
          onCue(idx);
        } catch (e) {
          /* ignore */
        }
      }
    }

    function tick() {
      evaluate();
      raf = requestAnimationFrame(tick);
    }

    // 事件驱动（播放/跳转时立即更新），rAF 负责平滑
    const onEvt = function () {
      evaluate();
    };
    if (video) {
      video.addEventListener('timeupdate', onEvt);
      video.addEventListener('seeked', onEvt);
      video.addEventListener('playing', onEvt);
      video.addEventListener('play', onEvt);
      video.addEventListener('ratechange', onEvt);
    }

    return {
      setCues: function (c) {
        cues = c || [];
        lastIdx = -2;
      },
      setTolerance: function (v) {
        tolerance = v;
      },
      setOffset: function (ms) {
        offsetMs = Number(ms) || 0;
        lastIdx = -2;
        evaluate();
      },
      forceUpdate: function () {
        lastIdx = -2;
        evaluate();
      },
      start: function () {
        if (!raf) raf = requestAnimationFrame(tick);
      },
      stop: function () {
        if (raf) {
          cancelAnimationFrame(raf);
          raf = null;
        }
        if (video) {
          video.removeEventListener('timeupdate', onEvt);
          video.removeEventListener('seeked', onEvt);
          video.removeEventListener('playing', onEvt);
          video.removeEventListener('play', onEvt);
          video.removeEventListener('ratechange', onEvt);
        }
      },
    };
  }

  TEDL.createSync = createSync;
})(typeof globalThis !== 'undefined' ? globalThis : this);
