# Streambert in Docker

The image runs Streambert as a web app on port 8080. Sign in from a PC, phone, or TV browser. Household members can keep separate libraries and watch histories and play different videos at the same time.

Images are published to `ghcr.io/awu05/streambert` for `linux/amd64` and `linux/arm64` whenever a release is tagged.

## Start

From the repository root, copy the example settings and set a password:

```sh
cp .env.example .env
# edit .env and set STREAMBERT_PASSWORD
docker compose pull      # use the published image
docker compose up -d     # (or `docker compose up -d --build` to build from source)
```

Open `http://<server-ip>:8080`, sign in, and enter your TMDB read access token if prompted. For access away from home, use Tailscale or a reverse proxy with HTTPS. Keep port 8080 off the public internet.

Docker Compose reads `.env` automatically. It is ignored by git, so the password stays on your machine.

## Settings

Set these in `.env`, then run `docker compose up -d` to apply them.

| Setting | Default | Use |
| --- | --- | --- |
| `STREAMBERT_PASSWORD` | Required | Shared login password. Changing it signs every device out. |
| `STREAMBERT_WEB_PORT` | `8080` | Port on the host. |
| `STREAMBERT_MAX_HIDDEN_PAGES` | `2` | Provider pages used at once to find streams. New requests wait when all are in use. Resolved streams play independently of the limit. |
| `STREAMBERT_LOW_RAM` | `1` | Limits memory use, including at most 3 Chromium renderer processes. Set `0` when `STREAMBERT_MAX_HIDDEN_PAGES` is above 2. |
| `STREAMBERT_RESET_MAIN_PIN` | `0` | Set to `1` for one startup to clear a forgotten main profile PIN. |
| `PUID` and `PGID` | `1000` | User and group that own `./config` and `./downloads`. |
| `TZ` | `Etc/UTC` | Server time zone. |

| Folder on the host | In the container | Contents |
| --- | --- | --- |
| `./config` | `/config` | Profiles, libraries, watch history, credentials, and application data. |
| `./downloads` | `/config/Downloads` | Downloads. The download folder is set by the server; the bundled downloader is at `/opt/vid-dl`. |

## Profiles

After signing in, select a profile on **Who's watching?**. The browser remembers your choice until you choose **Switch profile**. Each profile has its own history, Continue Watching, library, and preferences. On upgrade, the existing data belongs to **Main**.

Use **My PIN** in the profile menu to set, change, or remove your four-digit PIN. Main manages profiles and household settings, including sources and download clean-up. Main can remove a forgotten PIN from another profile in **Manage profiles**. To reset the main PIN, set `STREAMBERT_RESET_MAIN_PIN=1` and restart the service with `docker compose up -d`. Remove the setting and run `docker compose up -d` again so later startups retain any new PIN.

Main chooses a rating limit and country for each Kids profile. The browser applies the rating filter. Kids profiles have access to their own viewing data and preferences. Downloads and household settings are restricted.

Adults see the downloads they started. Main can view and filter all downloads by owner and bulk-delete selected items. Existing downloads belong to Main. Automatic clean-up runs on startup and hourly, deleting watched downloads after seven days by default. Main can change the delay or set a space limit in **Settings → Downloads**.
## Playback

The browser sources are VidFast and Aether for movies and TV, VidNest for TV, and HiAnime for anime. In the player, **Options → Source** shows which sources work for the current title.

- **Phones:** the app switches to a phone layout with a bottom tab bar. iPhones need iOS 17.1 or later for the best playback. If the browser blocks autoplay with sound, the video starts muted with a **Tap to unmute** button.
- **Subtitles:** HiAnime subtitles and the subtitles of downloads start on. Change them in **Options → Subtitles**, or search for more in **Options → Find subtitles** (needs a Wyzie key in Settings).
- **TVs:** turn on TV remote mode in **Settings**. In the player, OK plays and pauses, Left and Right skip 10 seconds, Up moves to the player controls, and Back steps out of the controls, then closes the player.
- **Other apps:** **Options → Open in another app** launches VLC, Infuse, or the Android app chooser, or copies a link. Links expire after six hours, and progress isn't tracked there. [Infuse links](https://support.firecore.com/hc/en-us/articles/215090997-API-for-Third-Party-Apps-Services) · [Android browser intents](https://developer.chrome.com/docs/android/intents)
- **Downloads:** downloaded files play in the browser from the Downloads page. Files the downloader saved as MPEG-TS are repackaged to MP4 (no re-encoding) the first time they're played, which takes a few seconds.

## Coming from the remote-desktop image

Earlier versions of this image streamed the desktop app with Selkies on port 3001. To move over, open **Settings → Backup & Restore** in the old image and export your data. Stop the old container, start this one with the same `./config` and `./downloads` folders, and import the backup in the browser. The folders carry over saved credentials and the download registry. The backup carries library and watch history.

## Releases and building

Pushing a tag (or publishing a GitHub release with a new tag) runs `.github/workflows/docker.yml`, which builds both architectures and pushes them to the GitHub Container Registry. A tag like `2.8.0` produces the image tags `2.8.0`, `2.8`, and `latest`. The workflow can also be started by hand from the Actions tab; that builds an image tagged with the branch name.

To build for the machine you're on, `docker compose up -d --build` is enough. To build both architectures and push them to another registry yourself:

```sh
docker buildx build --platform linux/amd64,linux/arm64 -t <registry>/streambert:latest --push .
```

The Electron app is packaged on the build machine's own architecture, so that step is fast. `vid-dl` is built from source for the target architecture; on a cross-build that step runs under QEMU and takes a few extra minutes. It's built from its latest release, and a rebuild reuses the cached copy until a new release comes out. To pin a version, pass `--build-arg VID_DL_VERSION=v.2.3.3`.

The runtime image holds only what the server needs: the Electron app (run with Chromium's headless platform, so there is no X server), the libraries it links against, `vid-dl`, and `ffmpeg`.

## Raspberry Pi

A Raspberry Pi 4 or 5 with a 64-bit OS and at least 4 GB of RAM is recommended. Keep the default two resolver slots.

An ARM64 smoke test on Docker Desktop under QEMU (with an earlier build that still used Xvfb, and `--no-zygote` passed as a container argument) passed login, shared progress, HiAnime playback and seeking, and playback of a generated MP4. VidFast and Aether stream discovery timed out under emulation. Native Raspberry Pi hardware remains untested. [QEMU Chromium startup discussion](https://lists.nongnu.org/archive/html/qemu-devel/2021-04/msg05450.html)

## Notes

- **Updates:** the app's built-in updater doesn't run in the container. Run `docker compose pull && docker compose up -d` (or rebuild) to update; your data in `./config` is kept.
- **Health check:** the container reports healthy once the sign-in page answers.
