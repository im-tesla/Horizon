# Developing Horizon

This guide is for contributors and people building Horizon from source. To use the released app, start with the [README](../README.md) or [server setup](SERVER_SETUP.md).

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

Windows builds are unsigned unless you configure `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD` repository secrets with a signing certificate. These secrets are used only in CI. Horizon's MIT license does not replace the bundled mpv and dependency licenses; see [third-party notices](../resources/THIRD_PARTY_NOTICES.md).

## Verification

`npm test` checks byte-range parsing, original-byte streaming, token enforcement, HEAD responses, authenticated subtitle delivery, filename matching, fixed HDMI bitstream arguments, cropped resolution classes, Atmos profile detection, subtitle style validation, and Watch Together room authentication, shared controls, readiness, buffering, late joiners, membership limits, and expiration, and media-watcher add/rename/delete behavior.

With the local server running, `npm run test:desktop` runs the real Electron app with a temporary user-data directory and checks library browsing, full-page episodes and Settings, search, watched state, Settings action-bar geometry at normal/minimum window sizes, credential isolation, and persisted history. Run `npm run bundle:mpv` first and set `HORIZON_TEST_PLAYBACK=true` to additionally exercise streaming, seek, pause, and resume persistence with null audio/video outputs. Also set `HORIZON_VIDEO_TEST=true` to render actual GPU video. On Windows this verifies native parentage, enabled input, video bounds, and the absence of a visible top-level mpv window. It uses normal Windows mouse and keyboard input to check pause, seeking, fixed original-audio options, subtitle selection, fullscreen, Escape, control fading, mouse wake-up, and Back. It does not inject mouse commands into mpv or post messages directly to its window, which would bypass a disabled embedded window. Set `HORIZON_TEST_EXECUTABLE` to the unpacked application executable to check a release build with the same test. Screenshots, including the native player, are saved under the Git-ignored `.horizon/qa/` directory. A physical HDMI receiver is still needed to verify actual passthrough output.

`npm run test:together` starts an isolated local server and two real Electron clients with separate temporary profiles, then checks synchronized playback, a guest's native mouse pause on Windows, shared seek/resume, late rejoining, HDMI options, and each client's persisted history. It uses files from `media/`, GPU video, and silent test audio. Set `HORIZON_TEST_EXECUTABLE` to test the unpacked release build.
