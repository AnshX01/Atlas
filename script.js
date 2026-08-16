const fs = require('fs');
const path = require('path');
const root = 'C:/Users/anshw/.gemini/antigravity-cli/brain/a31fa6a5-b655-4221-9a0f-d8e18b8672a6/.system_generated/worktrees/subagent-Tier-1-Commander---Security---Integration--MCP--Critic-security-mcp-critic-3a27e319';

// 1. main.ts
const mainTsPath = path.join(root, 'frontend/electron/main.ts');
let mainTs = fs.readFileSync(mainTsPath, 'utf8');
mainTs = mainTs.replace(
  'app.whenReady().then(async () => {\\r\\n  try {\\r\\n    // Automatically grant permissions',
  'app.whenReady().then(async () => {\\r\\n  try {\\r\\n    // Enforce aggressive CSP blocking eval() and inline scripts\\r\\n    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {\\r\\n      callback({\\r\\n        responseHeaders: {\\r\\n          ...details.responseHeaders,\\r\\n          \"Content-Security-Policy\": [\"default-src \\'self\\'; script-src \\'self\\'; style-src \\'self\\' \\'unsafe-inline\\'; img-src \\'self\\' data: https:; connect-src \\'self\\' ws://localhost:* http://localhost:* https://*; \"]\\r\\n        }\\r\\n      });\\r\\n    });\\r\\n\\r\\n    // Automatically grant permissions'
);
fs.writeFileSync(mainTsPath, mainTs);

// 2. mcp-manager.ts
const mcpTsPath = path.join(root, 'frontend/electron/services/mcp-manager.ts');
let mcpTs = fs.readFileSync(mcpTsPath, 'utf8');
mcpTs = mcpTs.replace(
  /env: \{ \.\.\.process\.env, \.\.\.env \},\r?\n\s*stdio: \['pipe', 'pipe', 'pipe'\],/g,
  'env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV || \"production\", ...env },\\n          stdio: [\"pipe\", \"pipe\", \"pipe\"],'
);
fs.writeFileSync(mcpTsPath, mcpTs);

// 3. background-cron.ts
const cronPath = path.join(root, 'frontend/electron/services/background-cron.ts');
let cronTs = fs.readFileSync(cronPath, 'utf8');
cronTs = cronTs.replace(
  \"import { Notification } from 'electron';\",
  \"import { Notification } from 'electron';\\nimport { getToken, setToken, listConfigured } from './token-store';\\nimport { refreshGoogleToken } from './google-oauth';\"
);
cronTs = cronTs.replace(
  '// 2. Check Calendar for upcoming events',
  '// 3. Automated OAuth token rotation\\n      const configured = listConfigured();\\n      if (configured.includes(\"google_workspace\")) {\\n        const creds = getToken(\"google_workspace\") as any;\\n        if (creds && creds.refresh_token && creds.client_id && creds.client_secret) {\\n          try {\\n            const newToken = await refreshGoogleToken(creds.client_id, creds.client_secret, creds.refresh_token);\\n            setToken(\"google_workspace\", { ...creds, access_token: newToken });\\n            console.log(\"[CronEngine] Automated OAuth token rotation successful for google_workspace\");\\n          } catch (e) {\\n            console.error(\"[CronEngine] Automated OAuth token rotation failed:\", e);\\n          }\\n        }\\n      }\\n\\n      // 2. Check Calendar for upcoming events'
);
fs.writeFileSync(cronPath, cronTs);
console.log('Edits completed successfully.');
