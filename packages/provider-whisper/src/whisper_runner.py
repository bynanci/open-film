"""Optional local faster-whisper sidecar. JSON-lines protocol, no model downloads."""
import argparse
import gc
import importlib.metadata
import json
import math
import os
import pathlib
import sys
import wave

# Defense in depth alongside a real local directory and local_files_only=True.
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"


def emit(event, **fields):
    print(json.dumps({"event": event, **fields}, ensure_ascii=False, allow_nan=False), flush=True)


def model_directory(value):
    path = pathlib.Path(value).expanduser().resolve()
    if not path.is_dir():
        raise ValueError("The model must be an existing local faster-whisper directory.")
    for name in ["model.bin", "config.json", "tokenizer.json"]:
        candidate = path / name
        if not candidate.is_file() or candidate.stat().st_size == 0:
            raise ValueError("Local model file missing or empty: " + name)
    return path


def engine_version():
    return "faster-whisper/" + importlib.metadata.version("faster-whisper") + "; ctranslate2/" + importlib.metadata.version("ctranslate2")


def perform(model_class, model_path, audio, language, execution, duration, prompt_hints=None):
    emit("stage", stage="loading-model", execution=execution)
    model = model_class(str(model_path), device="cuda" if execution == "gpu" else "cpu",
                        compute_type="float16" if execution == "gpu" else "int8",
                        local_files_only=True)
    emit("stage", stage="transcribing", execution=execution)
    iterator, information = model.transcribe(str(audio), language=None if language == "auto" else language,
                                            word_timestamps=True, vad_filter=True, beam_size=5,
                                            initial_prompt="; ".join(prompt_hints) if prompt_hints else None)
    segments = []
    # Iterating is part of inference and must be inside the GPU fallback boundary.
    for item in iterator:
        text = item.text.strip()
        if not text:
            continue
        words = []
        for word in item.words or []:
            entry = {"start": float(word.start), "end": float(word.end), "text": word.word}
            confidence = getattr(word, "probability", None)
            if confidence is not None:
                entry["confidence"] = float(confidence)
            words.append(entry)
        if not words:
            raise ValueError("The speech engine returned a nonempty segment without requested word timestamps.")
        segments.append({"id": "segment-" + str(len(segments) + 1), "start": float(item.start),
                         "end": float(item.end), "text": text, "words": words})
        emit("progress", value=min(0.98, float(item.end) / duration) if duration > 0 else 0)
    emit("stage", stage="post-processing", execution=execution)
    return {"text": " ".join(item["text"] for item in segments), "language": information.language,
            "segments": segments, "execution": execution, "model": model_path.name, "version": engine_version()}


def transcribe(model_class, model_path, audio, language, execution, duration, prompt_hints=None):
    if execution == "cpu":
        return perform(model_class, model_path, audio, language, "cpu", duration, prompt_hints)
    try:
        return perform(model_class, model_path, audio, language, "gpu", duration, prompt_hints)
    except Exception as error:
        # No partial GPU transcript is published; CPU retries the whole source once.
        reason = type(error).__name__ + ": " + str(error)[:1500]
        emit("fallback", reason=reason, execution="cpu")
        gc.collect()
    result = perform(model_class, model_path, audio, language, "cpu", duration, prompt_hints)
    result["fallbackReason"] = reason
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True)
    parser.add_argument("--audio")
    parser.add_argument("--language", choices=["auto", "zh", "en", "ja"], default="auto")
    parser.add_argument("--execution", choices=["auto", "cpu", "gpu"], default="auto")
    parser.add_argument("--prompt-hints", default="[]")
    parser.add_argument("--probe", action="store_true")
    args = parser.parse_args()
    try:
        path = model_directory(args.model)
    except (OSError, ValueError) as error:
        emit("error", code="transcription.modelInvalid", detail=str(error))
        return 1
    try:
        from faster_whisper import WhisperModel
        version = engine_version()
    except Exception as error:
        emit("error", code="transcription.runtimeUnavailable", detail="Install the optional local faster-whisper Python engine: " + str(error)[:1500])
        return 1
    if args.probe:
        emit("available", available=True, model=path.name, version=version)
        return 0
    try:
        if not args.audio:
            raise ValueError("An extracted local WAV is required.")
        audio = pathlib.Path(args.audio).resolve()
        with wave.open(str(audio), "rb") as stream:
            if stream.getnchannels() != 1 or stream.getframerate() != 16000 or stream.getsampwidth() != 2:
                raise ValueError("Expected a 16kHz mono 16-bit PCM WAV.")
            duration = stream.getnframes() / stream.getframerate()
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError("The extracted audio is empty.")
        hints = json.loads(args.prompt_hints)
        if (not isinstance(hints, list) or len(hints) > 50 or
            any(not isinstance(hint, str) or not hint.strip() or len(hint) > 200 or
                any(ord(char) < 32 or ord(char) == 127 for char in hint) for hint in hints) or
            sum(len(hint) for hint in hints) > 2000):
            raise ValueError("Invalid or oversized terminology context.")
        result = transcribe(WhisperModel, path, audio, args.language, args.execution, duration, hints)
        emit("result", result=result)
        return 0
    except Exception as error:
        emit("error", code="transcription.failed", detail=type(error).__name__ + ": " + str(error)[:2000])
        return 1


if __name__ == "__main__":
    sys.exit(main())
