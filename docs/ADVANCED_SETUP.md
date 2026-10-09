# Extra setup and troubleshooting

For the first setup, follow the [server guide](SERVER_SETUP.md) and [desktop guide](../README.md#get-started).

## Cannot connect to the server

- Check that `npm start` is still running on the server computer.
- Make sure both computers can reach the same network, and that the server firewall allows the configured port (normally `8090`).
- On another computer, use the server's local IP address, not `127.0.0.1`.
- Set `HORIZON_HOST=0.0.0.0` in the server's `.env` for home-network access, then restart it.
- Copy the access token exactly from `HORIZON_TOKEN=` in `.env`. One token gives access to the whole library.

## Missing posters or a wrong title

Add your TMDB **API key (v3)** in Settings. Clear filenames with a title and year help automatic matching.

Open the title and choose **Identify title** or **Correct title match** if Horizon picks the wrong result. Existing downloaded information stays available if TMDB cannot be reached.

## Linux desktop help

Downloads are for Intel/AMD x64 computers. Linux desktop builds need **glibc 2.39 or newer**; Ubuntu 24.04 or newer meets that requirement. This desktop requirement does not apply to the separate server archive.

### Installing the Ubuntu package

The `.deb` download installs the required desktop libraries. Open it with your package installer. If you prefer a terminal, open one in the download folder and run:

```sh
sudo apt install ./Horizon-VERSION-linux-amd64.deb
```

Replace `VERSION` with the version in your downloaded filename. The real file is named like `Horizon-0.1.7-linux-amd64.deb`.

### Opening an AppImage

Right-click the file, open **Properties**, and allow it to run as a program. You can also do this in a terminal:

```sh
chmod +x Horizon-VERSION-linux-x86_64.AppImage
./Horizon-VERSION-linux-x86_64.AppImage
```

Replace `VERSION` with your downloaded version.

If Ubuntu 24.04 reports a missing FUSE library, install [libfuse2t64](https://packages.ubuntu.com/noble/libfuse2t64):

```sh
sudo apt install libfuse2t64
```

AppImage users may also need these host graphics and audio libraries:

```sh
sudo apt install libegl1 libgl1 libgbm1 libdrm2 libvulkan1 libva2 libva-x11-2 libva-wayland2 libasound2-data
```

Horizon uses X11 to keep playback inside the app. Wayland desktops need XWayland; install your distribution's `xwayland` package if it is missing. Graphics drivers and a working desktop sound system are also required.

## Sound, picture, and subtitles

Select your HDMI receiver as the operating system's default sound output. Original compressed audio over HDMI depends on the file, computer, driver, and receiver supporting that format. A **DD+** label describes the sound format; **Atmos** is shown only when the file's inspected audio profile confirms it.

The current release supports normal SDR video, including 4K. HDR10, Dolby Vision, automatic display-mode changes, Dolby headphone virtualization, and downloading subtitles are not available yet.

Embedded subtitles and separate subtitle files are supported. Keep separate subtitles beside the movie, with a matching name such as `Movie.2020.en.srt` alongside `Movie.2020.mkv`. Text subtitles can be restyled with **Aa**; picture-based subtitles keep their original lettering.

Keyboard controls: **Space** pauses, **← / →** skip ten seconds, **F** toggles fullscreen, and **Escape** closes a menu, leaves fullscreen, or goes back to the title.

## Running in the background

The [systemd service example](../deploy/horizon.service) starts the server automatically on Linux. It expects:

- Application files at `/opt/horizon` and a Linux service user named `horizon`.
- Configuration in `/etc/horizon.env`.
- `HORIZON_DATA_DIR=/var/lib/horizon`, writable by that service user.
- Read permission for the service user on your media folder.

The example blocks access to `/home`, so keep its media folder elsewhere. Adjust these paths and permissions before enabling the service.

## Internet access

Use a public HTTPS address with a reverse proxy that forwards requests to the server. The [Caddy example](../deploy/Caddyfile) provides a starting point: replace `media.example.com` with your domain and keep the server bound to `127.0.0.1` behind it.

Streaming needs Range and Authorization headers to pass through the proxy. Watch Together uses the same server connection and needs no extra ports.

For a room of friends, the server needs enough upload speed for a separate original-quality stream to every viewer.

## Media folders and local data

The server skips hidden files, hidden folders, and symbolic links. For large uploads, use a temporary `.part` filename and rename it to the final media filename after copying finishes. Clients refresh their library every 15 seconds.

For a network drive that misses file changes, set `HORIZON_WATCH_POLLING=true` in the server's `.env` and restart it. A full library check also runs every minute.

History and settings live on each desktop: usually `%APPDATA%/Horizon` on Windows and `~/.config/Horizon` on Linux, or its `$XDG_CONFIG_HOME` equivalent. Credentials use Windows DPAPI or a Linux keyring where available; Settings reports when a Linux keyring is unavailable.

Playback progress is saved every two seconds and again when playback stops or Horizon closes. Renaming a media file creates a new history entry. Keep the server's data directory when moving or updating it, so its library identity stays the same.

Watch Together rooms support twelve viewers. Restarting the server clears rooms; an empty room disappears. If a connection is lost, that viewer pauses while reconnecting. Everyone keeps their own history, audio, and subtitle choices.

[Back to Horizon](../README.md)
