#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0

# Preserve the runner image's suites, components and signing keys. The optional
# sourced-function argument is for offline fixtures; the CLI always uses /etc.
ubuntu_apt_prepare() {
  if (( $# > 1 )) || [[ ${1-default} == '' ]]; then
    printf 'Expected at most one mirror fixture path\n' >&2
    return 2
  fi
  local mirrors_file=${1-/etc/apt/apt-mirrors.txt}
  if [[ -f "$mirrors_file" ]]; then
    sudo -n sed -i -E \
      's#https?://(azure|[A-Za-z0-9-]+[.]ec2)[.]archive[.]ubuntu[.]com/ubuntu#https://archive.ubuntu.com/ubuntu#g' \
      "$mirrors_file" || return
  fi
}

# Trusted callers retain their package/archive operands and existing install
# flags. Do not permit APT configuration flags to override this transport policy.
ubuntu_apt() {
  local mode=${1-} argument operands=0
  case "$mode" in
    update)
      if (( $# != 1 )); then
        printf 'APT update accepts no additional arguments\n' >&2
        return 2
      fi
      ;;
    install)
      for argument in "${@:2}"; do
        case "$argument" in
          -y|--no-install-recommends) ;;
          -*|'') printf 'Unsupported APT install argument\n' >&2; return 2 ;;
          *) operands=$((operands + 1)) ;;
        esac
      done
      if (( operands == 0 )); then
        printf 'APT install needs package or archive operands\n' >&2
        return 2
      fi
      ;;
    *) printf 'Expected ubuntu-apt.sh <update|install> [install arguments]\n' >&2; return 2 ;;
  esac
  shift
  local ubuntu_apt_options=(
    -o Acquire::Retries=2
    -o Acquire::http::Timeout=30
    -o Acquire::https::Timeout=30
    -o DPkg::Lock::Timeout=60
  )
  ubuntu_apt_prepare || return
  sudo -n apt-get "${ubuntu_apt_options[@]}" "$mode" "$@"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  set -euo pipefail
  ubuntu_apt "$@"
fi
