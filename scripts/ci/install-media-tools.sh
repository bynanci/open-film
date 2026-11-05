#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

# A slow Azure mirror delayed codec downloads for over ten minutes. Keep the
# runner image's suites, components and signing keys; use Ubuntu's HTTPS archive.
if [[ -f /etc/apt/apt-mirrors.txt ]]; then
  sudo sed -i -E \
    's#https?://azure[.]archive[.]ubuntu[.]com/ubuntu#https://archive.ubuntu.com/ubuntu#g' \
    /etc/apt/apt-mirrors.txt
fi

media_apt_options=(
  -o Acquire::Retries=2
  -o Acquire::http::Timeout=30
  -o Acquire::https::Timeout=30
  -o DPkg::Lock::Timeout=60
)
sudo apt-get "${media_apt_options[@]}" update
sudo apt-get "${media_apt_options[@]}" install -y --no-install-recommends \
  ffmpeg libimage-exiftool-perl fonts-noto-cjk
python -m pip install --timeout 30 --retries 2 --only-binary=:all: \
  opentimelineio==0.18.1
