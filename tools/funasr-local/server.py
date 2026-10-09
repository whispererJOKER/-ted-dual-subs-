#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TED 字幕扩展 —— FunASR 本地识别服务（OpenAI 兼容）

提供一个与 OpenAI `/v1/audio/transcriptions` 兼容的接口，并带上 CORS，
方便浏览器扩展直接调用。使用 FunASR 的 paraformer 模型，返回带时间戳的分句。

安装并运行（建议 Python 3.10/3.11）：

    cd tools/funasr-local
    pip install -r requirements.txt
    python server.py                     # 默认 paraformer-zh，CPU，端口 8000
    python server.py --model paraformer-en --device cpu   # 识别英文（TED 用这个）
    python server.py --device cuda --port 8000            # 有 N 卡可加速

接口：
    POST /v1/audio/transcriptions   （multipart: file, model, response_format, language）
    GET  /health
    GET  /v1/models

扩展里「自动识别字幕」选「OpenAI 兼容（上传音频）」，地址填 http://127.0.0.1:8000/v1
"""
import argparse
import os
import tempfile

import uvicorn
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

MODEL = "paraformer-zh"
DEVICE = "cpu"
_asr = None


def build_model(model_name: str, device: str):
    from funasr import AutoModel

    kwargs = {"model": model_name, "device": device, "disable_update": True}
    # 中文模型配 VAD + 标点；英文等其它模型只用 VAD
    kwargs["vad_model"] = "fsmn-vad"
    if "zh" in model_name:
        kwargs["punc_model"] = "ct-punc"
    print(f"[funasr] 正在加载模型 {model_name}（device={device}）…首次会自动下载，请耐心等待")
    return AutoModel(**kwargs)


def to_segments(res):
    """把 FunASR 结果转成 [{start,end,text}]（秒）"""
    if not res:
        return [], ""
    item = res[0] if isinstance(res, list) else res
    text = (item.get("text") or "").strip()
    segs = []
    info = item.get("sentence_info")
    if isinstance(info, list) and info:
        for s in info:
            t = (s.get("text") or "").strip()
            if not t:
                continue
            segs.append(
                {
                    "start": round(float(s.get("start", 0)) / 1000.0, 3),
                    "end": round(float(s.get("end", 0)) / 1000.0, 3),
                    "text": t,
                }
            )
    if not segs and text:
        segs = [{"start": 0.0, "end": 0.0, "text": text}]
    return segs, text


app = FastAPI(title="FunASR OpenAI-compatible ASR")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL, "device": DEVICE, "loaded": _asr is not None}


@app.get("/v1/models")
def models():
    return {"object": "list", "data": [{"id": MODEL, "object": "model"}]}


@app.post("/v1/audio/transcriptions")
async def transcriptions(
    file: UploadFile = File(...),
    model: str = Form(MODEL),
    response_format: str = Form("json"),
    language: str = Form(None),
):
    global _asr
    if _asr is None:
        # --lazy 模式：首次请求时才加载模型
        try:
            _asr = build_model(MODEL, DEVICE)
        except Exception as e:  # noqa
            return JSONResponse(status_code=503, content={"error": f"模型加载失败：{e}"})

    data = await file.read()
    if not data:
        return JSONResponse(status_code=400, content={"error": "空音频"})

    suffix = os.path.splitext(file.filename or "audio.wav")[1] or ".wav"
    fd, path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        res = _asr.generate(input=path, batch_size_s=300, sentence_timestamp=True)
    except Exception as e:  # noqa
        return JSONResponse(status_code=500, content={"error": f"识别失败：{e}"})
    finally:
        try:
            os.remove(path)
        except OSError:
            pass

    segs, text = to_segments(res)
    if response_format == "text":
        return text
    return {"text": text, "segments": segs, "model": model, "language": language or "auto"}


def main():
    global MODEL, DEVICE, _asr
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="paraformer-zh", help="paraformer-zh / paraformer-en / sensevoice 等")
    ap.add_argument("--device", default="cpu", help="cpu / cuda:0")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--lazy", action="store_true", help="启动后再加载模型（默认启动即加载）")
    args = ap.parse_args()

    MODEL = args.model
    DEVICE = args.device
    if not args.lazy:
        _asr = build_model(MODEL, DEVICE)
        print("[funasr] 模型加载完成")

    print(f"[funasr] 监听 http://{args.host}:{args.port}")
    print(f"[funasr] 扩展设置里填接口地址：http://{args.host}:{args.port}/v1")
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
