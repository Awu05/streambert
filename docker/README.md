# Streambert in Docker

Runs the Streambert desktop app inside a container. You use it from any browser.
The container is built on [linuxserver's Selkies base image](https://github.com/linuxserver/docker-baseimage-selkies),
which streams the app's window, including audio, to the browser.

Everything works the same as the desktop app: the embedded players, ad blocking,
stream capture, downloads (`vid-dl` and `ffmpeg` are included) and subtitles.

Images are built for both `linux/amd64` and `linux/arm64`.

> Only one person can use it at a time. Everyone who opens the page sees and
> controls the same window.

## Quick start

```bash
docker compose up -d --build
```

1. Open `https://<server-ip>:3001` and accept the self-signed certificate.
2. Log in with `CUSTOM_USER` / `PASSWORD` from `docker-compose.yml`. Change these first.
3. Enter your TMDB key, as on first launch of the desktop app.
4. To set up downloads:
   - In **Settings → Downloads → Download Folder**, choose `/config/Downloads`.
     This maps to `./downloads` on the host.
   - The first time you click **Download**, the dialog asks where the
     downloader is. Choose `/opt/vid-dl`.

Settings, the library and watch history are stored in `./config` and survive
rebuilds and image updates.

## Watching on a TV

Made for [TV Bro](https://github.com/truefedex/tv-bro) on an Android TV box,
controlled with the TV remote.

1. Open `https://<server-ip>:3001` in TV Bro and log in.
2. The container starts with **TV remote mode** on: a red ring shows what's
   selected, and the UI is 1.5× larger so it's readable from the couch. You
   can turn the mode off in **Settings → Appearance → TV remote / keyboard
   navigation**.

| Remote button | In the app | In a video |
| --- | --- | --- |
| Arrows | Move the red ring | ←/→ seek 10 s, ↑/↓ volume |
| OK | Open / press | Play / pause (also starts players that show a poster) |
| Back | Close the dialog, else go back | Leave fullscreen, else leave the player |

Downloaded files play in mpv with the same buttons, and Back closes it.

## Screen size

Each browser picks its screen size the first time it connects:

- **Computers** get a screen that matches the browser window, so it fills any
  window or monitor, including ultrawide ones.
- **TVs and phones** (narrow or touch screens) get a fixed 1920×1080 screen,
  scaled to fit.

Change it later in the Selkies sidebar's screen settings; each browser
remembers its own choice. There is still one shared session: the device that
connects last sets the size.

## Watching on your phone

Turn the phone sideways (landscape) for the best view.

**From outside your home:** use [Tailscale](https://tailscale.com/). Install it
on the server and on your phone and sign in to both with the same account,
then open `https://<server's tailscale name>:3001` on the phone. No router
ports need to be opened, and nothing is exposed to the internet. A reverse
proxy with a real certificate also works, but keep the password set.

**Tips:**

- In the Selkies sidebar (the small handle on the left edge), switch the touch
  mode to direct touch, so a tap clicks where you tap.
- On mobile data, lower **Frames per second** to 30 and raise **CRF** in the
  sidebar's video settings. Each browser keeps its own settings, so your TV
  keeps full quality.
- There is only one session. Opening Streambert on the phone takes over the
  screen the TV is showing.

## Building multi-arch images

Build for both architectures and push to a registry:

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t <registry>/streambert:latest --push .
```

To build only for the machine you're on:

```bash
docker build -t streambert:latest .
```

The Electron app is packaged on the build machine's own architecture, so that
step is fast. `vid-dl` is built from source for the target architecture. On a
cross-build this step runs under QEMU and takes a few extra minutes.

## Notes

- **Updates:** the app's built-in updater doesn't work in the container. To
  update, pull or rebuild the image. Your data in `/config` is kept.
- **HTTPS:** use port 3001. If you put it behind a reverse proxy, see the
  [Selkies reverse proxy docs](https://docs.linuxserver.io/selkies/user-guide/reverse-proxy/).
- **GPU:** uncomment the `/dev/dri` device in `docker-compose.yml` for an Intel
  or AMD GPU. This lowers CPU use for video encoding.
- **Playing downloads:** the app plays downloaded files in mpv, which is
  included. The mpv window opens fullscreen in the same browser tab, with the
  [uosc](https://github.com/tomasklaen/uosc) controls in Streambert's red.
  Click the video to pause, right-click for the menu (subtitles, audio,
  speed), and press `Esc` (or `q`) to close it and go back to Streambert. "Open in
  external player" for streams uses mpv too. The player is configured in
  [docker/root/etc/mpv/](root/etc/mpv/).
- **Window border:** `NO_DECOR=true` hides the window manager border, because the
  app draws its own title bar. Press `Ctrl+Shift+D` to toggle it.
- **Extra Electron flags:** set `STREAMBERT_EXTRA_FLAGS`, for example
  `STREAMBERT_EXTRA_FLAGS=--disable-gpu`.
- **Autostart:** `/defaults/autostart` is copied into `/config` on first run
  only. If you change it, delete `./config/.config/openbox/autostart` so the
  new version is copied.
