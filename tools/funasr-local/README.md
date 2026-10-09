# FunASR 本地识别服务

给 TED 字幕扩展「自动识别字幕」用的本地语音识别服务：OpenAI 兼容接口 + 自带 CORS，无需公网、离线运行。

## 1. 环境

- Python 3.10 / 3.11（推荐）
- 磁盘：模型首次下载约 1GB 左右
- 可选：NVIDIA 显卡 + CUDA（会快很多；没有就用 CPU，慢一些）

## 2. 安装并启动

```bash
cd tools/funasr-local
pip install -r requirements.txt

# TED 演讲是英文 → 用英文模型
python server.py --model paraformer-en --device cpu --port 8000

# 若识别中文内容
python server.py --model paraformer-zh --device cpu --port 8000

# 有 N 卡
python server.py --model paraformer-en --device cuda:0 --port 8000
```

首次启动会自动从 ModelScope 下载模型，请耐心等待；之后启动很快。

> 若下载慢，可先设置镜像：`set MODELSCOPE_CACHE=./model_cache`（可选）；或按 FunASR 文档配置 HF 镜像。

## 3. 扩展里配置

设置页 →「自动识别字幕」→ 识别方式选 **OpenAI 兼容（上传音频）**：

- 识别接口地址：`http://127.0.0.1:8000/v1`
- 识别模型：`paraformer-en`（与启动参数一致）
- 识别 API Key：留空
- 点 **测试识别接口** → 显示"识别接口可用 ✓"

然后打开没有字幕的 TED 演讲，点字幕条 `🎙` → 开始识别。

## 说明

- 接口：`POST /v1/audio/transcriptions`（字段 `file` / `model` / `response_format` / `language`），`GET /health`，`GET /v1/models`。
- 服务返回 `{ text, segments:[{start,end,text}] }`，`start/end` 为秒；扩展会据此生成带时间轴的字幕。
- 服务只监听 `127.0.0.1`，仅本机可访问。
- 如果 `paraformer-en` 不说标点，可在 `server.py` 里给它也加 `punc_model`（中文用的 `ct-punc` 不一定适配英文）。

## 备选：官方 Docker（如果你更习惯 Docker）

FunASR 官方也提供 OpenAI 兼容的示例服务（`examples/openai_api`），但没有默认 CORS，且首次构建较重；除非你已有 Docker 工作流，否则用上面的 pip 方式更省事。
