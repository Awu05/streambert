# Streambert in a browser

The web image serves the Streambert app on port 8080. Sign in from a PC, phone, or TV. Devices share one library, watch history, and download queue, and can play different videos at the same time.

## Start

Set `STREAMBERT_PASSWORD` in your shell or your Docker Compose environment, then run this from the repository root.

```sh
docker compose -f docker-compose.web.yml up -d --build
```

Open `http://<server-ip>:8080`, sign in, and enter your TMDB read access token if prompted. For access away from home, use Tailscale or a reverse proxy with HTTPS. Keep port 8080 off the public internet.

| Setting | Default | Use |
|---|---|---|
| `STREAMBERT_PASSWORD` | Required | Shared login password. |
| `STREAMBERT_MAX_HIDDEN_PAGES` | `2` | Number of provider pages used to find streams at once. New requests wait when all slots are in use. Resolved streams play independently of the limit. |
| `PUID` and `PGID` | `1000` | User and group for the config and downloads mounts. |
| `TZ` | `Etc/UTC` | Server time zone. |
| Port | `8080` | Change the published port in Compose if needed. |
| `./config` | `/config` | Server profile, credentials, and application data. |
| `./downloads` | `/config/Downloads` | Downloads. The bundled downloader lives at `/opt/vid-dl`. |

## Playback

The initial browser sources are VidFast and Aether for movies and TV, VidNest for TV, and HiAnime for anime. In the player, **Options → Source** shows which sources work for the current title. On a TV, enable TV remote mode in Settings to navigate the app with a remote. In the player, OK plays and pauses, Left and Right skip 10 seconds, Up moves to the player controls, and Back steps out of the controls, then closes the player.

In the player, open **Options → Open in another app** to launch a supported app or copy a link. Links expire after six hours. Streambert tracks resume and watch progress during in-browser playback. [Infuse links](https://support.firecore.com/hc/en-us/articles/215090997-API-for-Third-Party-Apps-Services) · [Android browser intents](https://developer.chrome.com/docs/android/intents)

## Move from the Selkies image

In the desktop app, open **Settings → Backup & Restore** and export your data before switching. Stop the Selkies container, start the web image with the same config and downloads mounts, and import the backup in the browser app. The mounts carry over saved credentials and the download registry. The backup carries library and watch history.

## Build for another architecture

The Dockerfile targets `linux/amd64` and `linux/arm64`. A Raspberry Pi 4 or 5 requires a 64-bit OS. A system with at least 4 GB of RAM is recommended. Use the default two resolver slots on a Pi. Update by rebuilding the image.

The ARM64 smoke test on Docker Desktop used QEMU with `--no-zygote` passed as a container argument. Login, shared progress, HiAnime playback and seeking, and playback of a generated MP4 passed. VidFast and Aether stream discovery timed out under emulation. Native Raspberry Pi hardware remains untested. [QEMU Chromium startup discussion](https://lists.nongnu.org/archive/html/qemu-devel/2021-04/msg05450.html)
