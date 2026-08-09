const fs = require('fs');
const path = require('path');

const srcDir = path.join('C:/Users/anshw/Documents/Atlas/frontend/electron');

// Fix main.ts
let mainPath = path.join(srcDir, 'main.ts');
let mainContent = fs.readFileSync(mainPath, 'utf8');

// Remove console.logs
mainContent = mainContent.replace(/\s*console\.log\(.*?\);/g, '');

// Add ipcMain.removeAllListeners() and removeHandler logic
let ipcStartIdx = mainContent.indexOf('// ── IPC Handlers');
if (ipcStartIdx !== -1) {
  let beforeIpc = mainContent.substring(0, ipcStartIdx);
  let afterIpc = mainContent.substring(ipcStartIdx);

  // Insert removeAllListeners
  afterIpc = afterIpc.replace(
    '// ── IPC Handlers ──────────────────────────────────────────────────────────────',
    '// ── IPC Handlers ──────────────────────────────────────────────────────────────\nipcMain.removeAllListeners();'
  );

  // For every ipcMain.handle, prepend ipcMain.removeHandler
  afterIpc = afterIpc.replace(/ipcMain\.handle\(\s*(["'][a-zA-Z0-9_-]+["'])/g, 'ipcMain.removeHandler($1);\nipcMain.handle($1');

  mainContent = beforeIpc + afterIpc;
}

fs.writeFileSync(mainPath, mainContent);

// Fix other files
const filesWithLog = [
  'services/local-auth.ts',
  'services/local-store.ts',
  'services/mcp-manager.ts',
  'services/orchestrator.ts',
  'services/token-store.ts'
];

for (const file of filesWithLog) {
  let p = path.join(srcDir, file);
  if (fs.existsSync(p)) {
    let content = fs.readFileSync(p, 'utf8');
    content = content.replace(/\s*console\.log\([\s\S]*?\);/g, '');
    fs.writeFileSync(p, content);
  }
}
console.log('Cleanup done.');
