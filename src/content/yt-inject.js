/* 注入到 YouTube 页面上下文，读取播放器的字幕轨信息并 postMessage 给内容脚本 */
(function () {
  'use strict';
  function send() {
    try {
      var pr = null;
      var mp = document.getElementById('movie_player');
      if (mp && typeof mp.getPlayerResponse === 'function') {
        try {
          pr = mp.getPlayerResponse();
        } catch (e) {}
      }
      if (!pr) pr = window.ytInitialPlayerResponse;
      if (!pr || !pr.videoDetails) return;

      var tracks = [];
      try {
        var list =
          pr.captions &&
          pr.captions.playerCaptionsTracklistRenderer &&
          pr.captions.playerCaptionsTracklistRenderer.captionTracks;
        if (Array.isArray(list)) {
          tracks = list.map(function (t) {
            var nm = '';
            if (t.name) nm = t.name.simpleText || (t.name.runs && t.name.runs[0] && t.name.runs[0].text) || '';
            return {
              baseUrl: t.baseUrl,
              languageCode: t.languageCode,
              kind: t.kind || '',
              name: nm,
              isTranslatable: t.isTranslatable !== false,
            };
          });
        }
      } catch (e) {}

      window.postMessage(
        {
          source: 'tedl-yt',
          videoId: pr.videoDetails.videoId,
          title: pr.videoDetails.title || '',
          captionTracks: tracks,
        },
        '*'
      );
    } catch (e) {}
  }
  window.addEventListener('yt-navigate-finish', send);
  window.addEventListener('yt-page-data-updated', send);

  // 代理字幕请求：由页面上下文发起（Referer/Cookie 与 YouTube 自身请求一致）
  window.addEventListener('message', function (e) {
    if (e.source !== window) return;
    var d = e.data;
    if (!d || d.source !== 'tedl-yt-fetch' || !d.url) return;
    fetch(d.url, { credentials: 'include' })
      .then(function (r) {
        return r.text();
      })
      .then(function (t) {
        window.postMessage({ source: 'tedl-yt-fetch-res', id: d.id, ok: true, text: t }, '*');
      })
      .catch(function (err) {
        window.postMessage({ source: 'tedl-yt-fetch-res', id: d.id, ok: false, error: String(err) }, '*');
      });
  });
  // 播放器响应可能稍后才就绪，多试几次
  var n = 0;
  var timer = setInterval(function () {
    n++;
    send();
    if (n >= 10) clearInterval(timer);
  }, 1000);
})();
