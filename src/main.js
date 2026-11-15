const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

let win = null;
let downloadProc = null;
let exportProc = null;

// ---------------------------------------------------------------- binaries

function bundledBin(name) {
  if (app.isPackaged) return path.join(process.resourcesPath, 'bin', name);
  const os = process.platform === 'darwin' ? 'mac' : process.platform;
  return path.join(__dirname, '..', 'bin', `${os}-${process.arch}`, name);
}

function updatedYtDlp() {
  return path.join(app.getPath('userData'), 'bin', 'yt-dlp');
}

// A copy downloaded by "Update downloader" wins over the one shipped in the app.
function ytDlpPath() {
  const updated = updatedYtDlp();
  return fs.existsSync(updated) ? updated : bundledBin('yt-dlp');
}

const ffmpegPath = () => bundledBin('ffmpeg');

function workDir() {
  const dir = path.join(app.getPath('temp'), 'video-ripper');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function lastLines(text, n = 6) {
  return text.trim().split('\n').slice(-n).join('\n');
}

// ---------------------------------------------------------------- download

function formatSelector(quality) {
  if (quality === 'best') return 'bv*+ba/b';
  const h = Number(quality) || 1080;
  // Prefer H.264 + AAC so the preview plays everywhere; fall back to anything.
  return [
    `bv*[vcodec^=avc1][height<=${h}]+ba[ext=m4a]`,
    `bv*[height<=${h}]+ba`,
    `b[height<=${h}]`,
    'b',
  ].join('/');
}

ipcMain.handle('download', async (_e, { url, quality }) => {
  let parsed;
  try {
    parsed = new URL(String(url).trim());
  } catch {
    throw new Error('That does not look like a valid link.');
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('Only http(s) links are supported.');
  if (downloadProc) throw new Error('A download is already running.');

  const outDir = fs.mkdtempSync(path.join(workDir(), 'dl-'));
  const args = [
    '--no-playlist',
    '--no-simulate',
    '--newline',
    '--progress',
    '-f', formatSelector(quality),
    '--merge-output-format', 'mp4',
    '--ffmpeg-location', path.dirname(ffmpegPath()),
    // YouTube extraction needs a JavaScript runtime; Electron doubles as Node.
    '--js-runtimes', `node:${process.execPath}`,
    '--progress-template',
    'download:PROG|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s',
    '--print', 'before_dl:TITLE|%(title)s',
    '--print', 'after_move:FILE|%(filepath)s',
    '-o', path.join(outDir, '%(id)s.%(ext)s'),
    '--', parsed.href,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(ytDlpPath(), args, {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    downloadProc = proc;
    let title = '';
    let file = '';
    let stderr = '';
    let buffer = '';
    let part = 0;
    let lastFraction = 0;

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('TITLE|')) {
          title = line.slice(6);
          send('download-progress', { title });
        } else if (line.startsWith('FILE|')) {
          file = line.slice(5);
        } else if (line.startsWith('PROG|')) {
          const [, done, total, estimate] = line.split('|');
          const size = Number(total) || Number(estimate);
          if (!size) continue;
          const fraction = Math.min(1, Number(done) / size);
          // Video and audio arrive as separate files; count each restart.
          if (fraction < lastFraction - 0.5) part += 1;
          lastFraction = fraction;
          send('download-progress', { fraction, part });
        }
      }
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => {
      downloadProc = null;
      reject(new Error(`Could not start the downloader: ${err.message}`));
    });
    proc.on('close', (code, signal) => {
      downloadProc = null;
      if (signal) return reject(new Error('Download cancelled.'));
      if (code !== 0 || !file || !fs.existsSync(file)) {
        const errors = stderr.split('\n').filter((l) => l.startsWith('ERROR'));
        return reject(new Error(errors.join('\n') || lastLines(stderr) || 'Download failed.'));
      }
      resolve({ path: file, url: pathToFileURL(file).href, title });
    });
  });
});

ipcMain.handle('cancel-download', () => {
  if (downloadProc) downloadProc.kill('SIGTERM');
});

ipcMain.handle('open-file', async () => {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv'] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const file = result.filePaths[0];
  return {
    path: file,
    url: pathToFileURL(file).href,
    title: path.basename(file, path.extname(file)),
  };
});

