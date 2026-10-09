/* TED 双语字幕 —— 从 TED 页面解析 talkId / 可用语言 / 抓取字幕
 */
(function (root) {
  'use strict';
  const TEDL = (root.TEDL = root.TEDL || {});
  const ORIGIN = 'https://www.ted.com';

  function parseNextData(jsonText) {
    if (!jsonText) return null;
    try {
      return JSON.parse(jsonText);
    } catch (e) {
      return null;
    }
  }

  /** 从 <script id="__NEXT_DATA__"> 文本里取 videoData */
  function videoDataFromNextDataText(text) {
    const nd = parseNextData(text);
    if (!nd) return null;
    const pp = nd.props && nd.props.pageProps;
    return (pp && pp.videoData) || null;
  }

  /** 从一段完整 HTML 字符串里解析 talkId（Node 测试用） */
  function getTalkIdFromHtml(html) {
    const m = String(html).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (m) {
      const vd = videoDataFromNextDataText(m[1]);
      if (vd && vd.id != null) return String(vd.id);
    }
    // 兜底：直接在 HTML 中找 "videoData":{...,"id":"xx"}
    const m2 = String(html).match(/"videoData":\{[^}]*"id":"?(\d+)"?/);
    return m2 ? m2[1] : null;
  }

  /** 当前文档里的 talkId */
  function getTalkId(doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d) return null;
    const el = d.getElementById('__NEXT_DATA__');
    if (el) {
      const vd = videoDataFromNextDataText(el.textContent);
      if (vd && vd.id != null) return String(vd.id);
    }
    const m = d.documentElement && d.documentElement.innerHTML
      ? d.documentElement.innerHTML.match(/"videoData":\{[^}]*"id":"?(\d+)"?/)
      : null;
    return m ? m[1] : null;
  }

  /** 页面上 <link rel="alternate" hreflang> 列出的官方字幕语言代码 */
  function getAvailableLanguages(doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || !d.querySelectorAll) return [];
    const seen = Object.create(null);
    const out = [];
    d.querySelectorAll('link[rel="alternate"][hreflang]').forEach(function (l) {
      const href = l.getAttribute('href') || '';
      const m = href.match(/[?&]language=([^&]+)/);
      if (!m) return;
      const code = decodeURIComponent(m[1]);
      if (code && !seen[code]) {
        seen[code] = true;
        out.push(code);
      }
    });
    return out;
  }

  /** 从一段完整 HTML 字符串里解析官方语言列表（Node 测试用） */
  function languagesFromHtml(html) {
    const seen = Object.create(null);
    const out = [];
    const linkRe = /<link\b[^>]*>/gi;
    const attrRe = /([a-zA-Z-]+)="([^"]*)"/g;
    let tag;
    while ((tag = linkRe.exec(String(html)))) {
      const attrs = Object.create(null);
      let a;
      while ((a = attrRe.exec(tag[0]))) attrs[a[1].toLowerCase()] = a[2];
      if ((attrs.rel || '').toLowerCase() !== 'alternate') continue;
      const href = attrs.href || '';
      const lm = href.match(/[?&]language=([^&]+)/);
      if (!lm) continue;
      const code = decodeURIComponent(lm[1]);
      if (code && !seen[code]) {
        seen[code] = true;
        out.push(code);
      }
    }
    return out;
  }

  /** 解析视频播放器信息（HLS 地址里的 project_masters id 与 intro_master_id） */
  function getHlsInfo(doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d) return null;
    const el = d.getElementById && d.getElementById('__NEXT_DATA__');
    let url = '';
    if (el) {
      const nd = parseNextData(el.textContent);
      const vd = nd && nd.props && nd.props.pageProps && nd.props.pageProps.videoData;
      if (vd) url = vd.hlsUrl || '';
    }
    if (!url) {
      const m = (d.documentElement && d.documentElement.innerHTML || '').match(
        /"hlsUrl":"([^"]+)"/
      );
      if (m) url = m[1].replace(/\\u0026/g, '&');
    }
    return hlsInfoFromUrl(url);
  }

  function hlsInfoFromUrl(url) {
    if (!url) return null;
    const pm = url.match(/project_masters\/(\d+)\//);
    const im = url.match(/intro_master_id=(\d+)/);
    return {
      hlsUrl: url,
      projectId: pm ? pm[1] : null,
      introMasterId: im ? im[1] : null,
    };
  }

  /** 片头偏移：metadata.json 里第一个 primaryDomain 之前所有分段时长之和（毫秒） */
  function parseIntroOffset(metadata) {
    const domains = metadata && metadata.domains;
    if (!Array.isArray(domains)) return 0;
    let ms = 0;
    for (let i = 0; i < domains.length; i++) {
      const d = domains[i];
      if (d && d.primaryDomain) break;
      ms += (Number(d && d.duration) || 0) * 1000;
    }
    return Math.round(ms);
  }

  /** 抓取某语言的官方字幕，返回 captions 数组或 null */
  async function fetchSubtitles(talkId, langCode) {
    if (!talkId || !langCode) return null;
    const url =
      ORIGIN +
      '/talks/subtitles/id/' +
      encodeURIComponent(talkId) +
      '/lang/' +
      encodeURIComponent(langCode);
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return null;
    let data;
    try {
      data = await res.json();
    } catch (e) {
      return null;
    }
    return data && Array.isArray(data.captions) ? data.captions : null;
  }

  TEDL.ted = {
    ORIGIN: ORIGIN,
    getTalkId: getTalkId,
    getTalkIdFromHtml: getTalkIdFromHtml,
    getAvailableLanguages: getAvailableLanguages,
    languagesFromHtml: languagesFromHtml,
    getHlsInfo: getHlsInfo,
    hlsInfoFromUrl: hlsInfoFromUrl,
    parseIntroOffset: parseIntroOffset,
    fetchSubtitles: fetchSubtitles,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* Node 测试环境导出 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.TEDL.ted;
}
