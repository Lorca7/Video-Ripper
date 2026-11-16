#!/usr/bin/env node
// Downloads the yt-dlp and ffmpeg executables the app drives.
//   node scripts/fetch-binaries.js            -> for this machine (dev)
//   node scripts/fetch-binaries.js --mac      -> Apple silicon macOS (packaging)
// Files land in bin/<os>-<arch>/ which electron-builder copies into the app.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FFMPEG_TAG = 'b6.1.1';
const FFMPEG_BASE = `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_TAG}`;
const YTDLP_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';

const TARGETS = {
  'mac-arm64': { ffmpeg: 'ffmpeg-darwin-arm64', ytdlp: 'yt-dlp_macos' },
  'linux-x64': { ffmpeg: 'ffmpeg-linux-x64', ytdlp: 'yt-dlp_linux' },
  'linux-arm64': { ffmpeg: 'ffmpeg-linux-arm64', ytdlp: 'yt-dlp_linux_aarch64' },
};

function download(url, dest) {
  // curl honours system proxy settings and follows GitHub's redirects.
  const tmp = `${dest}.part`;
  execFileSync('curl', ['-fL', '--retry', '3', '-sS', '-o', tmp, url], { stdio: 'inherit' });
  fs.renameSync(tmp, dest);
  fs.chmodSync(dest, 0o755);
}

function fetchTarget(key) {
  const target = TARGETS[key];
  if (!target) throw new Error(`Unsupported platform: ${key}`);
  const dir = path.join(__dirname, '..', 'bin', key);
  fs.mkdirSync(dir, { recursive: true });
  const jobs = [
    ['ffmpeg', `${FFMPEG_BASE}/${target.ffmpeg}`],
    ['yt-dlp', `${YTDLP_BASE}/${target.ytdlp}`],
  ];
  for (const [name, url] of jobs) {
    const dest = path.join(dir, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000) continue;
    console.log(`Fetching ${name} for ${key}…`);
    download(url, dest);
  }
}

const os = process.platform === 'darwin' ? 'mac' : process.platform;
const keys = process.argv.includes('--mac') ? ['mac-arm64'] : [`${os}-${process.arch}`];
keys.forEach(fetchTarget);
