#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

repository=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf -- "$test_root"' EXIT
export APT_TEST_ROOT="$test_root"
export APT_TEST_LOG="$test_root/commands.log"
export APT_TEST_FAIL_MODE=''
mkdir "$test_root/bin"
touch "$APT_TEST_LOG"
real_mirror_before=absent
if [[ -f /etc/apt/apt-mirrors.txt ]]; then
  real_mirror_before=$(sha256sum /etc/apt/apt-mirrors.txt)
fi

# Only these command boundaries are replaced. No test calls real sudo, APT,
# rustup or pip; fixture sed still exercises the production substitution.
cat > "$test_root/bin/sudo" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
{ printf 'sudo'; printf ' <%s>' "$@"; printf '\n'; } >> "$APT_TEST_LOG"
if [[ ${1-} == -n ]]; then shift; fi
case ${1-} in
  apt-get) exec "$@" ;;
  sed)
    if [[ ${APT_TEST_FAIL_MODE-} == prepare ]]; then exit 75; fi
    destination=${!#}
    case "$destination" in
      "$APT_TEST_ROOT"/*) exec "$@" ;;
      /etc/apt/apt-mirrors.txt) exit 0 ;;
      *) printf 'Refusing nonfixture sed destination\n' >&2; exit 96 ;;
    esac
    ;;
  *) printf 'Unexpected privileged command\n' >&2; exit 96 ;;
esac
SH
cat > "$test_root/bin/apt-get" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
expected=(-o Acquire::Retries=2 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 -o DPkg::Lock::Timeout=60)
for argument in "${expected[@]}"; do
  if [[ ${1-} != "$argument" ]]; then
    printf 'Missing existing bounded APT transport policy\n' >&2
    exit 97
  fi
  shift
done
{ printf 'apt'; printf ' <%s>' "$@"; printf '\n'; } >> "$APT_TEST_LOG"
case ${1-} in
  update) [[ ${APT_TEST_FAIL_MODE-} != update ]] || exit 73 ;;
  install) [[ ${APT_TEST_FAIL_MODE-} != install ]] || exit 74 ;;
  *) exit 98 ;;
esac
SH
for command in rustup python; do
  cat > "$test_root/bin/$command" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
{ printf '%s' "${0##*/}"; printf ' <%s>' "$@"; printf '\n'; } >> "$APT_TEST_LOG"
SH
done
chmod +x "$test_root/bin/"*
export PATH="$test_root/bin:$PATH"
cd "$repository"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
checks=0
pass() { checks=$((checks + 1)); printf 'ok %s - %s\n' "$checks" "$*"; }
clear_log() { : > "$APT_TEST_LOG"; }
has_log() {
  local line
  while IFS= read -r line; do
    if [[ $line == "$1" ]]; then return 0; fi
  done < "$APT_TEST_LOG"
  fail "missing command: $1"
}
no_log() {
  local line
  while IFS= read -r line; do
    if [[ $line =~ $1 ]]; then fail "unexpected command: $1"; fi
  done < "$APT_TEST_LOG"
}
expect_status() {
  local expected_status=$1 actual_status
  shift
  if "$@" > "$test_root/stdout" 2> "$test_root/stderr"; then
    actual_status=0
  else
    actual_status=$?
  fi
  if [[ $actual_status != "$expected_status" ]]; then
    cat "$test_root/stderr" >&2
    fail "expected status $expected_status, got $actual_status"
  fi
}

# Execute the actual native workflow block: its old raw apt-get update is the
# regression this test first rejects, before the shared policy is wired in.
python3 - "$test_root" <<'PY'
from pathlib import Path
import sys

root = Path(sys.argv[1])
for workflow, step, destination in [
    ('.github/workflows/ci.yml', 'Install Tauri Linux dependencies', 'native.sh'),
    ('.github/workflows/native-installer.yml', 'Linux native prerequisites', 'installer.sh'),
    ('.github/workflows/native-security.yml', 'Install actual native development prerequisites', 'security.sh'),
]:
    lines = Path(workflow).read_text().splitlines()
    start = lines.index(f'      - name: {step}')
    run = next(i for i in range(start + 1, len(lines)) if lines[i] == '        run: |')
    body = []
    for line in lines[run + 1:]:
        if not line.startswith('          '):
            break
        body.append(line[10:])
    assert body, f'Missing actual workflow run block: {step}'
    (root / destination).write_text('\n'.join(body) + '\n')
