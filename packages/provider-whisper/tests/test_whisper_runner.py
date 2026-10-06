"""Engine-boundary unit doubles only; these tests do not measure ASR accuracy."""
import contextlib
import importlib.util
import io
import json
import os
import pathlib
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
path = pathlib.Path(__file__).resolve().parents[1] / "src/whisper_runner.py"
spec = importlib.util.spec_from_file_location("whisper_runner", path)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def segment(text=" recognized", start=0.2, end=0.8):
    return types.SimpleNamespace(text=text, start=start, end=end, words=[types.SimpleNamespace(start=start, end=end, word=text, probability=0.9)])


class RunnerTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="openfilm-whisper-unit-")
        self.root = pathlib.Path(self.temporary.name)
        for name in ["model.bin", "config.json", "tokenizer.json"]:
            (self.root / name).write_text("unit fixture only")
        self.version = patch.object(runner, "engine_version", return_value="unit-double-not-real-asr")
        self.version.start()
        self.output = io.StringIO()
        self.redirect = contextlib.redirect_stdout(self.output)
        self.redirect.__enter__()

    def tearDown(self):
        self.redirect.__exit__(None, None, None)
        self.version.stop()
        self.temporary.cleanup()

    def model(self, fail_init=False, fail_stream=False, fail_cpu=False):
        calls = []
        class Model:
            def __init__(model, path, **settings):
                calls.append({"path": path, **settings})
                model.device = settings["device"]
                if model.device == "cuda" and fail_init:
                    raise RuntimeError("simulated missing CUDA library")
                if model.device == "cpu" and fail_cpu:
                    raise RuntimeError("simulated CPU failure")
            def transcribe(model, audio, **settings):
                calls[-1]["transcribe"] = settings
                def items():
                    yield segment(" partial GPU" if model.device == "cuda" else " complete CPU")
                    if model.device == "cuda" and fail_stream:
                        raise RuntimeError("simulated CUDA execution failure")
                return items(), types.SimpleNamespace(language=settings["language"] or "en")
        return Model, calls

    def test_cpu_only_uses_local_int8_and_mandatory_word_timestamps(self):
        Model, calls = self.model()
        result = runner.transcribe(Model, self.root, self.root / "audio.wav", "auto", "cpu", 1)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["device"], "cpu")
        self.assertEqual(calls[0]["compute_type"], "int8")
        self.assertIs(calls[0]["local_files_only"], True)
        self.assertIsNone(calls[0]["transcribe"]["language"])
        self.assertIs(calls[0]["transcribe"]["word_timestamps"], True)
        self.assertEqual(result["segments"][0]["words"][0], {"start": 0.2, "end": 0.8, "text": " complete CPU", "confidence": 0.9})
        self.assertEqual(result["version"], "unit-double-not-real-asr")

    def test_auto_gpu_initialization_failure_retries_cpu_once(self):
        Model, calls = self.model(fail_init=True)
        result = runner.transcribe(Model, self.root, self.root / "audio.wav", "en", "auto", 1)
        self.assertEqual([item["device"] for item in calls], ["cuda", "cpu"])
        self.assertEqual(result["execution"], "cpu")
        self.assertIn("missing CUDA", result["fallbackReason"])
        events = [json.loads(line)["event"] for line in self.output.getvalue().splitlines()]
        self.assertIn("fallback", events)

    def test_gpu_generator_failure_discards_partial_output_and_retries_whole_source(self):
        Model, calls = self.model(fail_stream=True)
        result = runner.transcribe(Model, self.root, self.root / "audio.wav", "en", "gpu", 1)
        self.assertEqual([item["device"] for item in calls], ["cuda", "cpu"])
        self.assertEqual(result["text"], "complete CPU")
        self.assertNotIn("GPU", result["text"])
        self.assertIn("execution failure", result["fallbackReason"])

    def test_cpu_failure_is_not_retried_indefinitely(self):
        Model, calls = self.model(fail_init=True, fail_cpu=True)
        with self.assertRaisesRegex(RuntimeError, "CPU failure"):
            runner.transcribe(Model, self.root, self.root / "audio.wav", "ja", "auto", 1)
        self.assertEqual(len(calls), 2)

    def test_prompt_hints_are_context_only_and_survive_cpu_fallback(self):
        Model, calls = self.model(fail_stream=True)
        result = runner.transcribe(Model, self.root, self.root / "audio.wav", "zh", "auto", 1, ["台積電", "OpenFilm # &"])
        self.assertEqual([call["transcribe"]["initial_prompt"] for call in calls], ["台積電; OpenFilm # &"] * 2)
        self.assertEqual(result["text"], "complete CPU")
        self.assertNotIn("台積電", result["text"])

    def test_requested_languages_are_passed_without_text_rewriting(self):
        for language in ["zh", "en", "ja"]:
            Model, calls = self.model()
            result = runner.transcribe(Model, self.root, self.root / "audio.wav", language, "cpu", 1)
            self.assertEqual(calls[0]["transcribe"]["language"], language)
            self.assertEqual(result["language"], language)
            self.assertEqual(result["segments"][0]["words"][0]["text"], " complete CPU")

    def test_local_model_cannot_be_a_downloadable_model_identifier(self):
        with self.assertRaisesRegex(ValueError, "existing local"):
            runner.model_directory(self.root / "Systran/faster-whisper-tiny")
        (self.root / "tokenizer.json").unlink()
        with self.assertRaisesRegex(ValueError, "tokenizer.json"):
            runner.model_directory(self.root)
        self.assertEqual(os.environ["HF_HUB_OFFLINE"], "1")
        self.assertEqual(os.environ["TRANSFORMERS_OFFLINE"], "1")

    def test_silence_is_a_valid_empty_transcript(self):
        class SilentModel:
            def __init__(self, *args, **kwargs):
                pass
            def transcribe(self, *args, **kwargs):
                return iter([]), types.SimpleNamespace(language="en")
        result = runner.transcribe(SilentModel, self.root, self.root / "audio.wav", "auto", "cpu", 1)
        self.assertEqual(result["segments"], [])
        self.assertEqual(result["text"], "")

    def test_nonempty_segment_without_words_is_explicit_failure(self):
        class IncompleteModel:
            def __init__(self, *args, **kwargs):
                pass
            def transcribe(self, *args, **kwargs):
                item = segment()
                item.words = []
                return iter([item]), types.SimpleNamespace(language="en")
        with self.assertRaisesRegex(ValueError, "without requested word timestamps"):
            runner.transcribe(IncompleteModel, self.root, self.root / "audio.wav", "auto", "cpu", 1)


if __name__ == "__main__":
    unittest.main()
