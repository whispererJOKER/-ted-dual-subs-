/* TED 双语字幕 —— 播放控制：跳句 / 复读 / 循环 / 语速
 * 注意：字幕时间是「正片相对时间」，播放器时间轴含片头，故用 offsetMs 换算。
 */
(function (root) {
  'use strict';
  const TEDL = (root.TEDL = root.TEDL || {});

  class Player {
    constructor(video) {
      this.video = video;
      this.loopOn = false;
      this._loopCue = null;
      this.offsetMs = 0;
      this._bound = this._onTime.bind(this);
      video.addEventListener('timeupdate', this._bound);
      video.addEventListener('seeked', this._bound);
    }

    setVideo(video) {
      if (this.video) {
        this.video.removeEventListener('timeupdate', this._bound);
        this.video.removeEventListener('seeked', this._bound);
      }
      this.video = video;
      if (video) {
        video.addEventListener('timeupdate', this._bound);
        video.addEventListener('seeked', this._bound);
      }
    }

    setOffset(ms) {
      this.offsetMs = Number(ms) || 0;
    }

    // 播放器时间（秒）= (字幕时间 ms + 偏移) / 1000
    _toPlayerSec(ms) {
      return (ms + this.offsetMs) / 1000;
    }

    // 当前播放位置换算成字幕时间（ms）
    _toSubMs() {
      return this.video ? this.video.currentTime * 1000 - this.offsetMs : 0;
    }

    _onTime() {
      if (!this.loopOn || !this._loopCue || !this.video) return;
      const t = this._toSubMs();
      if (t >= this._loopCue.end - 30) {
        this.video.currentTime = this._toPlayerSec(this._loopCue.start);
        if (this.video.paused) this.video.play().catch(function () {});
      }
    }

    seek(ms) {
      if (!this.video) return;
      this.video.currentTime = Math.max(0, this._toPlayerSec(ms));
    }

    setLoop(on, cue) {
      this.loopOn = !!on;
      this._loopCue = cue || this._loopCue;
    }

    setLoopCue(cue) {
      this._loopCue = cue;
    }

    /** 播放单句：从头播到句尾后自动暂停 */
    playOnce(cue) {
      if (!this.video || !cue) return;
      const v = this.video;
      v.currentTime = Math.max(0, this._toPlayerSec(cue.start));
      const stop = () => {
        if (this._toSubMs() >= cue.end - 20) {
          v.pause();
          v.removeEventListener('timeupdate', stop);
        }
      };
      v.addEventListener('timeupdate', stop);
      v.play().catch(function () {});
    }

    setSpeed(v) {
      if (this.video) this.video.playbackRate = v;
    }

    destroy() {
      if (this.video) {
        this.video.removeEventListener('timeupdate', this._bound);
        this.video.removeEventListener('seeked', this._bound);
      }
    }
  }

  TEDL.Player = Player;
})(typeof globalThis !== 'undefined' ? globalThis : this);
