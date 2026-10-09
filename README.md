# TED 双语字幕学英语（Chrome / Edge 扩展）

在 [ted.com](https://www.ted.com) 的演讲页叠加**英中双语字幕**，并围绕它做了一套英语学习功能。字幕数据来自 TED 官方公开字幕接口，**免费、无需 API Key**；某场演讲没有你要语言的官方字幕时，可选地用 AI 兜底翻译。

## 功能

- **双语字幕条**：英文 + 中文两行，跟随播放自动切换，当前句高亮。
- **显示模式**：双语 / 仅英 / 仅中 / 隐藏（快捷键 `M` 循环）。
- **逐句面板**：右侧列出全篇字幕，点任意句跳转，当前句自动滚动高亮（快捷键 `T`）。
- **逐句复读**：重播本句（`R`）、循环本句（`L`）、上一句 / 下一句（`K` / `J`）。
- **语速控制**：0.5×–2×（`[` / `]`）。
- **中文遮罩自测**：中文默认模糊，悬停或点击才显示（`H`）。
- **点词查义**：点字幕里的英文单词弹释义卡片——以国内快的**有道词典**中文释义为主（含音标、词性、多义项），并缓存；网络不通或有道无词条时，用英文词典兜底。可朗读发音、一键收藏。
- **导出 PDF**：字幕条 `📕` 一键把整篇字幕导出为 A4 PDF，可选**英+中双语**或**仅英文**，中文用系统字体渲染，适合打印/跟读。
- **生词本**：收藏词带上下文例句，支持搜索、删除、导出 **CSV** 或 **Anki** 用的 TSV。
- **AI 兜底翻译**：官方没有目标语言字幕时，用 OpenAI 兼容接口（DeepSeek / OpenAI / 本地模型均可）实时翻译，结果本地缓存。
- **自动识别字幕（语音转写）**：连英文字幕都没有的演讲，点 `🎙` 直接从 TED 播放器的**纯音频音轨**抓取整段音频、本地转码后调用 `whisper` 类接口识别，生成字幕后返回页面（配合 AI 翻译还能自动补中文）。需要支持 `/audio/transcriptions` 的接口与 Key。

## 安装（开发者模式）

1. 打开 Chrome 或 Edge，地址栏输入 `chrome://extensions`（Edge 为 `edge://extensions`）。
2. 打开右上角 **开发者模式**。
3. 点 **加载已解压的扩展程序**，选择本项目根目录（含 `manifest.json` 的那层）。
4. 打开任意 TED 演讲页，例如 <https://www.ted.com/talks/sir_ken_robinson_do_schools_kill_creativity>，字幕条会自动出现在底部。

> 注意：扩展只在**电脑端浏览器**的 ted.com 网页版生效，手机 App 不支持。

## 使用

- 底部字幕条上的按钮：`⏮ ⏯ 🔁 ⏭`（上/重播/循环/下一句）、模式切换、自测遮罩、逐句面板 `📄`、生词本 `📖`、设置 `⚙`。
- 点 `⚙` 会在新标签页打开设置；也可以右键浏览器工具栏里的扩展图标 → **选项**。
- 点英文单词 → 弹窗显示音标与释义 → `＋ 收藏生词`。
- 点 `📖` 打开生词本，可导出 CSV / Anki。

### 时间对齐（重要）

TED 播放器的视频在正片前有一段约 3～4 秒的**片头 (intro)**，而字幕接口的时间是相对**正片**的。扩展会自动读取播放器元数据、把这段片头时长补偿掉，使字幕与视频对齐。

若某个演讲仍有偏差，可手动微调：

- 页面上按 **`,`**（字幕提前 100ms）/ **`.`**（字幕延后 100ms），会自动保存。
- 或在设置页填「字幕微调（毫秒）」，正数表示字幕更晚。

### 快捷键（在页面非输入框处）

| 键 | 作用 |
| --- | --- |
| `J` / `K` | 下一句 / 上一句 |
| `R` | 重播本句 |
| `L` | 循环本句 |
| `M` | 切换显示模式 |
| `H` | 中文遮罩自测 |
| `T` | 逐句面板 |
| `[` / `]` | 减速 / 加速 |
| `,` / `.` | 字幕提前 / 延后 100ms |

## AI 兜底翻译配置

设置页（扩展详情 → 扩展选项，或字幕条 `⚙`）：

1. 勾选 **启用 AI 兜底翻译**。
2. 填 **Base URL**、**模型名**、**API Key**。示例：
   - DeepSeek：`https://api.deepseek.com/v1`，模型 `deepseek-chat`
   - OpenAI：`https://api.openai.com/v1`，模型 `gpt-4o-mini`
3. 点 **测试连接**，成功后 **保存**。首次保存会请求访问该接口地址的权限。

Key 只保存在浏览器本地（`chrome.storage.local`），只会发送到你填写的接口地址。

## 自动识别字幕配置

设置页「自动识别字幕」里先选**识别方式**，两种：

### ① OpenAI 兼容（上传音频）
填**识别接口地址 / 识别模型 / 识别 API Key**；留空则复用上面的翻译接口。要求支持 `POST {识别接口地址}/audio/transcriptions`：
- ✅ **OpenAI**：`https://api.openai.com/v1`，模型 `whisper-1`
- ✅ **自建 FunASR / Paraformer**：见下方 **本机一键部署**
- ❌ DeepSeek 及多数聚合代理**不支持**此路由（会返回 404）

自建服务若需要特定请求头或自定义路径，展开「高级：路径 / 请求头 / 语言」填写。若接口只返回整段文本、**不返回时间戳**，插件会按句子长度**估算时间轴**兜底。

#### FunASR 本机一键部署（推荐，离线免费）

仓库里已带一个开箱即用的服务 `tools/funasr-local`（OpenAI 兼容 + CORS + 返回时间戳）：

```bash
cd tools/funasr-local
pip install -r requirements.txt
python server.py --model paraformer-en --device cpu --port 8000
```

扩展里识别方式选 **OpenAI 兼容**，接口地址填 `http://127.0.0.1:8000/v1`，模型填 `paraformer-en`，Key 留空。
（首次启动会下载约 1GB 模型；有 N 卡可加 `--device cuda:0` 加速。）

### ② 阿里云百炼（本地转发）
百炼的识别**无法被浏览器直连**（实时接口的 WebSocket 不能带 `Authorization` 头；非实时接口又要公网音频 URL），所以需要一个**本机转发服务**：

```bash
cd tools/dashscope-relay
npm install          # 安装 ws
node relay.js        # 默认监听 127.0.0.1:8788
```

设置里选「阿里云百炼（本地转发）」，填 **百炼 API Key**、模型 `paraformer-realtime-v2`、**转发地址** `http://127.0.0.1:8788`，点「测试转发服务」。

流程：扩展把音轨解码成 16k PCM → 发给本机转发服务 → 转发服务带 `Authorization` 头连百炼实时识别 → 回传带时间戳的结果。

### ③ 本地 Whisper（浏览器内，仅英文，无需任何服务）
设置里识别方式选「本地 Whisper」，选模型（`whisper-tiny.en` 推荐 / `whisper-base.en`），可选模型下载镜像（默认 `https://hf-mirror.com`）。

- 用 transformers.js 在浏览器里跑 Whisper，**不联网识别、无需 Key**；首次会下载模型（tiny.en 约 40–75MB），之后缓存在本地、可离线。
- **边识别边出字幕**：音频按约 30 秒切段逐段识别，每段完成就把结果写回 TED 页，第一句通常十几秒就出现，无需等整段跑完。
- **仅支持英文**；CPU 上较慢（实测 tiny.en 约为音频时长的 1/3，一部 19 分钟演讲约 6～7 分钟，取决于机器）。

用法：打开**没有官方字幕**的演讲 → 点字幕条 `🎙` → 在弹出的页面点 **开始识别** → 完成后回到演讲页即出现字幕；若已启用 AI 翻译，还会自动补上中文。

实现：识别页从 TED 播放器的**纯音频音轨**（HLS 中的 AUDIO 分组）抓取分片，丢弃片头分片让时间从正片 0 秒开始，用 `mux.js` 把 MPEG-TS 转成 m4a，再按段识别并合并带时间戳的结果。

## YouTube 支持

插件也支持 **youtube.com/watch** 视频页（与 TED 同一套字幕层/生词本/导出）：

- **双语字幕**：自动取视频的英文字幕轨（官方或自动），并用 YouTube 自带的**自动翻译**生成中文（`tlang=zh-Hans`），无需 AI。
- **无英文字幕时**：可在设置里启用「AI 兜底翻译」，或该视频无字幕则提示。
- 逐句复读、语速、遮罩自测、逐句面板、点词查义、生词本、导出 PDF 均可用。
- 语音识别（`🎙`）目前仅 TED 支持；YouTube 上该按钮会提示。

> 注意：YouTube 在部分网络下无法访问；页面本身能打开，插件才能取到字幕。

## 目录结构

```
manifest.json               扩展清单（Manifest V3）
src/
  lib/align.js              字幕时间轴对齐 / 二分定位（纯逻辑）
  lib/ted.js                解析 talkId、可用语言、抓取官方字幕
  lib/docstore.js           每个演讲一份字幕文档（IndexedDB，字段级合并）
  lib/vocab.js              设置与生词本存储、CSV/Anki 导出
  content/content.js        内容脚本入口：编排整条链路
  content/overlay.js        字幕层 UI、点词弹窗、逐句面板
  content/youtube.js        YouTube 内容脚本（取字幕轨 + 自动翻译）
  content/yt-inject.js      注入到 YouTube 页面读取播放器字幕轨
  content/player.js         跳句 / 复播 / 循环 / 语速
  content/sync.js           currentTime ↔ 字幕同步
  content/overlay.css       样式
  background/service-worker.js  词典查询 + AI 翻译（带缓存）
  options/                  设置页
  popup/                    生词本弹窗（也可作为独立页打开）
  export/                   字幕导出 PDF 页面（canvas + pdf-lib）
  asr/                      自动识别字幕页面（抓音轨 + mux.js 转码 + 语音识别）
icons/                      图标
tools/                      本地开发/验证脚本（不参与运行）
```

## 开发与验证

```bash
node tools/test-core.cjs        # 用真实 TED 数据验证解析 / 对齐 / 定位（联网）
node tools/fetch-data.cjs       # 抓一份真实字幕生成预览数据
node tools/make-icons.cjs       # 重新生成图标
node tools/serve.cjs 8756       # 启动本地预览
#   浏览 http://localhost:8756/tools/preview.html
```

`tools/preview.html` 用真实字幕数据驱动字幕层，可在不安装扩展的情况下验收 UI 与交互。

## 说明与边界

- 官方字幕接口：`https://www.ted.com/talks/subtitles/id/{talkId}/lang/{lang}`（`{lang}` 为 `en`、`zh-cn` 等具体代码）。
- 中文字幕常按大意成块（一块覆盖多句英文），因此每句英文匹配**唯一一块**最贴合的中文，可能出现相邻英文句共用同一句中文，这是正常现象。
- TED 若改版页面结构，`talkId` 或字幕接口可能需要相应维护。

## 隐私

扩展不收集、不上传任何个人数据。生词本与设置仅存于本地；仅在启用 AI 翻译时，才会把英文字幕文本发送到你自行配置的接口。
