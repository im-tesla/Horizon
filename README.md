# Horizon

An original-quality media streamer for a self-hosted Linux server and Windows/Linux desktops. The server sends the file's original bytes. It never transcodes video or audio.

Horizon uses Electron and React for the desktop library and bundled mpv for native playback inside the same application window. Playback always passes supported original compressed audio over HDMI to your receiver. There is no audio-mode selector, application volume adjustment, or playback-speed correction. Video fills the playback page, preserving mpv's hardware decoding and avoiding browser codec limits. Native overlay controls appear on mouse movement and fade after three seconds of inactivity, staying visible while paused or choosing tracks. Subtitles use bundled Inter typography with a fine outline and subtle shadow, and move above the controls when needed. Settings and title details are full pages. Artwork colors tint the app, and navigation, cards, and controls animate while respecting the system's reduced-motion preference.

## Included

- Token-protected HTTP streaming with byte ranges, seek requests, and HEAD support.
- Recursive media-folder watching, upload stabilization, periodic reconciliation, and cached ffprobe inspection.
- Automatic movie and series matching with TMDB posters, descriptions, and episode details, plus manual match correction.
- Local watched history with visible badges and series counts in the library and Watch Together picker, resume points, metadata cache, preferences, and OS-protected credentials where available.
- Compact original-file badges for resolution, video codec, and audio channels; Atmos appears when ffprobe confirms its audio profile.
- Native mpv playback, pause/seek controls, audio and subtitle selection, embedded/local subtitles, and adjustable subtitle styling.
- Watch Together rooms with shared controls for every viewer, scheduled playback, readiness/buffering coordination, and independent original streams.
- Windows installers and portable executables, Linux AppImage and Debian packages, bundled mpv, GitHub release workflows, and release-based client updates.

## Develop locally

Install Node.js 22.12 or newer and ffprobe (from FFmpeg). The desktop build prepares **mpv 0.41.0** automatically; a separate mpv installation is unnecessary. Windows uses the pinned upstream x64 runtime, including its DLLs. Linux builds mpv natively and bundles its runtime libraries.

On Ubuntu 24.04, install the native desktop build prerequisites once:

```sh
bash scripts/install-mpv-build-deps.sh
```

```sh
npm ci
npm run setup
npm run dev
```

`setup` creates a Git-ignored `.env` with a randomly generated access token. Put files in `media/`, or change `HORIZON_MEDIA_DIR` in `.env`. The development client reads `HORIZON_SERVER_URL`, `HORIZON_TOKEN`, `TMDB_API_KEY`, and `HORIZON_MPV_PATH` as local defaults. These defaults and your `.env` are never included in release packages. Each release client is configured through its Settings screen.

For individual processes:

```sh
npm run dev:server
npm run dev:ui
# In another terminal after building:
npm run start:desktop
```

`npm run dev` rebuilds the Electron main process at startup and starts the server and renderer. Renderer and server edits reload automatically; restart the command after changing Electron main/preload code.

## Run the Linux server

