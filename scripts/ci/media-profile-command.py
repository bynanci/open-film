#!/usr/bin/python3
# SPDX-License-Identifier: Apache-2.0
"""Linux opt-in command observer; wait4 measures the real child, not Python."""
import ctypes
import json
import hashlib
import os
import signal
import subprocess
import sys
import time

if sys.argv[1:] == ["--observer-identity"]:
    print(json.dumps(dict(executable=sys.executable, realPath=os.path.realpath(sys.executable), version=sys.version)))
    sys.exit(0)

# Direct invocation is useful for tests; symlink names are used on the benchmark PATH.
name = os.path.basename(sys.argv[0])
if name in ("ffmpeg", "ffprobe"):
    command = os.environ["OPENFILM_PROFILE_REAL_" + name.upper()]
    args = sys.argv[1:]
else:
    command, *args = sys.argv[1:]
start_epoch = time.time_ns() / 1_000_000
start = time.monotonic_ns()
observer_pid = os.getpid()
libc = ctypes.CDLL(None, use_errno=True)


def own_child_until_exit():
    # This standalone observer is single-threaded. Arm Linux parent-death KILL
    # before exec and recheck the parent: death between fork and prctl must not
    # leave the command alive. The setting survives ordinary FFmpeg exec.
    if libc.prctl(1, signal.SIGKILL, 0, 0, 0) != 0:  # PR_SET_PDEATHSIG
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))
    if os.getppid() != observer_pid:
        os.kill(os.getpid(), signal.SIGKILL)


child = subprocess.Popen([command, *args], preexec_fn=own_child_until_exit)
# A pidfd targets this exact process even if a signal races with wait4/reaping;
# send_signal()/poll() would also risk consuming wait4's resource observation.
child_fd = os.pidfd_open(child.pid)


def forward_signal(received, _frame):
    try:
        signal.pidfd_send_signal(child_fd, received)
    except ProcessLookupError:
        pass


for sig in (signal.SIGTERM, signal.SIGINT):
    signal.signal(sig, forward_signal)
_, status, usage = os.wait4(child.pid, 0)
# Ignore late TERM/INT while recording a command that has already terminated.
for sig in (signal.SIGTERM, signal.SIGINT):
    signal.signal(sig, signal.SIG_IGN)
os.close(child_fd)
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
    if -code not in (signal.SIGKILL, signal.SIGSTOP):
        signal.signal(-code, signal.SIG_DFL)
    os.kill(os.getpid(), -code)
sys.exit(code)
