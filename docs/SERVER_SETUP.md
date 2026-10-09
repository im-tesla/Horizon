# Set up your Horizon server

The server is the Linux computer that stores and shares your movies. Keep it running while you or your friends watch. Ubuntu is a good place to start.

If someone else already hosts your library, you only need their server address and access token. Follow [Connect to your library](../README.md#2-connect-to-your-library).

## 1. Install two requirements

Install **Node.js 22.12 or newer**, including npm, using the [Node.js download page](https://nodejs.org/en/download). You can check the installed version in a terminal:

```sh
node --version
npm --version
```

Install FFmpeg on Ubuntu. Horizon uses its file-information tool to read details about your movies:

```sh
sudo apt update
sudo apt install ffmpeg
```

The server sends your files in their original quality.

## 2. Download and unpack the server

On the Linux computer, open [Horizon Releases](https://github.com/im-tesla/Horizon/releases/latest) and download the file named like **`horizon-server-…-linux-x64.tar.gz`**.

Right-click the download and choose **Extract here**. Open the extracted folder (its name starts with `horizon-server`), then open a terminal in that folder.

The download is already built and includes its dependencies. Keep this as your permanent server folder; future updates happen inside it. You can rename the folder to `horizon-server` if you prefer.

## 3. Choose your media folder

Run:

```sh
npm run setup
nano .env
```

The first command creates a settings file named `.env` and a random access token. The second opens that file.

Change these lines to match your setup:

```dotenv
HORIZON_MEDIA_DIR=/path/to/your/movies
HORIZON_HOST=0.0.0.0
HORIZON_PORT=8090
```

- **Media folder:** replace `/path/to/your/movies` with the full path to the folder containing your movies and shows. For a path with spaces, put it in quotes.
- **Host:** `0.0.0.0` lets other devices on your network connect.
- **Port:** keep `8090` unless another app is already using it.
- **Access token:** keep the generated value on the `HORIZON_TOKEN=` line. It is the password you will enter in the desktop app.

In nano, press **Ctrl+O**, then **Enter** to save, and **Ctrl+X** to exit.

## 4. Start the server

In the same folder, run:

```sh
npm start
```

Leave this terminal open while watching. **Ctrl+C** stops the server. Run `npm start` again to start it later. If you change `.env`, stop and restart the server.

For automatic startup when the computer boots, see [Running in the background](ADVANCED_SETUP.md#running-in-the-background).

## 5. Connect the desktop app

Find the server computer's local IP address in Ubuntu's network settings, or run:

```sh
hostname -I
```

If its local address is `192.168.1.50`, enter **`http://192.168.1.50:8090`** as the **Server address** in Horizon.

If Horizon runs on the same computer as the server, use **`http://127.0.0.1:8090`**.

For **Access token**, copy the value after `HORIZON_TOKEN=` in your `.env` file. Click **Save settings**. See the [desktop setup](../README.md#2-connect-to-your-library) to add posters and descriptions.

Share the address and token with friends who should have access to your library.

## Add movies and shows

Copy files into your media folder. You can add more at any time; Horizon finds them automatically.

Clear filenames help Horizon find the right title:

```text
Movie Title (2020).mkv
Show Name S01E01.mkv
Show Name S01E02.mkv
```

Subfolders are supported. Keep subtitle files alongside their movie, with the same name, such as `Movie.2020.mkv` and `Movie.2020.en.srt`.

## Watching over the internet

The local IP address above works on your home network. To connect from elsewhere, set up a public HTTPS address for your server. See [Internet access](ADVANCED_SETUP.md#internet-access).

Each viewer receives their own full-quality stream. Your server's upload connection needs enough speed for everyone watching.

## Updating the server

Open another terminal in your existing server folder and run:

```sh
npm run update
```

Horizon downloads the latest server from GitHub, checks it, and briefly restarts your running server. If the server is stopped, run `npm start` afterward. Updating restarts Watch Together rooms, so finish your movie night first.

**Your media folder, `.env`, access token, and library cache stay where they are.** This also works when your movies are inside the server folder. Application versions are kept separately under `.horizon/releases`; you do not need to extract another download or move your movies.

To check without installing, run `npm run update:check`. To go back to the previous version, run `npm run rollback`. If a new version cannot start, Horizon restores the running version automatically.

### Already using version 0.1.8 or earlier?

Do this once to add the update command to your current folder:

1. Stop your old server with **Ctrl+C**.
2. Open a terminal in that same server folder and run:

```sh
curl -fL https://github.com/im-tesla/Horizon/releases/latest/download/horizon-server.mjs -o horizon-server.mjs
node horizon-server.mjs update
npm start
```

Your existing media and settings stay in that folder. From then on, use `npm run update` for future releases. If you run Horizon as a systemd service, update its startup command as described in [Running in the background](ADVANCED_SETUP.md#running-in-the-background).

[Back to Horizon](../README.md)
