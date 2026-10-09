# Third-party notices

Horizon source code is MIT licensed. The separately executed bundled player and
its dependencies retain their respective licenses.

mpv 0.41.0 is copyright the mpv/MPlayer/mplayer2 contributors, GPL version 2 or
later. Its license and pinned source archive are in the `mpv` resources directory.
Upstream: https://github.com/mpv-player/mpv. Horizon's native build and bundle
scripts are published alongside Horizon's source under `scripts/`.

The Windows runtime is the unmodified upstream x64 MinGW release. It includes
FFmpeg (GPL build), libass (ISC), dav1d (BSD), FreeType (FTL/GPL), FriBidi (LGPL),
HarfBuzz (MIT), libiconv (LGPL), Little CMS (MIT), libplacebo (LGPL), shaderc and
SPIRV-Cross (Apache 2.0), GCC runtime libraries (GPL with runtime exception),
Vulkan Loader (Apache 2.0), and zlib (zlib license). Upstream source and build
information: https://github.com/mpv-player/mpv/tree/v0.41.0/ci.

Linux runtime libraries come from the native build host; `runtime-packages.txt`
records their exact source packages and versions and `licenses/` contains their
distribution copyright and license notices. Sources are available from Ubuntu's
source archive: https://launchpad.net/ubuntu/+source/ (use the recorded package
and version). Linux retains the host's C runtime and graphics drivers.

Electron: MIT (https://github.com/electron/electron).
React: MIT (https://github.com/facebook/react).
Koffi native window bridge: MIT (https://koffi.dev/).
Lucide icons: ISC (https://lucide.dev/license).
Inter typography: SIL Open Font License 1.1; the full license accompanies the font
under `src/renderer/assets/Inter-LICENSE.txt` in Horizon's source archive.
The native Inter TrueType font is also bundled under `fonts/`, with its full
license in `fonts/OFL.txt`.
Noto Serif and Noto Sans Mono subtitle fonts: SIL Open Font License 1.1;
the full license accompanies the fonts in `fonts/Noto-OFL.txt`.
Sources: https://github.com/google/fonts/tree/main/ofl/notoserif and
https://github.com/google/fonts/tree/main/ofl/notosansmono.

Metadata and images come from TMDB (https://www.themoviedb.org/).
This product uses the TMDB API but is not endorsed or certified by TMDB.
