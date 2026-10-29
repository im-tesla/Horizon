# Horizon

Watch your movies and TV shows in their original quality, from your own library. Horizon runs on Windows and Linux, with a Linux computer serving your files.

**[Download Horizon](https://github.com/im-tesla/Horizon/releases/latest)** · **[Set up your server](docs/SERVER_SETUP.md)** · **[Get help](https://github.com/im-tesla/Horizon/issues)**

![Horizon library with movie posters, cover artwork, and search](docs/images/library.png)

## What you can do

- Browse movies and shows with posters, descriptions, and episodes.
- Enjoy original-quality video, including 4K, and supported Dolby Atmos or surround sound over HDMI.
- Continue where you left off and keep track of what you have watched.
- Watch with friends: everyone can pause, play, and seek, while keeping their own audio and subtitles.
- Choose subtitles and adjust their font, size, outline, and shadow.
- Browse and control playback with a gamepad.
- Get app updates from GitHub Releases.

mpv is included with the app. Your files keep their original picture and sound quality, so your connection needs to be fast enough to play them.

## Get started

### 1. Download the app

Open the **[latest release](https://github.com/im-tesla/Horizon/releases/latest)** and choose your download:

| Your computer | Download | How to open it |
| --- | --- | --- |
| Windows | File ending in `windows-x64.exe` | Run the installer, then open Horizon. |
| Windows, without installing | File ending in `windows-x64-portable.exe` | Open the downloaded file. |
| Ubuntu | File ending in `linux-amd64.deb` | Open it with your package installer. |
| Linux, portable app | File ending in `.AppImage` | Allow the file to run as a program, then open it. |

Desktop downloads are for 64-bit Intel/AMD computers. Linux packages support Ubuntu 22.04 and newer; see [Linux help](docs/ADVANCED_SETUP.md#linux-desktop-help) for other systems and AppImage instructions.

### 2. Connect to your library

If a friend already runs a Horizon server, ask them for its address and access token. To host your own files, follow the **[server setup guide](docs/SERVER_SETUP.md)**.

Open **Settings** in Horizon:

| Setting | What to enter |
| --- | --- |
| Server address | The address your host gives you, such as `http://192.168.1.50:8090`. |
| Access token | The password for that server. |
| TMDB API key | Your TMDB key, used to look up posters and movie information. |

For a TMDB key, create an account at [TMDB](https://www.themoviedb.org/), open **Account settings → API**, and request an API key. Copy the **API key (v3)** into Horizon. [TMDB's instructions](https://developer.themoviedb.org/docs/getting-started) explain the steps.

Click **Save settings**, then open a movie or show.

### 3. Start watching

Move your mouse to show the player controls. Use the audio/subtitle button to choose tracks, or **Aa** to change how subtitles look.

For Dolby Atmos or surround sound over HDMI, select your receiver as your computer's sound output and adjust volume on the receiver. Your file, receiver, and computer must support the chosen sound format.

Using headphones and want to hear other apps too? Turn off **Settings → Audio → Exclusive audio**, then click **Save settings**. Keep it on for original HDMI bitstream sound. This choice is saved on your computer and does not affect friends in Watch Together.

To choose where Horizon plays sound, open **Settings → Audio → Output device**, select your receiver, speakers, or headphones, and click **Save settings**. **System default** follows your computer’s sound output. Use the refresh button after connecting another device.

Horizon saves your watched status and playback position on your own computer.

### Use a controller

Connect an Xbox, PlayStation, or other controller recognized with a standard layout, open Horizon, and press a button. Controls work in the library, episode picker, Settings, and player. Use your keyboard to enter text such as search terms or room codes.

| Button | Action |
| --- | --- |
| D-pad or left stick | Move between buttons; show player controls |
| A / Cross | Select the highlighted control |
| B / Circle | Close a menu or go back; exit fullscreen first |
| Menu / Options | Play or pause |
| LB / L1 and RB / R1 | Back or forward 10 seconds |
| Y / Triangle | Toggle fullscreen |
| Right stick | Scroll pages or long audio/subtitle lists |

The highlight appears when you use the controller and clears when you return to the mouse or keyboard. In Watch Together, playback buttons control the shared movie; going back keeps you in the room.

To change buttons, open **Settings → Controller**, choose your mapping, and click **Save settings**. Assigning an occupied button swaps the two actions. **Reset mapping** restores the defaults. Your mapping is saved on your computer. D-pad and stick navigation always stay available.

## Watch with friends

1. Everyone connects to the same Horizon server.
2. Open **Watch together**, enter your name, and choose **Create a room**.
3. Share the room code. Friends choose **Join room** and enter it.
4. Pick a movie or episode and click **Start together**.

Everyone can play, pause, and seek. Each person gets the original stream and chooses their own audio and subtitles. Rooms support up to 12 viewers.

## More previews

| Shows and episodes | Watch Together |
| --- | --- |
| ![TV series details with episode descriptions and watched status](docs/images/series.png) | ![Watch Together room with a searchable movie and series picker](docs/images/watch-together.png) |

## Updates and help

Installed Windows builds and Linux packages download updates and offer **Install & restart** in Settings. Portable Windows builds offer **Download update** so you can replace the file yourself. You can also click **Check for updates** at any time.

Server hosts can run **`npm run update`** in their existing server folder. Movies, settings, and the library cache stay in place. See [server updates](docs/SERVER_SETUP.md#updating-the-server) for the one-time upgrade from older versions.

- **Need to host your files?** [Server setup](docs/SERVER_SETUP.md)
- **Connection, Linux, or playback questions?** [Extra setup and troubleshooting](docs/ADVANCED_SETUP.md)
- **Want to contribute or build Horizon?** [Developer guide](docs/DEVELOPMENT.md)
- **Found a problem?** [Report it on GitHub](https://github.com/im-tesla/Horizon/issues)

Add your own movies and shows to the server. Video up to 4K is supported. HDR10 output requires a compatible Windows display connection with HDR enabled; native Dolby Vision output is not supported.

To ignore Dolby Vision metadata, turn on **Settings → Video → Force disable Dolby Vision**, then click **Save settings**. Videos with an HDR10 base layer can use it instead; HDR10+ metadata is retained. The setting applies during playback and is saved on your computer.

Movie information and artwork come from [TMDB](https://www.themoviedb.org/). This product uses the TMDB API but is not endorsed or certified by TMDB. Horizon is [MIT licensed](LICENSE); bundled software keeps its own [licenses](resources/THIRD_PARTY_NOTICES.md).
