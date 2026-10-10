#!/usr/bin/env bash
set -euo pipefail
# Build on Ubuntu 22.04 so every bundled library supports glibc 2.35.
# New FFmpeg/libplacebo are built from pinned sources, not newer Ubuntu packages.
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  build-essential binutils ninja-build pkg-config python3 python3-venv nasm \
  libass-dev libgnutls28-dev libdav1d-dev liblcms2-dev \
  zlib1g-dev libbz2-dev liblzma-dev \
  libasound2-dev libpulse-dev liblua5.2-dev libasound2-plugins \
  libx11-dev libxext-dev libxrandr-dev libxss-dev libxpresent-dev \
  libwayland-dev wayland-protocols libxkbcommon-dev libdrm-dev \
  libegl-dev libgl-dev libvulkan-dev libva-dev

python3 -m venv .horizon/mpv-tools
.horizon/mpv-tools/bin/pip install --disable-pip-version-check meson==1.7.2
if [ -n "${GITHUB_PATH:-}" ]; then
  realpath .horizon/mpv-tools/bin >> "$GITHUB_PATH"
fi
