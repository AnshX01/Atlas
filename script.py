import os
import re

root = r'C:\Users\anshw\.gemini\antigravity-cli\brain\a31fa6a5-b655-4221-9a0f-d8e18b8672a6\.system_generated\worktrees\subagent-Tier-1-Commander---Security---Integration--MCP--Critic-security-mcp-critic-3a27e319'

# 1. main.ts
main_ts_path = os.path.join(root, 'frontend', 'electron', 'main.ts')
with open(main_ts_path, 'r', encoding='utf-8') as f:
    content = f.read()

target = '''app.whenReady().then(async () => {
  try {
    // Automatically grant permissions'''
replacement = '''app.whenReady().then(async () => {
  try {
    // Enforce aggressive CSP blocking eval() and inline scripts
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' ws://localhost:* http://localhost:* https://*;"]
        }
      });
    });

    // Automatically grant permissions'''
if target in content:
    content = content.replace(target, replacement)
else:
    print('Target not found in main.ts')

with open(main_ts_path, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)

# 2. mcp-manager.ts
mcp_path = os.path.join(root, 'frontend', 'electron', 'services', 'mcp-manager.ts')
with open(mcp_path, 'r', encoding='utf-8') as f:
    content = f.read()

content = re.sub(
    r"env: \{ \.\.\.process\.env, \.\.\.env \},\r?\n\s*stdio: \['pipe', 'pipe', 'pipe'\],",
    '''// Strict zero-trust environment for MCP subprocesses
          env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV || 'production', ...env },
          stdio: ['pipe', 'pipe', 'pipe'],''',
    content
)
with open(mcp_path, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)

# 3. background-cron.ts
cron_path = os.path.join(root, 'frontend', 'electron', 'services', 'background-cron.ts')
with open(cron_path, 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    "import { Notification } from 'electron';",
    "import { Notification } from 'electron';\nimport { getToken, setToken, listConfigured } from './token-store';\nimport { refreshGoogleToken } from './google-oauth';"
)
content = content.replace(
    "// 2. Check Calendar for upcoming events",
    '''// 3. Automated OAuth token rotation
      const configured = listConfigured();
      if (configured.includes("google_workspace")) {
        const creds = getToken("google_workspace") as any;
        if (creds && creds.refresh_token && creds.client_id && creds.client_secret) {
          try {
            const newToken = await refreshGoogleToken(creds.client_id, creds.client_secret, creds.refresh_token);
            setToken("google_workspace", { ...creds, access_token: newToken });
            console.log("[CronEngine] Automated OAuth token rotation successful for google_workspace");
          } catch (e) {
            console.error("[CronEngine] Automated OAuth token rotation failed:", e);
          }
        }
      }

      // 2. Check Calendar for upcoming events'''
)
with open(cron_path, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)

print('Done')