ipcMain.handle('update-downloader', async () => {
  const asset = process.platform === 'darwin'
    ? 'yt-dlp_macos'
    : process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
  const res = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`);
  if (!res.ok) throw new Error(`Update failed (HTTP ${res.status}).`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length < 1_000_000) throw new Error('Update failed (unexpected download).');
  const dest = updatedYtDlp();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(`${dest}.part`, data, { mode: 0o755 });
  fs.renameSync(`${dest}.part`, dest);
  return true;
});

// ---------------------------------------------------------------- export

const FORMATS = {
  mp4: {
    ext: 'mp4',
    args: [
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart',
    ],
  },
  prores: {
    ext: 'mov',
    args: [
      '-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le', '-vendor', 'apl0',
      '-c:a', 'pcm_s16le',
    ],
  },
};

function safeName(title) {
  const cleaned = String(title || 'clip')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || 'clip';
}

function stamp(seconds) {
  const s = Math.floor(seconds);
  const pad = (n) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  return `${h ? `${h}h` : ''}${pad(Math.floor((s % 3600) / 60))}m${pad(s % 60)}s`;
}

function uniquePath(dir, base, ext) {
  let candidate = path.join(dir, `${base}.${ext}`);
  for (let i = 2; fs.existsSync(candidate); i += 1) {
    candidate = path.join(dir, `${base} (${i}).${ext}`);
  }
  return candidate;
}

ipcMain.handle('export', async (_e, job) => {
  if (exportProc) throw new Error('An export is already running.');
  const format = FORMATS[job.format] || FORMATS.mp4;
  const start = Math.max(0, Number(job.start) || 0);
  const duration = Number(job.end) - start;
  if (!(duration > 0)) throw new Error('The selection is empty.');
  if (!fs.existsSync(job.input)) throw new Error('The source video is no longer available.');

  const args = ['-hide_banner', '-y', '-ss', start.toFixed(3), '-i', job.input, '-t', duration.toFixed(3)];
  if (job.crop) {
    // H.264 needs even dimensions.
    const even = (n) => Math.max(2, Math.floor(Number(n) / 2) * 2);
    const { x, y, w, h } = job.crop;
    args.push('-vf', `crop=${even(w)}:${even(h)}:${Math.max(0, Math.round(x))}:${Math.max(0, Math.round(y))}`);
  }
  args.push('-map', '0:v:0', '-map', '0:a:0?', ...format.args);

  const base = `${safeName(job.title)} ${stamp(start)}-${stamp(Number(job.end))}`;
  const output = uniquePath(app.getPath('desktop'), base, format.ext);
  args.push('-progress', 'pipe:1', '-nostats', output);

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), args);
    exportProc = proc;
    let stderr = '';
    let cancelled = false;
    proc.cancel = () => {
      cancelled = true;
      proc.kill('SIGTERM');
    };
    proc.stdout.on('data', (chunk) => {
      const matches = [...chunk.toString().matchAll(/out_time_(?:us|ms)=(\d+)/g)];
      if (!matches.length) return;
      const seconds = Number(matches[matches.length - 1][1]) / 1e6;
      send('export-progress', { fraction: Math.min(1, seconds / duration) });
    });
    proc.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    proc.on('error', (err) => {
      exportProc = null;
      reject(new Error(`Could not start the encoder: ${err.message}`));
    });
    proc.on('close', (code) => {
      exportProc = null;
      if (cancelled || code !== 0) {
        fs.rmSync(output, { force: true });
        return reject(new Error(cancelled ? 'Export cancelled.' : lastLines(stderr) || 'Export failed.'));
      }
      resolve({ path: output, name: path.basename(output) });
    });
  });
});

ipcMain.handle('cancel-export', () => {
  if (exportProc) exportProc.cancel();
});

ipcMain.handle('reveal', (_e, file) => {
  shell.showItemInFolder(file);
});

// ---------------------------------------------------------------- window

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#131418',
    title: 'Video Ripper',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => app.quit());

app.on('will-quit', () => {
  if (downloadProc) downloadProc.kill('SIGTERM');
  if (exportProc) exportProc.cancel();
  fs.rmSync(path.join(app.getPath('temp'), 'video-ripper'), { recursive: true, force: true });
});
