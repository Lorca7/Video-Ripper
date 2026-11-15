const $ = (id) => document.getElementById(id);

const video = $('video');
const stage = $('stage');
const cropLayer = $('crop-layer');
const cropBox = $('crop-box');
const timeline = $('timeline');
const rangeEl = $('range');

const MIN_CLIP = 0.1; // seconds
const MIN_CROP = 0.05; // fraction of the frame

const state = {
  source: null, // { path, url, title }
  duration: 0,
  start: 0,
  end: 0,
  crop: { x: 0, y: 0, w: 1, h: 1 }, // fractions of the frame
  busy: null, // 'download' | 'export' | null
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------- time text

function fmt(seconds) {
  const t = Math.max(0, seconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function parseTime(text) {
  const parts = text.trim().split(':').map(Number);
  if (!parts.length || parts.length > 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

// ---------------------------------------------------------------- status bar

function showStatus(text, { fraction = null, error = false, cancel = false } = {}) {
  $('status').hidden = false;
  $('status').classList.toggle('error', error);
  $('status-text').textContent = text;
  $('status-cancel').hidden = !cancel && !error;
  $('status-cancel').textContent = error ? 'Dismiss' : 'Cancel';
  const meter = $('status-fill').parentElement;
  meter.classList.toggle('busy', fraction === null);
  $('status-fill').style.width = fraction === null ? '' : `${Math.round(fraction * 100)}%`;
}

function hideStatus() {
  $('status').hidden = true;
}

function setBusy(kind) {
  state.busy = kind;
  $('load').disabled = $('open').disabled = $('update').disabled = Boolean(kind);
  $('export').disabled = Boolean(kind);
}

$('status-cancel').addEventListener('click', () => {
  if (state.busy === 'download') window.ripper.cancelDownload();
  else if (state.busy === 'export') window.ripper.cancelExport();
  else hideStatus();
});

// ---------------------------------------------------------------- loading

function loadSource(source) {
  state.source = source;
  $('result').hidden = true;
  video.src = source.url;
  video.load();
}

video.addEventListener('loadedmetadata', () => {
  state.duration = video.duration;
  state.start = 0;
  state.end = video.duration;
  state.crop = { x: 0, y: 0, w: 1, h: 1 };
  $('aspect').value = 'full';
  $('empty').hidden = true;
  video.hidden = false;
  cropLayer.hidden = false;
  $('editor').inert = false;
  layoutCrop();
  renderCrop();
  renderRange();
});

video.addEventListener('error', () => {
  if (!state.source) return;
  showStatus('This video could not be opened for preview.', { error: true });
});

$('load').addEventListener('click', async () => {
  const url = $('url').value.trim();
  if (!url) return $('url').focus();
  setBusy('download');
  let title = '';
  showStatus('Contacting YouTube…', { cancel: true });
  window.ripper.onDownloadProgress((p) => {
    if (p.title) title = p.title;
    const label = title ? `Downloading “${title}”` : 'Downloading';
    if (p.fraction === undefined) return showStatus(`${label}…`, { cancel: true });
    const what = p.part ? 'audio' : 'video';
    showStatus(`${label} — ${what} ${Math.round(p.fraction * 100)}%`, { fraction: p.fraction, cancel: true });
  });
  try {
    const source = await window.ripper.download(url, $('quality').value);
    hideStatus();
    loadSource(source);
  } catch (err) {
    showStatus(cleanError(err), { error: true });
  } finally {
    setBusy(null);
  }
});

$('url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('load').click();
});

$('open').addEventListener('click', async () => {
  const source = await window.ripper.openFile();
  if (source) {
    hideStatus();
    loadSource(source);
  }
});

$('update').addEventListener('click', async () => {
  setBusy('update');
  showStatus('Updating the downloader…');
  try {
    await window.ripper.updateDownloader();
    showStatus('Downloader is up to date.', { fraction: 1 });
    setTimeout(() => state.busy || hideStatus(), 2500);
  } catch (err) {
    showStatus(cleanError(err), { error: true });
  } finally {
    setBusy(null);
  }
});

function cleanError(err) {
  return String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

// ---------------------------------------------------------------- frame window

// Position the layer exactly over the visible picture (the video is letterboxed).
function layoutCrop() {
  if (!video.videoWidth) return;
  const box = video.getBoundingClientRect();
  const host = stage.getBoundingClientRect();
  const scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
  const w = video.videoWidth * scale;
  const h = video.videoHeight * scale;
  cropLayer.style.left = `${box.left - host.left + (box.width - w) / 2}px`;
  cropLayer.style.top = `${box.top - host.top + (box.height - h) / 2}px`;
  cropLayer.style.width = `${w}px`;
  cropLayer.style.height = `${h}px`;
}

function cropPixels() {
  const { x, y, w, h } = state.crop;
  const even = (n) => Math.max(2, Math.floor(n / 2) * 2);
  return {
    x: Math.round(x * video.videoWidth),
    y: Math.round(y * video.videoHeight),
    w: Math.min(even(w * video.videoWidth), video.videoWidth),
    h: Math.min(even(h * video.videoHeight), video.videoHeight),
  };
}

const isFullFrame = () => state.crop.w > 0.999 && state.crop.h > 0.999;

function renderCrop() {
  const { x, y, w, h } = state.crop;
  for (const el of [cropBox, $('crop-shade')]) {
    el.style.left = `${x * 100}%`;
    el.style.top = `${y * 100}%`;
    el.style.width = `${w * 100}%`;
    el.style.height = `${h * 100}%`;
  }
  const px = cropPixels();
  $('crop-size').textContent = `${px.w} × ${px.h}`;
}

cropBox.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  cropBox.setPointerCapture(e.pointerId);
  const handle = e.target.dataset.h || 'move';
  const layer = cropLayer.getBoundingClientRect();
  const origin = { px: e.clientX, py: e.clientY, ...state.crop };

  const onMove = (ev) => {
    const dx = (ev.clientX - origin.px) / layer.width;
    const dy = (ev.clientY - origin.py) / layer.height;
    let left = origin.x;
    let top = origin.y;
    let right = origin.x + origin.w;
    let bottom = origin.y + origin.h;
    if (handle === 'move') {
      left = clamp(origin.x + dx, 0, 1 - origin.w);
      top = clamp(origin.y + dy, 0, 1 - origin.h);
      right = left + origin.w;
      bottom = top + origin.h;
    } else {
      if (handle.includes('w')) left = clamp(origin.x + dx, 0, right - MIN_CROP);
      if (handle.includes('e')) right = clamp(right + dx, left + MIN_CROP, 1);
      if (handle.includes('n')) top = clamp(origin.y + dy, 0, bottom - MIN_CROP);
      if (handle.includes('s')) bottom = clamp(bottom + dy, top + MIN_CROP, 1);
    }
    state.crop = { x: left, y: top, w: right - left, h: bottom - top };
    if (handle !== 'move') $('aspect').value = isFullFrame() ? 'full' : 'free';
    renderCrop();
  };
  const onUp = () => {
    cropBox.removeEventListener('pointermove', onMove);
    cropBox.removeEventListener('pointerup', onUp);
    cropBox.removeEventListener('pointercancel', onUp);
  };
  cropBox.addEventListener('pointermove', onMove);
  cropBox.addEventListener('pointerup', onUp);
  cropBox.addEventListener('pointercancel', onUp);
});

$('aspect').addEventListener('change', () => {
  const value = $('aspect').value;
  if (value === 'free') return;
  if (value === 'full') {
    state.crop = { x: 0, y: 0, w: 1, h: 1 };
  } else {
    // Largest centred box of the chosen shape.
    const [aw, ah] = value.split(':').map(Number);
    const frame = video.videoWidth / video.videoHeight;
    const target = aw / ah;
    const w = target < frame ? target / frame : 1;
    const h = target < frame ? 1 : frame / target;
    state.crop = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  }
  renderCrop();
});

new ResizeObserver(layoutCrop).observe(stage);

// ---------------------------------------------------------------- timeline window

function renderRange() {
  const d = state.duration || 1;
  rangeEl.style.left = `${(state.start / d) * 100}%`;
  rangeEl.style.width = `${((state.end - state.start) / d) * 100}%`;
  if (document.activeElement !== $('in')) $('in').value = fmt(state.start);
  if (document.activeElement !== $('out')) $('out').value = fmt(state.end);
  $('length').textContent = `Clip length ${fmt(state.end - state.start)}`;
}

function setRange(start, end) {
  const d = state.duration;
  start = clamp(start, 0, d - MIN_CLIP);
  end = clamp(end, start + MIN_CLIP, d);
  state.start = start;
  state.end = end;
  renderRange();
}

const seek = (t) => {
  video.currentTime = clamp(t, 0, state.duration);
};

timeline.addEventListener('pointerdown', (e) => {
  if (!state.duration) return;
  e.preventDefault();
  timeline.setPointerCapture(e.pointerId);
  const rect = timeline.getBoundingClientRect();
  const toTime = (clientX) => clamp((clientX - rect.left) / rect.width, 0, 1) * state.duration;
  const grip = e.target.dataset.g;
  const mode = grip || (e.target === rangeEl ? 'move' : 'seek');
  const origin = { t: toTime(e.clientX), start: state.start, end: state.end };
  let moved = false;
  video.pause();

  const apply = (ev) => {
    const t = toTime(ev.clientX);
    if (mode === 'seek') return seek(t);
    if (Math.abs(ev.clientX - e.clientX) > 2) moved = true;
    if (mode === 'start') {
      setRange(Math.min(t, state.end - MIN_CLIP), state.end);
      seek(state.start);
    } else if (mode === 'end') {
      setRange(state.start, Math.max(t, state.start + MIN_CLIP));
      seek(state.end);
    } else if (moved) {
      const length = origin.end - origin.start;
      const start = clamp(origin.start + (t - origin.t), 0, state.duration - length);
      setRange(start, start + length);
      seek(state.start);
    }
  };
  const onUp = (ev) => {
    // A plain click inside the window just moves the playhead.
    if (mode === 'move' && !moved) seek(toTime(ev.clientX));
    timeline.removeEventListener('pointermove', apply);
    timeline.removeEventListener('pointerup', onUp);
    timeline.removeEventListener('pointercancel', onUp);
  };
  timeline.addEventListener('pointermove', apply);
  timeline.addEventListener('pointerup', onUp);
  timeline.addEventListener('pointercancel', onUp);
  apply(e);
});

function commitTimeInput(input, which) {
  const t = parseTime(input.value);
  if (t !== null) {
    if (which === 'start') setRange(Math.min(t, state.end - MIN_CLIP), state.end);
    else setRange(state.start, Math.max(t, state.start + MIN_CLIP));
    seek(which === 'start' ? state.start : state.end);
  }
  input.blur();
  renderRange();
}

for (const [id, which] of [['in', 'start'], ['out', 'end']]) {
  $(id).addEventListener('change', () => commitTimeInput($(id), which));
  $(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commitTimeInput($(id), which);
  });
}

const setIn = () => setRange(Math.min(video.currentTime, state.end - MIN_CLIP), state.end);
const setOut = () => setRange(state.start, Math.max(video.currentTime, state.start + MIN_CLIP));
$('set-in').addEventListener('click', setIn);
$('set-out').addEventListener('click', setOut);

// ---------------------------------------------------------------- playback

function togglePlay() {
  if (!state.source) return;
  if (!video.paused) return video.pause();
  // Playback previews the selection: start from its beginning when outside it.
  if (video.currentTime < state.start || video.currentTime >= state.end - 0.05) seek(state.start);
  video.play();
}

$('play').addEventListener('click', togglePlay);
video.addEventListener('play', () => { $('play').textContent = '❚❚'; });
video.addEventListener('pause', () => { $('play').textContent = '▶'; });

function tick() {
  if (state.duration) {
    if (!video.paused && video.currentTime >= state.end) {
      video.pause();
      seek(state.end);
    }
    $('playhead').style.left = `${(video.currentTime / state.duration) * 100}%`;
    $('clock').textContent = `${fmt(video.currentTime)} / ${fmt(state.duration)}`;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

document.addEventListener('keydown', (e) => {
  if (!state.source || e.metaKey || e.ctrlKey) return;
  if (['INPUT', 'SELECT'].includes(e.target.tagName)) return;
  const key = e.key.toLowerCase();
  if (key === ' ') togglePlay();
  else if (key === 'i') setIn();
  else if (key === 'o') setOut();
  else if (key === 'arrowleft') seek(video.currentTime - (e.shiftKey ? 1 : 1 / 30));
  else if (key === 'arrowright') seek(video.currentTime + (e.shiftKey ? 1 : 1 / 30));
  else return;
  e.preventDefault();
});

// ---------------------------------------------------------------- export

$('export').addEventListener('click', async () => {
  if (!state.source) return;
  video.pause();
  setBusy('export');
  $('result').hidden = true;
  showStatus('Exporting…', { fraction: 0, cancel: true });
  window.ripper.onExportProgress((p) => {
    showStatus(`Exporting… ${Math.round(p.fraction * 100)}%`, { fraction: p.fraction, cancel: true });
  });
  try {
    const out = await window.ripper.exportClip({
      input: state.source.path,
      title: state.source.title,
      start: state.start,
      end: state.end,
      crop: isFullFrame() ? null : cropPixels(),
      format: $('format').value,
    });
    hideStatus();
    const result = $('result');
    result.replaceChildren();
    const label = document.createElement('span');
    label.textContent = `Saved to Desktop: ${out.name}`;
    const reveal = document.createElement('button');
    reveal.textContent = 'Show in Finder';
    reveal.addEventListener('click', () => window.ripper.reveal(out.path));
    result.append(label, reveal);
    result.hidden = false;
  } catch (err) {
    showStatus(cleanError(err), { error: true });
  } finally {
    setBusy(null);
  }
});