PY
expect_status 0 bash -euo pipefail "$test_root/native.sh"
has_log 'apt <update>'
tauri_install='apt <install> <-y> <libwebkit2gtk-4.1-dev> <libgtk-3-dev> <libayatana-appindicator3-dev> <librsvg2-dev> <patchelf>'
has_log "$tauri_install"
has_log 'rustup <toolchain> <install> <1.99.0> <--profile> <minimal> <--component> <rustfmt> <--component> <clippy>'
no_log '^sudo <apt-get>'
pass 'actual native bootstrap retains packages/Rust and applies bounded noninteractive APT'

for mode in update install; do
  clear_log
  export APT_TEST_FAIL_MODE="$mode"
  expected_status=73
  if [[ $mode == install ]]; then expected_status=74; fi
  expect_status "$expected_status" bash -euo pipefail "$test_root/native.sh"
  no_log '^rustup'
  if [[ $mode == update ]]; then no_log '^apt <install>'; fi
  pass "native $mode failure stops later bootstrap commands"
done
export APT_TEST_FAIL_MODE=''

helper="$repository/scripts/ci/ubuntu-apt.sh"
clear_log
expect_status 0 bash -euo pipefail -c 'source "$1"' _ "$helper"
[[ ! -s "$APT_TEST_LOG" ]] || fail 'sourcing performed privileged work'
pass 'sourcing the helper has no privileged side effects'

cat > "$test_root/mirrors.txt" <<'TEXT'
http://azure.archive.ubuntu.com/ubuntu
https://azure.archive.ubuntu.com/ubuntu
https://security.ubuntu.com/ubuntu
https://example.invalid/ubuntu
Suites: noble noble-updates noble-backports noble-security
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
TEXT
cat > "$test_root/expected-mirrors.txt" <<'TEXT'
https://archive.ubuntu.com/ubuntu
https://archive.ubuntu.com/ubuntu
https://security.ubuntu.com/ubuntu
https://example.invalid/ubuntu
Suites: noble noble-updates noble-backports noble-security
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
TEXT
expect_status 0 bash -euo pipefail -c 'source "$1"; ubuntu_apt_prepare "$2"; ubuntu_apt_prepare "$2"' _ "$helper" "$test_root/mirrors.txt"
cmp "$test_root/expected-mirrors.txt" "$test_root/mirrors.txt"
has_log "sudo <-n> <sed> <-i> <-E> <s#https?://azure[.]archive[.]ubuntu[.]com/ubuntu#https://archive.ubuntu.com/ubuntu#g> <$test_root/mirrors.txt>"
pass 'mirror substitution is idempotent and preserves other mirrors/suites/components/signing metadata'

clear_log
expect_status 0 bash -euo pipefail -c 'source "$1"; ubuntu_apt_prepare "$2"' _ "$helper" "$test_root/absent.txt"
[[ ! -s "$APT_TEST_LOG" ]] || fail 'missing mirror fixture triggered a command'
pass 'missing mirror file needs no privileged work'

for mode in '' remove --mirrors-file; do
  clear_log
  expect_status 2 bash "$helper" "$mode"
  [[ ! -s "$APT_TEST_LOG" ]] || fail 'invalid mode triggered privileged work'
done
clear_log
expect_status 2 bash "$helper" update "$test_root/mirrors.txt"
[[ ! -s "$APT_TEST_LOG" ]] || fail 'update accepted a path/configuration override'
pass 'unsupported modes and update overrides fail before privileged work'

for flag in -o --option=Acquire::Retries=99 -c --config-file=unreviewed --allow-unauthenticated --mirrors-file; do
  clear_log
  expect_status 2 bash "$helper" install -y "$flag" ffmpeg
  [[ ! -s "$APT_TEST_LOG" ]] || fail 'install accepted an unreviewed configuration flag'
done
for mode in update install; do
  clear_log
  if [[ $mode == update ]]; then
    expect_status 2 bash "$helper"
  else
    expect_status 2 bash "$helper" install -y --no-install-recommends
  fi
  [[ ! -s "$APT_TEST_LOG" ]] || fail 'missing mode/operands triggered privileged work'
done
pass 'install configuration flags and missing operands fail before privileged work'

