#!/usr/bin/env node
// Launches Electron for development, explicitly clearing ELECTRON_RUN_AS_NODE
// so it works even in environments (like Claude Code) that set it.
const { spawnSync } = require('child_process');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const result = spawnSync(electronPath, ['.'], { stdio: 'inherit', env });
process.exit(result.status ?? 1);
