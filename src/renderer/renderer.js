'use strict';

// ── DOM references ─────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const miroUrlInput     = $('miro-url');
const folderInput      = $('output-folder');
const durationInput    = $('duration');
const intervalInput    = $('interval');

const btnOpenBrowser   = $('btn-open-browser');
const btnBrowse        = $('btn-browse');
const btnStart         = $('btn-start');
const btnPause         = $('btn-pause');
const btnResume        = $('btn-resume');
const btnStop          = $('btn-stop');
const btnClearLog      = $('btn-clear-log');
const btnReveal        = $('btn-reveal');

const statusDot        = $('status-dot');
const statusText       = $('status-text');
const statCount        = $('stat-count');
const statElapsed      = $('stat-elapsed');
const statNext         = $('stat-next');
const outputPathRow    = $('output-path-row');
const outputPath       = $('output-path');
const logPanel         = $('log-panel');

// ── Local state ────────────────────────────────────────────────────────────────

let currentStatus = 'idle';
let selectedFolder = '';
let browserOpen = false;

// ── Folder selection ───────────────────────────────────────────────────────────

btnBrowse.addEventListener('click', async () => {
  const folder = await window.api.selectFolder();
  if (folder) {
    selectedFolder = folder;
    folderInput.value = folder;
    updateButtons();
  }
});

// ── Browser window ─────────────────────────────────────────────────────────────

btnOpenBrowser.addEventListener('click', async () => {
  const url = miroUrlInput.value.trim();
  if (!url) {
    addLog('Please enter a Miro URL first.', 'error');
    return;
  }

  setBusy(btnOpenBrowser, 'Opening…');

  const result = await window.api.openBrowser({ url });

  clearBusy(btnOpenBrowser);

  if (!result.ok) {
    addLog(`Failed to open browser: ${result.error}`, 'error');
  } else {
    browserOpen = true;
    btnOpenBrowser.textContent = 'Show Browser';
    addLog('Browser opened. Log in to Miro if needed, then click Start.', 'info');
  }
});

// ── Capture controls ───────────────────────────────────────────────────────────

btnStart.addEventListener('click', async () => {
  if (!selectedFolder) {
    addLog('Please select an output folder first.', 'error');
    return;
  }

  const config = {
    outputDir: selectedFolder,
    interval:  Math.max(1, parseFloat(intervalInput.value) || 10),
    duration:  Math.max(0.1, parseFloat(durationInput.value) || 8),
    url:       miroUrlInput.value.trim(),
  };

  const result = await window.api.startCapture(config);
  if (!result.ok) addLog(`Start failed: ${result.error}`, 'error');
});

btnPause.addEventListener('click',  () => window.api.pauseCapture());
btnResume.addEventListener('click', () => window.api.resumeCapture());
btnStop.addEventListener('click',   () => window.api.stopCapture());

btnClearLog.addEventListener('click', () => { logPanel.innerHTML = ''; });
btnReveal.addEventListener('click',   () => window.api.revealOutputFolder());

// ── Status updates from main ───────────────────────────────────────────────────

window.api.onStatus((data) => {
  currentStatus = data.status;

  // Dot class + label
  const labels = {
    'idle':         'Ready — open a browser to begin',
    'browser-open': 'Browser open — ready to capture',
    'running':      'Capturing…',
    'paused':       'Paused',
  };
  statusDot.className = `status-dot status-${data.status}`;
  statusText.textContent = labels[data.status] ?? data.status;

  // Stats
  statCount.textContent   = data.count;
  statElapsed.textContent = data.elapsed ? formatDuration(data.elapsed) : '–';
  statNext.textContent    = data.nextIn != null ? `${Math.ceil(data.nextIn / 1000)}s` : '–';

  // Output folder row
  if (data.outputDir) {
    outputPath.textContent = data.outputDir;
    outputPathRow.classList.remove('hidden');
    // Update platform label
    btnReveal.textContent = window.api.platform === 'darwin' ? 'Show in Finder' : 'Open in Explorer';
  }

  updateButtons();
});

window.api.onLog((data) => addLog(data.msg, data.type));

// ── Button state machine ───────────────────────────────────────────────────────

function updateButtons() {
  const hasBrowser  = ['browser-open', 'running', 'paused'].includes(currentStatus);
  const isRunning   = currentStatus === 'running';
  const isPaused    = currentStatus === 'paused';
  const canStart    = hasBrowser && !isRunning && !isPaused && !!selectedFolder;

  btnOpenBrowser.disabled = isRunning || isPaused;
  btnStart.disabled       = !canStart;
  btnPause.disabled       = !isRunning;
  btnResume.disabled      = !isPaused;
  btnStop.disabled        = !(isRunning || isPaused);

  // Lock settings while running or paused
  const locked = isRunning || isPaused;
  [durationInput, intervalInput].forEach((el) => (el.disabled = locked));
}

// ── Log panel ──────────────────────────────────────────────────────────────────

function addLog(msg, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;

  const time = new Date().toLocaleTimeString('en-GB');
  const timeEl = document.createElement('span');
  timeEl.className = 'log-time';
  timeEl.textContent = time;

  const msgEl = document.createElement('span');
  msgEl.textContent = ' ' + msg;

  entry.appendChild(timeEl);
  entry.appendChild(msgEl);
  logPanel.appendChild(entry);
  logPanel.scrollTop = logPanel.scrollHeight;

  // Keep last 300 entries
  while (logPanel.children.length > 300) {
    logPanel.removeChild(logPanel.firstChild);
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(sec)}`;
}

function setBusy(btn, label) {
  btn._origLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
}

function clearBusy(btn) {
  btn.disabled = false;
  btn.textContent = btn._origLabel ?? btn.textContent;
}

// ── Init ───────────────────────────────────────────────────────────────────────

updateButtons();
addLog('Welcome — enter a Miro URL, select an output folder, then click Open Browser.', 'info');
