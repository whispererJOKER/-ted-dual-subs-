/* TED 双语字幕 —— 导出 PDF（canvas 绘制中文 + pdf-lib 拼装，纯本地） */
(function () {
  'use strict';
  const PAYLOAD_KEY = 'tedl_export_payload';

  const PDFLib = window.PDFLib;

  // A4 @144dpi
  const PAGE_W = 1191;
  const PAGE_H = 1684;
  const MARGIN_X = 76;
  const MARGIN_TOP = 84;
  const MARGIN_BOTTOM = 96;
  const MAX_W = PAGE_W - MARGIN_X * 2;
  const LINE_EN = 30;
  const LINE_ZH = 27;
  const ROW_GAP = 26;
  const EN_FONT = '24px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  const ZH_FONT = '22px "PingFang SC", "Microsoft YaHei", sans-serif';

  let data = null;

  function $(id) {
    return document.getElementById(id);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }

  function langMode() {
    return document.querySelector('input[name="lang"]:checked').value;
  }

  /* 按宽度断行（逐字累加，兼容中英文） */
  function wrap(ctx, text, maxW) {
    const lines = [];
    let line = '';
    for (const ch of String(text || '')) {
      if (line && ctx.measureText(line + ch).width > maxW) {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  function blockEstimate(ctx, row, both) {
    const enLines = wrap(ctx, row.en, MAX_W - 40);
    const zh = both && row.zh ? row.zh : '';
    const zhLines = zh ? wrap(ctx, zh, MAX_W - 40) : [];
    const blockH = enLines.length * LINE_EN + (zhLines.length ? zhLines.length * LINE_ZH + 8 : 0) + ROW_GAP;
    return { enLines: enLines, zhLines: zhLines, blockH: blockH };
  }

  function newCanvas() {
    const cv = document.createElement('canvas');
    cv.width = PAGE_W;
    cv.height = PAGE_H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    return ctx;
  }

  function drawHeader(ctx, title) {
    ctx.fillStyle = '#e62b1e';
    ctx.font = 'bold 34px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textBaseline = 'top';
    // 顶部小红条
    ctx.fillStyle = '#e62b1e';
    ctx.fillRect(MARGIN_X, 40, 10, 34);
    ctx.fillStyle = '#1a1a1a';
    ctx.textAlign = 'left';
    ctx.fillText('TED 双语字幕', MARGIN_X + 20, 40);
    ctx.font = '28px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = '#333';
    ctx.fillText(title || '', MARGIN_X, 96);
    ctx.strokeStyle = '#dddddd';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(MARGIN_X, 148);
    ctx.lineTo(PAGE_W - MARGIN_X, 148);
    ctx.stroke();
  }

  function drawPageNumber(ctx, pageNo) {
    ctx.fillStyle = '#999';
    ctx.font = '22px "Microsoft YaHei",sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'center';
    ctx.fillText(String(pageNo), PAGE_W / 2, PAGE_H - 40);
  }

  function renderPages(title, rows, both) {
    const pages = [];
    let ctx = newCanvas();
    drawHeader(ctx, title);
    let y = 196;
    let pageNo = 1;

    for (const row of rows) {
      const est = blockEstimate(ctx, row, both);
      if (y + est.blockH > PAGE_H - MARGIN_BOTTOM) {
        drawPageNumber(ctx, pageNo);
        pages.push(ctx.canvas);
        ctx = newCanvas();
        drawHeader(ctx, title);
        y = 196;
        pageNo++;
      }
      // EN
      ctx.font = EN_FONT;
      ctx.fillStyle = '#111111';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      for (const ln of est.enLines) {
        ctx.fillText(ln, MARGIN_X, y);
        y += LINE_EN;
      }
      // ZH
      if (est.zhLines.length) {
        y += 8;
        ctx.font = ZH_FONT;
        ctx.fillStyle = '#7a6a2d';
        for (const ln of est.zhLines) {
          ctx.fillText(ln, MARGIN_X, y);
          y += LINE_ZH;
        }
      }
      y += ROW_GAP;
    }
    drawPageNumber(ctx, pageNo);
    pages.push(ctx.canvas);
    return pages;
  }

  function dataURLToBytes(dataURL) {
    const b64 = dataURL.split(',')[1];
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  async function buildPdf(title, rows, both) {
    const canvases = renderPages(title, rows, both);
    const pdf = await PDFLib.PDFDocument.create();
    const A4 = [595.28, 841.89];
    for (const cv of canvases) {
      const bytes = dataURLToBytes(cv.toDataURL('image/png'));
      const img = await pdf.embedPng(bytes);
      const page = pdf.addPage(A4);
      page.drawImage(img, { x: 0, y: 0, width: A4[0], height: A4[1] });
    }
    return pdf.save();
  }

  function download(bytes, name) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function renderPreview() {
    const both = langMode() === 'both';
    const main = $('preview');
    main.classList.toggle('en-only', !both);
    main.innerHTML = '';
    if (!data || !data.cues) return;
    const frag = document.createDocumentFragment();
    data.cues.forEach(function (c, i) {
      const row = document.createElement('div');
      row.className = 'row';
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = String(i + 1);
      const en = document.createElement('div');
      en.className = 'en';
      en.textContent = c.en || '';
      row.appendChild(num);
      row.appendChild(en);
      if (c.zh) {
        const zh = document.createElement('div');
        zh.className = 'zh';
        zh.textContent = c.zh;
        row.appendChild(zh);
      }
      frag.appendChild(row);
    });
    main.appendChild(frag);
  }

  var dl = $('download');
  if (dl) {
    dl.addEventListener('click', async function () {
      if (!data || !data.cues || !data.cues.length) return;
      var btn = $('download');
      var status = $('status');
      btn.disabled = true;
      status.textContent = '正在生成…';
      try {
        var bytes = await buildPdf(data.title || 'TED 字幕', data.cues, document.querySelector('input[name="lang"]:checked').value === 'both');
        var safe = (data.title || 'ted-subtitle').replace(/[\\/:*?"<>|]/g, '');
        download(bytes, safe + '.pdf');
        status.textContent = '已生成 ' + (bytes.length / 1024).toFixed(1) + ' KB，开始下载';
      } catch (e) {
        status.textContent = '生成失败：' + String(e.message || e);
      } finally {
        btn.disabled = false;
      }
    });
  }

  document.querySelectorAll('input[name="lang"]').forEach(function (r) {
    r.addEventListener('change', renderPreview);
  });

  (async function boot() {
    let sample = window.__TEDL_EXPORT_SAMPLE__ || null;
    try {
      const got = await chrome.storage.local.get(PAYLOAD_KEY);
      if (got && got[PAYLOAD_KEY]) sample = got[PAYLOAD_KEY];
    } catch (e) {
      /* 非扩展环境时可用 window.__TEDL_EXPORT_SAMPLE__ 注入样本 */
    }
    data = sample || null;
    if (data && data.cues && data.cues.length) {
      $('talkmeta').textContent =
        (data.title || '') +
        ' · ' +
        data.cues.length +
        ' 句' +
        (data.talkId ? ' · talk#' + data.talkId : '');
    } else {
      $('talkmeta').textContent = '无可导出数据：请先在 TED 演讲页打开字幕条，再点“导出 PDF”。';
    }
    renderPreview();
  })();

  // 便于本地预览/自动测试验证 PDF 生成
  window.__TEDLExport = { buildPdf: buildPdf, renderPages: renderPages };
})();