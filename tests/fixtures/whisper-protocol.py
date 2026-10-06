"""TEST ONLY: deterministic protocol, not ASR; optional bounded delay exercises jobs."""
import argparse
import json
import os
import time
import wave


def emit(event, **fields):
    print(json.dumps({"event": event, **fields}, ensure_ascii=False), flush=True)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--probe", action="store_true")
parser.add_argument("--model", required=True)
parser.add_argument("--audio")
parser.add_argument("--language", default="auto")
parser.add_argument("--execution", default="auto")
parser.add_argument("--prompt-hints", default="[]")
args = parser.parse_args()
if args.probe:
    emit("available", available=True, model="fixture-protocol-not-asr", version="fixture-protocol/1")
else:
    with wave.open(args.audio, "rb") as stream:
        duration = stream.getnframes() / stream.getframerate()
    language = args.language if args.language != "auto" else "en"
    phrases = {
        "en": ["Our favorite memory starts here.", "We will remember this day."],
        "zh": ["我們 最 喜歡 的 回憶 從 這裡 開始。", "我們 會 記住 這 一天。"],
        "ja": ["私たちの 大切な 思い出 が ここから 始まります。", "この 日を ずっと 覚えています。"],
    }[language]
    emit("stage", stage="loading-model")
    emit("stage", stage="transcribing")
    # Set only on the Playwright server; never consulted by the real provider.
    delay = max(0, min(30, float(os.environ.get("OPENFILM_WHISPER_FIXTURE_DELAY", "0"))))
    if delay:
        time.sleep(delay)
    segments = []
    for index, phrase in enumerate(phrases):
        start = duration * (0.05 if index == 0 else 0.55)
        end = duration * (0.45 if index == 0 else 0.95)
        tokens = phrase.split()
        step = (end - start) / len(tokens)
        words = [{"start": start + step * offset, "end": min(end, start + step * (offset + 1)), "text": token, "confidence": 0.9} for offset, token in enumerate(tokens)]
        segments.append({"id": "fixture-segment-" + str(index + 1), "start": start, "end": end, "text": phrase, "words": words})
        emit("progress", value=end / duration)
    emit("stage", stage="post-processing")
    emit("result", result={"text": " ".join(phrases), "language": language, "segments": segments,
                            "execution": "cpu", "model": "fixture-protocol-not-asr", "version": "fixture-protocol/1"})