Install Node.js 22.12+ and ffprobe (`sudo apt install ffmpeg` on Ubuntu). Download `horizon-server-VERSION-linux-x64.tar.gz` from [GitHub Releases](https://github.com/im-tesla/Horizon/releases), then extract it:

```sh
tar -xzf horizon-server-VERSION-linux-x64.tar.gz
cd horizon-server-VERSION
npm run setup
# Edit .env with your media directory, token, host, port, and data directory.
npm start
```

The archive includes the compiled server and its production dependencies. It needs no compilation, npm installation, or containers. To run from a source checkout instead:

```sh
npm ci --ignore-scripts
npm run build:server
npm run setup
npm run start:server
```

Configure the token, media directory, data directory, host, and port in `.env`. `HORIZON_HOST=0.0.0.0` permits connections from other machines. [deploy/horizon.service](deploy/horizon.service) is a systemd example: install the project at `/opt/horizon`, create the `horizon` service user, put configuration in `/etc/horizon.env`, set `HORIZON_DATA_DIR=/var/lib/horizon`, and give the service read access to your media directory. With that example's `ProtectHome=true`, keep media outside `/home`.

Upload files into the media folder at any time. Changing or removing files updates the library automatically; clients refresh every 15 seconds. Hidden files, hidden folders, and symlinks are excluded. Set `HORIZON_WATCH_POLLING=true` for network filesystems with unreliable change events. A reconciliation scan also runs every minute. Prefer uploading to a `.part` filename and renaming to the final media extension when the upload is complete.

For LAN access, use the server's LAN address in the desktop client. For internet access, bind the server to localhost and place an HTTPS reverse proxy in front of it. [deploy/Caddyfile](deploy/Caddyfile) is an example; replace its domain with your own. The proxy must preserve Range and Authorization headers. The same access token grants access to the entire library.

ffprobe reads duration and track information. No ffmpeg transcoding command or transcoding endpoint exists. Insufficient network throughput causes buffering; it never reduces quality.

## Desktop use

1. Install the Windows `.exe`, run the Windows `-portable.exe`, use the Linux `.AppImage`, or install the `.deb`. Every package includes mpv and its runtime libraries. An AppImage may need `chmod +x` and your distribution's FUSE compatibility package. Linux keeps the host's graphics loaders/drivers and ALSA configuration; the Debian package declares those system dependencies. On Ubuntu, AppImage users can install them with `sudo apt install libegl1 libgl1 libgbm1 libdrm2 libvulkan1 libva2 libva-x11-2 libva-wayland2 libasound2-data` if needed.
2. In Settings, enter your server URL and token. Enter your own TMDB API key to fetch posters and descriptions.
3. Select your HDMI receiver as the operating system's default audio output. Horizon always enables original compressed audio bitstreaming; use the receiver to adjust volume.
4. Open a movie or show. Episodes are grouped by season; resume points and watched status belong to this desktop installation. Titles with no confident TMDB match retain their filename-derived titles. Use **Identify title** or **Correct title match** to fix a result. API failures retain any cached metadata and report an error.

Playback fills Horizon's entire content area, preserving the movie's aspect ratio. Native controls appear over the picture when the mouse moves and fade after three seconds of inactivity; they remain visible while paused, buffering, or selecting tracks. Soft gradients, a seek bar, ten-second jumps, audio/subtitle selection, and fullscreen follow a familiar streaming-player layout. Inter is bundled for controls and text subtitles, with a fine outline, subtle shadow, and balanced margins. Open **Subtitle appearance** (the Aa button beside the audio/subtitle selector) to change font, size, outline, shadow, weight, color, or a soft background box while watching. Modern (Inter), Serif (Noto Serif), and Mono (Noto Sans Mono) fonts are bundled on both platforms. Changes apply immediately to text subtitles and are saved locally, including during Watch Together. **Reset** restores the default style. Image-based subtitle tracks retain their embedded lettering. Subtitles move above the controls while they are visible and return lower when they disappear. Space pauses, arrow keys seek ten seconds, F toggles fullscreen, and Escape closes the track menu, leaves fullscreen, or returns to the title. **Back to title** saves your position. Tab exposes the matching keyboard/screen-reader controls. Use your receiver's volume control. A DD+ codec label indicates the encoded audio format; it does not claim that every DD+ file contains Atmos metadata. The connected OS, driver, HDMI device, and receiver must support the selected format. An optional mpv override must be version 0.41 or newer, with Lua scripting enabled.

Linux uses X11 for native child embedding. Wayland desktops run Horizon through XWayland; install your distribution's `xwayland` package if it is absent. Both Electron and mpv use this same display connection. Horizon never falls back to opening a separate player window.

The first version targets ordinary SDR playback, including 4K SDR. HDR10, Dolby Vision, automatic display-mode switching, Dolby headphone virtualization, and subtitle downloading are outside its current feature set. Embedded subtitles and sidecars are supported. Name sidecars after the exact media stem, for example `Movie.2020.en.srt` alongside `Movie.2020.mkv`.

History is flushed every two seconds during playback and again when playback stops or the app closes. Up to the last two seconds may be lost after a hard process crash or power loss. Media IDs derive from relative paths; renaming a media file creates a new ID. Server identity is persisted in its data directory, so keep that directory when moving the server.

Local client state lives in Electron's user-data folder (typically `%APPDATA%/Horizon` on Windows and `$XDG_CONFIG_HOME/Horizon` or `~/.config/Horizon` on Linux). Credentials use Windows DPAPI or the Linux desktop keyring when available. On Linux without a usable keyring, they are stored in the local file with restricted permissions and Settings reports that condition. Credentials are not exposed to the renderer or passed in mpv process arguments.

## Watch Together

Connect every desktop to the same Horizon server using its URL and existing access token. Open **Watch together**, enter a name, and choose **Create a room**. Share the eight-character room code; friends enter it under **Join room**. You can also create a room from a title's details page.

Choose from a searchable poster library with **All titles**, **Movies**, and **TV series** filters. Search uses both the matched and original titles, plus the year. Series occupy one card; open one to choose a season and episode. Posters load lazily and large libraries render in batches, with **Show more titles** to continue browsing. Selecting a card previews the choice; click **Start together** to begin for everyone. **Change selection** returns to the browser in the lobby.

Every participant can play, pause, and seek. All clients open their own original stream; the server only coordinates playback, so audio never travels through another viewer's device. Each person keeps their own audio track, subtitles, watched history, and resume positions. Supported compressed audio stays at normal speed for HDMI bitstreaming.

Playback starts after everyone has loaded the file. Joining an active movie or buffering pauses the room until everyone is ready. Pause and seek changes use a shared server clock; clients correct significant drift with exact seeks. The native player shows the room code and viewer count; click that badge to pause together and return to the full-page lobby. **Return to movie** opens the existing player. **Back to title**, **Leave room**, or closing the app leaves the room; remaining viewers can continue.

Rooms support twelve viewers and disappear when empty. Room membership and synchronization state live in server memory and expire after twenty seconds without contact; restarting the server clears rooms. Connection loss pauses the affected client while it reconnects; an expired session can be rejoined using the same code if others remain. The code is separate from the server access token. Watch Together uses the existing HTTP connection and reverse proxy; it requires no additional ports or containers. The server needs enough upload bandwidth for a separate original-quality stream to each viewer.

## Build and publish

```sh
npm test
npm run build
npm run package
```

`package` builds the current operating system's installers and executables into `release/`. Builds target **x64 Windows and Linux**. Linux desktop packages are built on Ubuntu 24.04 and require glibc 2.39 or newer, host graphics drivers, and a working desktop audio stack. The native server does not share this desktop OS baseline. The default update feed is `im-tesla/Horizon`, from the repository in `package.json`. Set `GITHUB_REPOSITORY=owner/repository` to build for a fork; GitHub Actions sets it automatically. Both the embedded update feed and portable download checks use that repository.

`npm run bundle:mpv` prepares the playback engine independently. The packager runs this automatically, verifies download SHA-256 checksums, validates every runtime file, and checks GPU and audio support. A missing or damaged engine fails packaging. Binaries, DLLs, shared libraries, mpv's license, source archive, and third-party notices are copied outside the application archive. The client uses this bundled engine. Developers can set `HORIZON_MPV_PATH` locally for an optional engine override. Native Linux build tools are needed only when developing or packaging, and no cross-platform build is attempted.

The public repository is [im-tesla/Horizon](https://github.com/im-tesla/Horizon). CI checks Windows and Ubuntu, packages the bundled player, and tests an extracted server archive independently of the source checkout. The release workflow runs when `package.json` changes on `main`; it compares versions and publishes one complete release only after Windows desktop, Linux desktop, and Ubuntu server builds succeed. It includes NSIS and portable executables, AppImage and Debian packages, update manifests, blockmaps, SHA-256 checksums, and the precompiled server archive. No personal GitHub token is needed in repository secrets: publishing uses the workflow's `GITHUB_TOKEN` with `contents: write` permission.

The initial push publishes the current package version. A manual run of **Release on version bump** retries an unpublished version. An interrupted draft is rebuilt from its original tagged commit, so its installers, source tag, and update manifests stay consistent. Before publishing, the release job verifies all required assets, versions, and update-manifest SHA-512 hashes.

For later releases:

```sh
npm version patch --no-git-tag-version
git add package.json package-lock.json
git commit -m "Release next version"
git push
```

Only stable `major.minor.patch` versions are supported by the release workflow. It creates the `vX.Y.Z` tag and release. Updating a version that already has a published tag will not overwrite it. If uploads fail, the release remains a draft until a retry succeeds.

The client checks GitHub Releases after startup and every six hours while idle. **Check for updates** in Settings triggers a manual check. Windows installers, Linux AppImage builds, and Debian installs download available updates and offer **Install & restart**. Installation waits for that action, saves playback progress, and leaves the Watch Together room before restarting; Debian updates may ask for administrator authentication. A downloaded update stays ready until installed. Portable Windows builds check for newer releases and offer **Download update** to replace the executable manually. Source development builds do not contact the update feed.

`npm run package:server` builds the server archive locally; `npm run test:server-release` extracts and tests it in a temporary directory. A server upgrade preserves `.env`, media, and the server data directory; stop the service, replace application files, and restart it.

Windows builds are unsigned unless you configure `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD` repository secrets with a signing certificate. These secrets are used only in CI. Horizon's MIT license does not replace the bundled mpv and dependency licenses; see [third-party notices](resources/THIRD_PARTY_NOTICES.md).

## Verification

`npm test` checks byte-range parsing, original-byte streaming, token enforcement, HEAD responses, authenticated subtitle delivery, filename matching, fixed HDMI bitstream arguments, cropped resolution classes, Atmos profile detection, subtitle style validation, and Watch Together room authentication, shared controls, readiness, buffering, late joiners, membership limits, and expiration, and media-watcher add/rename/delete behavior.

With the local server running, `npm run test:desktop` runs the real Electron app with a temporary user-data directory and checks library browsing, full-page episodes and Settings, search, watched state, Settings action-bar geometry at normal/minimum window sizes, credential isolation, and persisted history. Run `npm run bundle:mpv` first and set `HORIZON_TEST_PLAYBACK=true` to additionally exercise streaming, seek, pause, and resume persistence with null audio/video outputs. Also set `HORIZON_VIDEO_TEST=true` to render actual GPU video. On Windows this verifies native parentage, enabled input, video bounds, and the absence of a visible top-level mpv window. It uses normal Windows mouse and keyboard input to check pause, seeking, fixed original-audio options, subtitle selection, fullscreen, Escape, control fading, mouse wake-up, and Back. It does not inject mouse commands into mpv or post messages directly to its window, which would bypass a disabled embedded window. Set `HORIZON_TEST_EXECUTABLE` to the unpacked application executable to check a release build with the same test. Screenshots, including the native player, are saved under the Git-ignored `.horizon/qa/` directory. A physical HDMI receiver is still needed to verify actual passthrough output.

`npm run test:together` starts an isolated local server and two real Electron clients with separate temporary profiles, then checks synchronized playback, a guest's native mouse pause on Windows, shared seek/resume, late rejoining, HDMI options, and each client's persisted history. It uses files from `media/`, GPU video, and silent test audio. Set `HORIZON_TEST_EXECUTABLE` to test the unpacked release build.

## Credits

Metadata and images come from [TMDB](https://www.themoviedb.org/). This product uses the TMDB API but is not endorsed or certified by TMDB. Inter is provided under the [SIL Open Font License](src/renderer/assets/Inter-LICENSE.txt). [mpv](https://mpv.io/) supplies playback and subtitle rendering. UI icons are from [Lucide](https://lucide.dev/).
