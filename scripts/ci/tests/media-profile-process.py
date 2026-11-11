#!/usr/bin/python3
# SPDX-License-Identifier: Apache-2.0
"""Bounded real-process ownership probes; no FFmpeg or synthetic metrics."""
import ctypes
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

WRAPPER = Path(__file__).resolve().parents[1] / "media-profile-command.py"

class ProcessObserverTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="openfilm-profile-process-")
        self.log = Path(self.temp.name) / "commands.jsonl"
        self.env = dict(os.environ, OPENFILM_PROFILE_COMMANDS=str(self.log))

    def tearDown(self):
        self.temp.cleanup()

    def test_child_term_and_kill_preserve_parent_visible_signal_and_log(self):
        for sig in (signal.SIGTERM, signal.SIGKILL):
            with self.subTest(signal=sig):
                code = f"import os,signal; os.kill(os.getpid(), {sig})"
                direct = subprocess.run([sys.executable, "-c", code], capture_output=True)
                observed = subprocess.run([str(WRAPPER), sys.executable, "-c", code], env=self.env, capture_output=True, timeout=3)
                self.assertEqual(observed.returncode, direct.returncode)
                self.assertEqual(observed.returncode, -sig)
                self.assertEqual(observed.stderr, b"")
                self.assertEqual(json.loads(self.log.read_text().splitlines()[-1])["exitCode"], -sig)

    def test_preserves_literal_arguments_environment_binary_stdin_and_output(self):
        args = ["space path", "$literal", "line\nbreak"]
        code = "import json,os,sys; sys.stdout.buffer.write(json.dumps([sys.argv[1:],os.environ['PROFILE_LITERAL']]).encode()+b'\\n'+sys.stdin.buffer.read()); sys.stderr.write('literal stderr')"
        env = dict(self.env, PROFILE_LITERAL="space $literal\nvalue")
        stdin = b"\x00binary\xff\n"
        direct = subprocess.run([sys.executable, "-c", code, *args], env=env, input=stdin, capture_output=True)
        observed = subprocess.run([str(WRAPPER), sys.executable, "-c", code, *args], env=env, input=stdin, capture_output=True, timeout=3)
        self.assertEqual((observed.returncode, observed.stdout, observed.stderr), (direct.returncode, direct.stdout, direct.stderr))
        self.assertEqual(observed.returncode, 0)
        self.assertEqual(json.loads(self.log.read_text())["args"], ["-c", code, *args])

    def test_normal_parent_term_is_forwarded_and_recorded(self):
        code = "import time; print('ready',flush=True); time.sleep(30)"
        wrapper = subprocess.Popen([str(WRAPPER), sys.executable, "-c", code], env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            self.assertEqual(wrapper.stdout.readline(), b"ready\n")
            wrapper.terminate()
            _stdout, stderr = wrapper.communicate(timeout=3)
            self.assertEqual(wrapper.returncode, -signal.SIGTERM)
            self.assertEqual(stderr, b"")
            self.assertEqual(json.loads(self.log.read_text())["exitCode"], -signal.SIGTERM)
        finally:
            if wrapper.poll() is None:
                wrapper.kill()
            wrapper.communicate(timeout=3)

    def test_term_to_kill_closes_pipes_and_terminates_real_child(self):
        # Adopt and reap any orphan so a zombie cannot pass a mere PID-existence check.
        libc = ctypes.CDLL(None, use_errno=True)
        self.assertEqual(libc.prctl(36, 1, 0, 0, 0), 0)  # PR_SET_CHILD_SUBREAPER
        pidfile = Path(self.temp.name) / "child.pid"
        code = "import os,signal,time,pathlib; signal.signal(signal.SIGTERM, signal.SIG_IGN); pathlib.Path(os.environ['CHILD_PID_FILE']).write_text(str(os.getpid())); print('ready',flush=True); time.sleep(30)"
        wrapper = subprocess.Popen([str(WRAPPER), sys.executable, "-c", code], env=dict(self.env, CHILD_PID_FILE=str(pidfile)), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        child_pid = None
        try:
            deadline = time.monotonic() + 3
            while not pidfile.exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(pidfile.exists(), "real child did not become ready")
            child_pid = int(pidfile.read_text())
            self.assertEqual(wrapper.stdout.readline(), b"ready\n")
            wrapper.send_signal(signal.SIGTERM)
            time.sleep(0.05)
            self.assertIsNone(wrapper.poll(), "TERM-ignoring child must exercise escalation")
            start = time.monotonic()
            wrapper.kill()
            try:
                _stdout, stderr = wrapper.communicate(timeout=2)
                closed = True
            except subprocess.TimeoutExpired:
                closed, stderr = False, b""
            deadline = time.monotonic() + 1
            state = None
            while time.monotonic() < deadline:
                try:
                    state = Path(f"/proc/{child_pid}/stat").read_text().split(") ", 1)[1].split()[0]
                except FileNotFoundError:
                    state = None
                if state in (None, "Z"):
                    break
                time.sleep(0.01)
            self.assertIn(state, (None, "Z"), "real child remains running after observer KILL")
            self.assertTrue(closed, "inherited media pipes remained open after bounded cancellation")
            self.assertLess(time.monotonic() - start, 3)
            self.assertEqual(wrapper.returncode, -signal.SIGKILL)
            self.assertEqual(stderr, b"")
            # We adopted the child and prove actual SIGKILL termination, then reap it.
            waited, status = os.waitpid(child_pid, 0)
            self.assertEqual(waited, child_pid)
            self.assertTrue(os.WIFSIGNALED(status))
            self.assertEqual(os.WTERMSIG(status), signal.SIGKILL)
            child_pid = None
        finally:
            if wrapper.poll() is None:
                wrapper.kill()
            if child_pid is not None:
                try:
                    os.kill(child_pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                try:
                    os.waitpid(child_pid, 0)
                except ChildProcessError:
                    pass
            wrapper.communicate(timeout=3)
            libc.prctl(36, 0, 0, 0, 0)

if __name__ == "__main__":
    unittest.main()
