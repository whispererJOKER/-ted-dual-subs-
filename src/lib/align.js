/* TED 双语字幕 —— 时间轴对齐与定位
 * 纯逻辑，无 DOM 依赖，可在浏览器 content script 与 Node 中通用。
 */
(function (root) {
  'use strict';
  const TEDL = (root.TEDL = root.TEDL || {});

  /** 把字幕正文里的换行/多空格规整成单行 */
  function normalizeContent(s) {
    return String(s == null ? '' : s)
      .replace(/\s*\n\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /** TED captions -> 统一 cue 结构 { start, end, text }（毫秒） */
  function toCues(captions) {
    if (!Array.isArray(captions)) return [];
    return captions
      .map(function (c) {
        const start = Number(c.startTime) || 0;
        const dur = Number(c.duration) || 0;
        return { start: start, end: start + dur, text: normalizeContent(c.content) };
      })
      .filter(function (c) {
        return c.text.length > 0;
      })
      .sort(function (a, b) {
        return a.start - b.start;
      });
  }

  /**
   * 以英文轨道为基准，为每句英文匹配唯一一块最贴合的目标语言字幕。
   * TED 的中文字幕常按大意成块（一块覆盖多句英文），因此不拼接、只取一块：
   *   1) 优先取「覆盖该英文句中点」的中文字幕；
   *   2) 否则取时间重叠最多的一块；
   *   3) 都没有则为空。
   * 返回 [{ start, end, en, zh }]
   */
  function align(enCaptions, zhCaptions) {
    const en = toCues(enCaptions);
    const zh = zhCaptions ? toCues(zhCaptions) : [];
    return en.map(function (e) {
      let best = null;
      let bestScore = 0;
      const mid = (e.start + e.end) / 2;
      for (let i = 0; i < zh.length; i++) {
        const z = zh[i];
        if (z.start <= mid && mid < z.end) {
          best = z; // 中点在块内，直接采用
          bestScore = Infinity;
          break;
        }
        const overlap = Math.min(e.end, z.end) - Math.max(e.start, z.start);
        if (overlap > bestScore) {
          bestScore = overlap;
          best = z;
        }
      }
      return { start: e.start, end: e.end, en: e.text, zh: best ? best.text : '' };
    });
  }

  /**
   * 二分查找当前时间对应的 cue 下标。
   * tolerance：超出 cue 结束时间多少毫秒仍算当前句（避免句间空隙闪烁）。
   */
  function findCueIndex(cues, tMs, tolerance) {
    if (!cues || !cues.length) return -1;
    const tol = tolerance == null ? 400 : tolerance;
    let lo = 0;
    let hi = cues.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= tMs) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (ans === -1) return -1;
    if (tMs <= cues[ans].end + tol) return ans;
    return -1;
  }

  TEDL.align = {
    normalizeContent: normalizeContent,
    toCues: toCues,
    align: align,
    findCueIndex: findCueIndex,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* Node 测试环境导出 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.TEDL.align;
}
