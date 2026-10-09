#!/usr/bin/env bash
set -euo pipefail
# Native Linux build dependencies. End users receive mpv inside the desktop package.
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  build-essential meson ninja-build pkg-config python3 \
  libavcodec-dev libavformat-dev libavfilter-dev libavutil-dev \
  libswresample-dev libswscale-dev libass-dev libplacebo-dev \
  libasound2-dev libpulse-dev liblua5.2-dev libasound2-plugins \
  libx11-dev libxext-dev libxrandr-dev libxss-dev libxpresent-dev \
  libwayland-dev wayland-protocols libxkbcommon-dev libdrm-dev \
  libegl-dev libgl-dev libvulkan-dev libva-dev
