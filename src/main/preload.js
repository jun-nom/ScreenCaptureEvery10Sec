'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Platform info (used for OS-specific labels in the renderer)
  platform: process.platform,

  // Folder
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  revealOutputFolder: () => ipcRenderer.invoke('reveal-output-folder'),

  // Browser window
  openBrowser: (opts) => ipcRenderer.invoke('open-browser', opts),
  closeBrowser: () => ipcRenderer.invoke('close-browser'),

  // Capture controls
  startCapture: (config) => ipcRenderer.invoke('start-capture', config),
  pauseCapture: () => ipcRenderer.invoke('pause-capture'),
  resumeCapture: () => ipcRenderer.invoke('resume-capture'),
  stopCapture: () => ipcRenderer.invoke('stop-capture'),

  // Events from main process
  onStatus: (cb) => ipcRenderer.on('status', (_e, d) => cb(d)),
  onLog: (cb) => ipcRenderer.on('log', (_e, d) => cb(d)),
});
