# Video Ripper

A standalone macOS app that pulls a video from YouTube into a small editor, lets you pick
the part you want, and exports that piece — with its audio — to your Desktop.

- **Timeline window** – drag it to move, drag either end to expand or shrink. It sets which
  stretch of time is kept.
- **Frame window** – drag it to move, drag any of the eight handles to resize. It sets which
  area of the picture is kept (leave it on *Full frame* to keep everything).
- **Export to Desktop** – writes the selection as
  - **MP4 (H.264 + AAC)** – opens in Premiere Pro, Final Cut Pro, DaVinci Resolve, iMovie,
    CapCut and everything else, or
  - **MOV (ProRes 422)** – a larger editing master with uncompressed audio.

Runs on Apple silicon Macs with macOS 12 or later (including Sonoma 14.6). Nothing else
needs to be installed: the downloader (yt-dlp) and encoder (ffmpeg) are inside the app.

## Install

1. Open the repository's **Actions** tab, pick the latest *Build macOS app* run and download
   the **Video-Ripper-macOS** artifact.
2. Open the `.dmg` and drag **Video Ripper** into Applications.
3. The app is not signed with an Apple developer certificate, so the first launch needs one
   extra step. In Terminal:

   ```sh
   xattr -cr "/Applications/Video Ripper.app"
   ```

   Then open it normally.

Or build it yourself on a Mac with Node.js 20+:

```sh
npm install
npm run dist     # creates dist/Video-Ripper-<version>-mac-arm64.dmg
```

## Use

1. Paste a YouTube link, choose a quality, press **Load video**.
2. Adjust the timeline window and the frame window. **Play** previews just the selection.
3. Choose a format and press **Export to Desktop**.

| Key | Action |
| --- | --- |
| Space | Play / pause |
| I / O | Set start / end at the playhead |
| ← / → | Step one frame (hold Shift for one second) |

**Open file…** loads a video already on your Mac into the same editor.

If YouTube links stop loading, press **Update downloader** — YouTube changes often and this
fetches the newest yt-dlp.

## Develop

```sh
npm install
npm start
```

`src/main.js` runs yt-dlp and ffmpeg; `src/renderer/` is the editor UI.

Only download videos you have the right to use.
