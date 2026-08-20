import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { app } from 'electron';
import * as fs from 'fs';

export class PythonBackendManager {
  private process: ChildProcess | null = null;
  private isShuttingDown = false;

  start() {
    if (this.process) return;

    const isDev = !app.isPackaged;
    const backendDir = isDev 
      ? path.resolve(__dirname, '../../backend')
      : path.join(process.resourcesPath, 'backend');

    if (!fs.existsSync(backendDir)) {
      console.warn('[Python Backend] Backend directory not found at ' + backendDir + '. Skipping spawn.');
      return;
    }

    const dbPath = path.join(app.getPath('userData'), 'atlas-backend.sqlite');
    console.log('[Python Backend] Starting from ' + backendDir);

    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

    try {
      this.process = spawn(pythonCmd, ['-m', 'uvicorn', 'app.main:app', '--port', '8000'], {
        cwd: backendDir,
        env: {
          ...process.env,
          DATABASE_URL: 'sqlite+aiosqlite:///' + dbPath.replace(/\\\\/g, '/'),
          APP_SECRET_KEY: 'local-dev-secret-key-atlas-12345',
          APP_MASTER_ENCRYPTION_KEY: 'bXktMzItYnl0ZS1tYXN0ZXIta2V5LWF0bGFzLTEyMzQ1Ng==',
          JWT_SECRET_KEY: 'jwt-local-dev-secret-key-12345',
          NEO4J_PASSWORD: 'password',
        },
        windowsHide: true,
      });

      this.process.stdout?.on('data', (data) => console.log('[Python Backend] ' + data.toString().trim()));
      this.process.stderr?.on('data', (data) => console.error('[Python Backend] ' + data.toString().trim()));

      this.process.on('exit', (code) => {
        console.log('[Python Backend] Exited with code ' + code);
        this.process = null;
        if (!this.isShuttingDown) {
          setTimeout(() => this.start(), 5000);
        }
      });
    } catch (err: any) {
      console.error('[Python Backend] Failed to spawn: ' + err.message);
    }
  }

  stop() {
    this.isShuttingDown = true;
    if (this.process) {
      console.log('[Python Backend] Shutting down...');
      this.process.kill();
      this.process = null;
    }
  }
}
