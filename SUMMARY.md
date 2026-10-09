# TED / YouTube 双语字幕学英语扩展 · 项目速览（上下文压缩）

- **路径**：`C:\Users\guan0\ted-dual-subs`
- **当前版本**：`0.8.8`，打包 `dist\ted-dual-subs-0.8.8.zip`
- **形态**：Chrome / Edge 扩展（Manifest V3），开发者模式加载
- **压缩包内容**：manifest + `src/` + `icons/` + README，共 35 个文件；**不含 `tools/`**，**不含任何私密 Key**

---

## 功能

### TED（`ted.com/talks/*`）
- 英中双语字幕（官方字幕优先）
- 逐句复读 / 循环 / 上下句、语速 0.5–2×
- 中文遮罩自测、逐句面板（点句跳转）
- 点词查义（国内有道优先，含音标/词性/发音）+ 生词本（搜索/删除/导出 CSV、Anki）
- 导出 PDF（双语 / 仅英文）
- AI 兜底翻译（官方无目标语言时，OpenAI 兼容接口，实时渐进）
- 自动识别字幕：本地 whisper(tiny.en，内置)、阿里云百炼(本地转发)、OpenAI 兼容上传

### YouTube（`youtube.com/watch*`）
- 双语字幕（Innertube **Android 客户端**取轨，规避 PO token）
- 中文：官方轨优先，取不到用 AI 兜底翻译
- 句子重组 + 过长切块 + 中文标点禁则（不落行首）
- 其余同 TED（复读/语速/查词/生词本/导出 PDF）

---

## 目录结构 / 关键文件

```
manifest.json                 MV3 清单（TED + YouTube 两个 content_scripts）
src/
  lib/align.js                字幕时间轴对齐 / 二分定位（纯逻辑，有单测）
  lib/ted.js                  解析 talkId、可用语言、抓官方字幕、HLS/片头偏移
  lib/docstore.js             每个演讲一份文档（IndexedDB），字段级合并（有单测）
  lib/vocab.js                设置 + 生词本存储、CSV/Anki 导出
  content/content.js          TED 内容脚本：编排整条链路
  content/youtube.js          YouTube 内容脚本：取轨、句子重组/切块、标点禁则
  content/yt-inject.js        注入 YouTube 页面读播放器信息（备用）
  content/overlay.js/.css     字幕层 UI、点词弹窗、逐句面板、全屏适配
  content/sync.js/player.js   播放同步 / 跳句·复读·循环·语速
  background/service-worker.js 词典(有道)、AI 翻译(级联细分)、片头偏移、文档读写广播、缓存清除
  asr/                        语音识别页（内置 transformers.js + ONNX Runtime wasm）
  export/                     字幕导出 PDF 页（canvas + pdf-lib）
  options/                    设置页
  popup/                      生词本弹窗
tools/                        仅开发用，不参与运行、不打进 zip
  dashscope-relay/            阿里云百炼本地转发服务（Node）
  funasr-local/               FunASR 本地识别服务（Python）
  serve.cjs                   本地预览/代理服务器
  test-*.cjs, load-test-*.cjs 各模块单测
```

---

## 已解决的关键问题（历史踩坑）

1. **字幕与视频时间不匹配** → TED 片头偏移；读 `metadata.json` 自动补偿，`,`/`.` 手动微调
2. **中文翻译突然消失** → 识别进度覆盖；改为「每演讲一份文档 + 字段级合并 + 持久化」
3. **切换演讲串字幕** → SPA 下 `__NEXT_DATA__` 是旧数据；改为严格 slug 校验
4. **设置打不开 / 连不上本机服务** → 后台 `chrome.tabs.create` 打开；转发服务加 CORS/私有网络头
5. **查词慢** → 换国内有道词典 + 本地缓存
6. **AI 翻译卡在某句** → 级联细分；每句最多尝试 3 次
7. **YouTube 取不到字幕** → 根因 `get_transcript` 已废弃 + `exp=xpe` 需 PO token；**解法：Innertube Android 客户端取轨**
8. **中文空格 / 标点落行首 / 字幕过长** → 智能拼接、标点禁则、按长度切块
9. **PDF 标题是网页标题** → 用演讲自身标题并去掉站点后缀
10. **YouTube 脚本整体崩溃** → `const` 暂时性死区

---

## 安装与使用

1. `edge://extensions`（或 `chrome://extensions`）→ 打开**开发者模式**
2. **加载已解压的扩展程序** → 选 `C:\Users\guan0\ted-dual-subs`
3. 改动代码后：扩展页点**刷新（↻）**，页面 **F5**

---

## 设置要点

- **翻译**：设置页勾「启用 AI 兜底翻译」+ 填 Base URL / 模型 / API Key（DeepSeek / OpenAI / 自建等）
- **YouTube 中文**：官方轨取不到时靠上面的 AI 翻译
- **TED 语音识别**：
  - 本地 whisper（内置 tiny.en，无需 Key）
  - 阿里云百炼：先跑 `tools\dashscope-relay\start.bat`，再在设置里选「阿里云百炼（本地转发）」
  - OpenAI 兼容上传：填支持 `/audio/transcriptions` 的接口

---

## 数据与隐私

- 用户所有 Key 均在设置页输入，存于浏览器本地 `chrome.storage.local`，**不进代码、不进压缩包**
- 代码里唯一的 `AIza...` 是 **YouTube 公开网页 API Key**（非私密，可删）
- 一键清除：设置页「清除全部字幕缓存」（删字幕文档与缓存，保留设置与生词本）

---

## 可选待办

- 删除已无用的 `INNERTUBE_KEY`（做到包内零 key）
- YouTube 识别搬进 offscreen（免开标签页）
- 行内句子再拆分 / 字幕长度阈值微调
- 转发或 FunASR 服务做成开机自启/常驻
