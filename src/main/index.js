'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');

// ── Windows ────────────────────────────────────────────────────────────────────

let controlWin = null;
let miroWin = null;
let powerSaveId = null; // ID returned by powerSaveBlocker.start()

function createControlWindow() {
  controlWin = new BrowserWindow({
    width: 840,
    height: 780,
    minWidth: 700,
    minHeight: 640,
    title: 'Miro Capture',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  controlWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  controlWin.once('ready-to-show', () => controlWin.show());

  controlWin.on('closed', () => {
    controlWin = null;
    doStopCapture();
    if (miroWin && !miroWin.isDestroyed()) miroWin.close();
    app.quit();
  });
}

// ── Capture state ──────────────────────────────────────────────────────────────

const capture = {
  status: 'idle',        // idle | browser-open | running | paused
  count: 0,
  startTime: null,
  nextCaptureAt: null,
  outputDir: null,
  config: null,
  _captureTimer: null,
  _durationTimer: null,
  _statusInterval: null,
};

// ── App lifecycle ──────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createControlWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createControlWindow();
  });
});

app.on('window-all-closed', () => {
  doStopCapture();
  app.quit();
});

// ── IPC: folder picker ─────────────────────────────────────────────────────────

ipcMain.handle('select-folder', async () => {
  if (!controlWin) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(controlWin, {
    title: 'Select Output Folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('reveal-output-folder', async () => {
  if (capture.outputDir) shell.openPath(capture.outputDir);
});

// ── IPC: browser window ────────────────────────────────────────────────────────

ipcMain.handle('open-browser', async (_e, { url }) => {
  try {
    if (miroWin && !miroWin.isDestroyed()) {
      miroWin.focus();
      return { ok: true };
    }

    miroWin = new BrowserWindow({
      width: 1280,
      height: 800,
      title: 'Miro – Capture Browser',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false, // Keep GPU rendering active when unfocused
      },
    });

    // Strip "Electron/x.x.x" from user-agent so Miro doesn't block the session
    const rawUA = miroWin.webContents.getUserAgent();
    const cleanUA = rawUA.replace(/\s*Electron\/[\d.]+/, '');
    miroWin.webContents.setUserAgent(cleanUA);

    // Allow OAuth popups (Google/Okta/SSO login flows)
    miroWin.webContents.setWindowOpenHandler(() => ({
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      },
    }));

    miroWin.on('closed', () => {
      miroWin = null;
      if (capture.status === 'running' || capture.status === 'paused') {
        doStopCapture();
        push('log', { msg: 'Browser window was closed — capture stopped.', type: 'error' });
      }
      capture.status = 'idle';
      pushStatus();
    });

    await miroWin.loadURL(url);

    capture.status = 'browser-open';
    pushStatus();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('close-browser', () => {
  if (miroWin && !miroWin.isDestroyed()) miroWin.close();
  return { ok: true };
});

// ── IPC: capture controls ──────────────────────────────────────────────────────

ipcMain.handle('start-capture', async (_e, config) => {
  if (!miroWin || miroWin.isDestroyed())
    return { ok: false, error: 'Browser window is not open.' };
  if (capture.status === 'running')
    return { ok: false, error: 'Capture is already running.' };

  try {
    fs.mkdirSync(config.outputDir, { recursive: true });
  } catch (err) {
    return { ok: false, error: `Cannot use output folder: ${err.message}` };
  }

  capture.config = config;
  capture.outputDir = config.outputDir;
  capture.status = 'running';
  capture.count = 0;
  capture.startTime = Date.now();
  capture.nextCaptureAt = null;

  // Prevent the Mac/PC from sleeping during the capture session
  if (powerSaveId === null) {
    powerSaveId = powerSaveBlocker.start('prevent-display-sleep');
  }

  appendLog('=== Capture session started ===');
  appendLog(`Interval: ${config.interval}s  Duration: ${config.duration}h`);

  // First capture immediately, then schedule the rest
  await doCapture();
  scheduleNext();

  // Auto-stop when duration elapses
  capture._durationTimer = setTimeout(() => {
    appendLog('Duration limit reached — stopping automatically.');
    push('log', { msg: `${config.duration}h duration complete — stopped.`, type: 'info' });
    doStopCapture();
  }, config.duration * 3_600_000);

  // Push live status updates every second
  capture._statusInterval = setInterval(pushStatus, 1000);

  pushStatus();
  return { ok: true };
});

ipcMain.handle('pause-capture', () => {
  if (capture.status !== 'running') return { ok: false };
  clearCaptureTimer();
  capture.status = 'paused';
  capture.nextCaptureAt = null;
  appendLog('Paused.');
  push('log', { msg: 'Capture paused.', type: 'info' });
  pushStatus();
  return { ok: true };
});

ipcMain.handle('resume-capture', () => {
  if (capture.status !== 'paused') return { ok: false };
  capture.status = 'running';
  appendLog('Resumed.');
  push('log', { msg: 'Capture resumed.', type: 'info' });
  scheduleNext();
  pushStatus();
  return { ok: true };
});

ipcMain.handle('stop-capture', () => {
  doStopCapture();
  return { ok: true };
});

// ── Capture core ───────────────────────────────────────────────────────────────

function scheduleNext() {
  clearCaptureTimer();
  if (capture.status !== 'running') return;

  const ms = capture.config.interval * 1000;
  capture.nextCaptureAt = Date.now() + ms;

  capture._captureTimer = setTimeout(async () => {
    capture._captureTimer = null;
    if (capture.status !== 'running') return;
    await doCapture();
    scheduleNext();
  }, ms);
}

async function doCapture() {
  if (!miroWin || miroWin.isDestroyed()) return;

  // Restore from minimised so the GPU compositor is active
  if (miroWin.isMinimized()) {
    miroWin.restore();
    await sleep(150);
  }

  try {
    const img = await miroWin.webContents.capturePage();

    if (img.isEmpty()) throw new Error('capturePage returned an empty image');

    const ts = formatTs(new Date());
    const filename = `miro-capture-${ts}.png`;
    const filepath = path.join(capture.outputDir, filename);

    fs.writeFileSync(filepath, img.toPNG());
    capture.count++;

    const sizeStr = formatBytes(fs.statSync(filepath).size);
    appendLog(`Saved: ${filename}  (${sizeStr})`);
    push('log', { msg: `Saved: ${filename}`, type: 'success' });
    pushStatus();
  } catch (err) {
    const msg = `Capture failed: ${err.message}`;
    appendLog(`ERROR: ${msg}`);
    push('log', { msg, type: 'error' });
    // Continue — do not abort the session on a single failure
  }
}

function doStopCapture() {
  const prev = capture.status;
  if (prev === 'idle') return;

  clearCaptureTimer();

  if (capture._durationTimer) {
    clearTimeout(capture._durationTimer);
    capture._durationTimer = null;
  }
  if (capture._statusInterval) {
    clearInterval(capture._statusInterval);
    capture._statusInterval = null;
  }

  capture.status = (miroWin && !miroWin.isDestroyed()) ? 'browser-open' : 'idle';
  capture.nextCaptureAt = null;

  if (prev === 'running' || prev === 'paused') {
    const msg = `Session ended — ${capture.count} captures saved.`;
    appendLog(msg);
    push('log', { msg, type: 'info' });
  }

  // Release the sleep-prevention lock
  if (powerSaveId !== null) {
    powerSaveBlocker.stop(powerSaveId);
    powerSaveId = null;
  }

  pushStatus();
}

function clearCaptureTimer() {
  if (capture._captureTimer) {
    clearTimeout(capture._captureTimer);
    capture._captureTimer = null;
  }
}

// ── Log file ───────────────────────────────────────────────────────────────────

function appendLog(message) {
  if (!capture.outputDir) return;
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(path.join(capture.outputDir, 'capture-log.txt'), line, 'utf8');
  } catch (_) {}
}

// ── Push helpers ───────────────────────────────────────────────────────────────

function push(channel, data) {
  if (controlWin && !controlWin.isDestroyed()) {
    controlWin.webContents.send(channel, data);
  }
}

function pushStatus() {
  const elapsed = capture.startTime ? Date.now() - capture.startTime : 0;
  const nextIn = capture.nextCaptureAt ? Math.max(0, capture.nextCaptureAt - Date.now()) : null;
  push('status', {
    status: capture.status,
    count: capture.count,
    elapsed,
    nextIn,
    outputDir: capture.outputDir,
  });
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function formatTs(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1_048_576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1_048_576).toFixed(1)} MB`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
