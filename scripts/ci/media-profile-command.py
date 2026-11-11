#!/usr/bin/python3
# SPDX-License-Identifier: Apache-2.0
"""Linux opt-in command observer; wait4 measures the real child, not Python."""
import json
import hashlib
import os
import signal
import subprocess
import sys
import time

# Direct invocation is useful for tests; symlink names are used on the benchmark PATH.
name = os.path.basename(sys.argv[0])
if name in ("ffmpeg", "ffprobe"):
    command = os.environ["OPENFILM_PROFILE_REAL_" + name.upper()]
    args = sys.argv[1:]
else:
    command, *args = sys.argv[1:]
start_epoch = time.time_ns() / 1_000_000
start = time.monotonic_ns()
child = subprocess.Popen([command, *args])
# Preserve process cancellation, including a product signal sent to the wrapper PID.
for sig in (signal.SIGTERM, signal.SIGINT):
    signal.signal(sig, lambda received, _frame: child.send_signal(received))
_, status, usage = os.wait4(child.pid, 0)
code = os.waitstatus_to_exitcode(status)
child.returncode = code
record = dict(command=command, args=args, pid=child.pid, parentPid=os.getpid(),
              startedAt=start_epoch, endedAt=time.time_ns() / 1_000_000,
              wallMs=(time.monotonic_ns() - start) / 1_000_000,
              userCpuMs=usage.ru_utime * 1000, systemCpuMs=usage.ru_stime * 1000,
              peakRssKiB=usage.ru_maxrss, exitCode=code)
# Keep exact synthetic source identities; this extra observer hash is outside command wall/CPU.
if code == 0 and "lavfi" in args and "-frames:v" in args and args[-1].endswith(".jpg"):
    hash_start = time.monotonic_ns()
    with open(args[-1], "rb") as source:
        data = source.read()
    record["syntheticSource"] = dict(sha256=hashlib.sha256(data).hexdigest(), bytes=len(data),
                                    observerHashWallMs=(time.monotonic_ns() - hash_start) / 1_000_000)
fd = os.open(os.environ["OPENFILM_PROFILE_COMMANDS"], os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
os.write(fd, (json.dumps(record) + "\n").encode())
os.close(fd)
if code < 0:
    signal.signal(-code, signal.SIG_DFL)
    os.kill(os.getpid(), -code)
sys.exit(code)
