#!/usr/bin/env bash
set -euo pipefail
sudo apt-get update
sudo apt-get install -y --no-install-recommends xvfb xauth ffmpeg libgl1-mesa-dri
package=$(find release -maxdepth 1 -name 'Horizon-*-linux-amd64.deb' -print -quit)
test -n "$package"
sudo apt-get install -y "./$package"
# Upgrades must restore the sandbox permissions, including a previously patched install.
sudo chmod 0755 /opt/Horizon/chrome-sandbox
sudo dpkg -i "$package"
xvfb-run -a -s '-screen 0 1440x960x24' node scripts/linux-package-smoke.mjs