clear_log
export APT_TEST_FAIL_MODE=prepare
expect_status 75 bash -euo pipefail -c 'source "$1"; ubuntu_apt_prepare "$2"; ubuntu_apt update' _ "$helper" "$test_root/mirrors.txt"
no_log '^apt'
export APT_TEST_FAIL_MODE=''
pass 'actual preparation propagates a failed sed command'

clear_log
expect_status 75 bash -euo pipefail -c 'source "$1"; ubuntu_apt_prepare() { return 75; }; if ubuntu_apt update; then exit 99; else exit $?; fi' _ "$helper"
[[ ! -s "$APT_TEST_LOG" ]] || fail 'preparation failure reached APT'
pass 'preparation failure propagates even when caller conditional disables errexit'

clear_log
expect_status 0 bash "$helper" install -y "$test_root/reviewed inputs/ffmpeg.deb"
has_log "apt <install> <-y> <$test_root/reviewed inputs/ffmpeg.deb>"
pass 'an admitted archive path with spaces remains one operand'

clear_log
expect_status 0 bash scripts/ci/install-media-tools.sh
has_log 'apt <update>'
has_log 'apt <install> <-y> <--no-install-recommends> <ffmpeg> <libimage-exiftool-perl> <fonts-noto-cjk>'
has_log 'python <-m> <pip> <install> <--timeout> <30> <--retries> <2> <--only-binary=:all:> <opentimelineio==0.18.1>'
pass 'media consumer preserves exact packages and PIP policy'

for mode in update install; do
  clear_log
  export APT_TEST_FAIL_MODE="$mode"
  expected_status=73
  if [[ $mode == install ]]; then expected_status=74; fi
  expect_status "$expected_status" bash scripts/ci/install-media-tools.sh
  no_log '^python'
  if [[ $mode == update ]]; then no_log '^apt <install>'; fi
  pass "media $mode failure stops package/PIP successors"
done
export APT_TEST_FAIL_MODE=''

clear_log
expect_status 0 bash -euo pipefail "$test_root/installer.sh"
has_log 'apt <update>'
has_log "$tauri_install"
pass 'manual Linux installer preserves the same Tauri package operands'

clear_log
expect_status 0 bash -euo pipefail "$test_root/security.sh"
has_log 'apt <update>'
has_log 'apt <install> <-y> <libwebkit2gtk-4.1-dev> <libgtk-3-dev> <libayatana-appindicator3-dev> <librsvg2-dev> <patchelf> <gdb>'
pass 'native security prerequisites retain their additional gdb package'

python3 - <<'PY'
from pathlib import Path
source = Path('.github/workflows/ci.yml').read_text()
fast = source.split('  fast-contract-check:\n', 1)[1].split('  heavy-media-qa:\n', 1)[0]
assert '      - run: bash scripts/ci/test-ubuntu-apt.sh\n' in fast
assert '\n        if:' not in fast
native = source.split('  native-shell:\n', 1)[1]
assert '    timeout-minutes: 30\n' in native
bootstrap = native.split('      - name: Install Tauri Linux dependencies\n', 1)[1].split('      - run: pnpm install', 1)[0]
assert '        timeout-minutes: 8\n' in bootstrap
assert 'continue-on-error' not in fast + native
for path, step, budget in [
    ('.github/workflows/native-installer.yml', 'Linux native prerequisites', 45),
    ('.github/workflows/native-security.yml', 'Install actual native development prerequisites', 60),
]:
    consumer = Path(path).read_text()
    assert f'    timeout-minutes: {budget}\n' in consumer
    prerequisites = consumer.split(f'      - name: {step}\n', 1)[1].split('      - ', 1)[0]
    assert '        timeout-minutes: 8\n' in prerequisites
PY
pass 'Ubuntu fast lane requires offline controls; bootstrap is 8m within the unchanged 30m job'

real_mirror_after=absent
if [[ -f /etc/apt/apt-mirrors.txt ]]; then
  real_mirror_after=$(sha256sum /etc/apt/apt-mirrors.txt)
fi
[[ $real_mirror_before == "$real_mirror_after" ]] || fail 'real mirror file changed'
pass 'real mirror file is unchanged; no APT/root/network work was performed'
printf 'Ubuntu APT offline controls: %s passed.\n' "$checks"
