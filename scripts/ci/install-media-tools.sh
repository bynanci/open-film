#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

ci_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
bash "$ci_directory/ubuntu-apt.sh" update
bash "$ci_directory/ubuntu-apt.sh" install -y --no-install-recommends \
  ffmpeg libimage-exiftool-perl fonts-noto-cjk
python -m pip install --timeout 30 --retries 2 --only-binary=:all: \
  opentimelineio==0.18.1
