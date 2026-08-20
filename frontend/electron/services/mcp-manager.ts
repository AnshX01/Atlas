/**
 * Atlas MCP Server Manager
 *
 * Spawns and manages MCP (Model Context Protocol) server subprocesses.
 * Each server communicates via stdio using JSON-RPC 2.0.
 *
 * Official servers used:
 * - GitHub: @modelcontextprotocol/server-github
 * - Slack: @modelcontextprotocol/server-slack
 * - Filesystem: @modelcontextprotocol/server-filesystem
 *
 * For Google Workspace and Notion, we use direct API connectors
 * since official MCP servers don't exist for them yet.
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { getToken } from './token-store';
import { GmailConnector } from './connectors/gmail';
import { NotionConnector } from './connectors/notion';

// ── Types ──────────────────────────────────────────────────────────────────────

interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  getEnv: () => Record<string, string> | null; // Dynamic env based on stored tokens
  getArgs?: () => string[] | null; // Dynamic args resolution (e.g. filesystem paths as CLI args)
}

interface MCPServer {
  name: string;
  process: ChildProcess | null;
  status: 'stopped' | 'starting' | 'running' | 'error';
  restartCount: number;
  lastError?: string;
  config: MCPServerConfig;
}

interface MCPRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

export type MCPServerStatus = 'running' | 'stopped' | 'error' | 'starting' | 'direct_api';

export interface MCPServerStatusInfo {
  name: string;
  status: MCPServerStatus;
  restartCount?: number;
  lastError?: string;
}

// ── Request ID Generator ───────────────────────────────────────────────────────

let requestId = 0;
function nextId(): number { return ++requestId; }

// ── Manager Class ──────────────────────────────────────────────────────────────

export class MCPServerManager {
  private servers: Map<string, MCPServer> = new Map();
  private pendingRequests: Map<number, { serverName: string; resolve: (v: any) => void; reject: (e: Error) => void; timeout: NodeJS.Timeout }> = new Map();
  private buffers: Map<string, string> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  // Direct API connectors for services without MCP servers
  private gmailConnector = new GmailConnector();
  private notionConnector = new NotionConnector();

  constructor() {
    // Resolve the npx path for spawning MCP servers
    const npxPath = process.platform === 'win32' ? 'npx.cmd' : 'npx';

    // Define server configs
    this.defineServer('github', {
      name: 'github',
      command: npxPath,
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {},
      getEnv: () => {
        const creds = getToken('github') as Record<string, string> | null;
        if (!creds?.personal_access_token) return null;
        return { GITHUB_PERSONAL_ACCESS_TOKEN: creds.personal_access_token };
      },
    });

    this.defineServer('slack', {
      name: 'slack',
      command: npxPath,
      args: ['-y', '@modelcontextprotocol/server-slack'],
      env: {},
      getEnv: () => {
        const creds = getToken('slack') as Record<string, string> | null;
        if (!creds?.bot_token || !creds?.team_id) return null;
        return { SLACK_BOT_TOKEN: creds.bot_token, SLACK_TEAM_ID: creds.team_id };
      },
    });

    this.defineServer('filesystem', {
      name: 'filesystem',
      command: npxPath,
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      env: {},
      getEnv: () => {
        // We only need getEnv to signal "configured" — actual paths are passed via getArgs
        const creds = getToken('local_fs') as Record<string, string> | null;
        if (!creds?.watch_paths && !creds?.paths) return null;
        const paths = (creds.watch_paths || creds.paths || '').split('\n').filter(Boolean);
        if (paths.length === 0) return null;
        return {}; // No env vars needed — paths go as CLI args
      },
      getArgs: () => {
        const creds = getToken('local_fs') as Record<string, string> | null;
        if (!creds?.watch_paths && !creds?.paths) return null;
        const paths = (creds.watch_paths || creds.paths || '').split('\n').filter(Boolean);
        if (paths.length === 0) return null;
        
        // Strict zero-trust path sanitization to prevent Windows batch script command injection via npx.cmd
        const sanitizedPaths = paths.map(p => {
          if (/[&|;<>^"%]/.test(p)) {
            throw new Error(`SECURITY: Invalid characters in filesystem path to prevent command injection: ${p}`);
          }
          return p.trim();
        });
        
        // @modelcontextprotocol/server-filesystem takes directory paths as CLI arguments
        return ['-y', '@modelcontextprotocol/server-filesystem', ...sanitizedPaths];
      },
    });

    // Keep-Alive heartbeat for MCP subprocesses
    this.heartbeatInterval = setInterval(() => {
      for (const [name, server] of this.servers) {
        if (server.status === 'running' && (name === 'github' || name === 'slack')) {
          this.sendRequest(name, 'tools/list').catch((e) => console.warn("Caught promise error:", e));
        }
      }
    }, 60 * 1000); // 1 minute
  }

  private defineServer(name: string, config: MCPServerConfig) {
    this.servers.set(name, {
      name,
      process: null,
      status: 'stopped',
      restartCount: 0,
      config,
    });
  }

  // ── Start / Stop ─────────────────────────────────────────────────────────────

  async startServer(name: string): Promise<boolean> {
    const server = this.servers.get(name);
    if (!server) {
      console.error(`[MCP Manager] Unknown server: ${name}`);
      return false;
    }

    if (server.status === 'running' && server.process) return true;
    if (server.status === 'starting') return false;

    const env = server.config.getEnv();
    if (!env) {
      if (name === 'filesystem') {
        console.info(`[MCP Manager] Cannot start ${name} - no folders configured`);
        server.lastError = 'Local Files connector has no folders configured. Add folder paths in Settings > Integrations > Local Files.';
      } else {
        console.info(`[MCP Manager] Cannot start ${name} - no credentials configured`);
        server.lastError = `No credentials configured for ${name}. Check Settings > Integrations.`;
      }
      return false;
    }

    server.status = 'starting';
    server.lastError = undefined;

    try {
      // Resolve args: use dynamic getArgs() if defined (e.g. filesystem paths as CLI args)
      const args = server.config.getArgs ? (server.config.getArgs() || server.config.args) : server.config.args;

      let proc: ChildProcess;
      try {
        proc = spawn(server.config.command, args, {
          // Strict zero-trust environment for MCP subprocesses
          env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV || 'production', ...env },
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          shell: false,
        });
      } catch (spawnErr: any) {
        throw new Error(`Failed to spawn process: ${spawnErr.message}`);
      }

      server.process = proc;
      this.buffers.set(name, '');

      proc.stdout?.on('data', (data: Buffer) => {
        try {
          const buffer = (this.buffers.get(name) || '') + data.toString();
          const lines = buffer.split('\n');
          this.buffers.set(name, lines.pop() || '');

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const response = JSON.parse(line) as MCPResponse;
              const pending = this.pendingRequests.get(response.id);
              if (pending) {
                clearTimeout(pending.timeout);
                this.pendingRequests.delete(response.id);
                if (response.error) {
                  pending.reject(new Error(response.error.message));
                } else {
                  pending.resolve(response.result);
                }
              }
            } catch {
              // Not JSON, ignore (could be log output)
            }
          }
        } catch (err: any) {
          console.error(`[MCP ${name}] stdout data handling error:`, err.message);
        }
      });

      proc.stdout?.on('error', (err: Error) => {
        console.error(`[MCP ${name}] stdout stream error:`, err.message);
      });

      proc.stderr?.on('data', (data: Buffer) => {
        try {
          console.error(`[MCP:${name}:stderr] ${data.toString().trim()}`);
        } catch (err: any) {
          console.error(`[MCP ${name}] stderr data handling error:`, err.message);
        }
      });

      proc.stderr?.on('error', (err: Error) => {
        console.error(`[MCP ${name}] stderr stream error:`, err.message);
      });

      proc.stdin?.on('error', (err: Error) => {
        console.error(`[MCP ${name}] stdin stream error:`, err.message);
      });

      proc.on('exit', (code) => {
        console.log(`[MCP ${name}] Process exited with code ${code}`);
        server.status = 'stopped';
        server.process = null;
        this.buffers.delete(name);
        for (const [id, req] of this.pendingRequests.entries()) {
          if (req.serverName === name) {
            clearTimeout(req.timeout);
            req.reject(new Error(`MCP server '${name}' exited unexpectedly`));
            this.pendingRequests.delete(id);
          }
        }

        // Auto-restart with exponential backoff (max 5 restarts)
        if (server.restartCount < 5) {
          const backoffMs = Math.min(1000 * Math.pow(2, server.restartCount), 60000);
          server.restartCount++;
          console.log(`[MCP ${name}] Scheduling restart #${server.restartCount} in ${backoffMs}ms`);
          setTimeout(() => this.startServer(name), backoffMs);
        } else {
          console.error(`[MCP ${name}] Max restarts (5) exceeded, giving up`);
          server.status = 'error';
          server.lastError = `Server crashed ${server.restartCount} times, not restarting`;
        }
      });

      proc.on('error', (err: Error) => {
        console.error(`[MCP Manager] Process error for "${name}":`, err.message);
        server.status = 'error';
        server.lastError = err.message;
        server.process = null;
        this.buffers.delete(name);
        for (const [id, req] of this.pendingRequests.entries()) {
          if (req.serverName === name) {
            clearTimeout(req.timeout);
            req.reject(new Error(`MCP server '${name}' exited unexpectedly`));
            this.pendingRequests.delete(id);
          }
        }
      });

      // Adaptive startup: poll for readiness with retries instead of blind sleep
      const MAX_RETRIES = 5;
      const RETRY_DELAY_MS = 1500;
      let initialized = false;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));

        // Check if process died during startup
        if (!server.process || server.status === 'error') {
          throw new Error(server.lastError || `Process exited during startup (attempt ${attempt})`);
        }

        try {
          await this.sendRequest(name, 'initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'atlas', version: '1.0.0' },
          });
          initialized = true;
          break;
        } catch (err: any) {
          console.warn(`[MCP ${name}] Initialize attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
          if (attempt === MAX_RETRIES) {
            throw new Error(`Server ${name} failed to initialize after ${MAX_RETRIES} attempts: ${err.message}`);
          }
        }
      }

      if (!initialized) {
        throw new Error(`Server ${name} did not respond to initialize handshake`);
      }

      // Send initialized notification (no id = notification)
      if (server.process?.stdin) {
        const notification = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });
        server.process.stdin.write(notification + '\n');
      }

      server.status = 'running';
      return true;
    } catch (err: any) {
      console.error(`[MCP Manager] Failed to start ${name}:`, err.message);
      server.status = 'error';
      server.lastError = err.message;
      if (server.process) {
        try {
          if (process.platform === 'win32') {
            const { execSync } = require('child_process');
            execSync(`taskkill /pid ${server.process.pid} /T /F`);
          } else {
            server.process.kill();
          }
        } catch (e) { console.warn("Caught error:", e); }
        server.process = null;
      }
      return false;
    }
  }

  /**
   * Start all MCP servers that have credentials configured.
   */
  async startAll(): Promise<void> {
    const startPromises: Promise<boolean>[] = [];
    for (const [name] of this.servers) {
      startPromises.push(this.startServer(name));
    }
    await Promise.allSettled(startPromises);
  }

  async stopServer(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server?.process) return;

    // Try graceful shutdown first
    try {
      if (process.platform === 'win32') {
        const { execSync } = require('child_process');
        execSync(`taskkill /pid ${server.process.pid} /T /F`);
      } else {
        server.process.kill();
      }
    } catch {
      // Already dead
    }

    server.process = null;
    server.status = 'stopped';
  }

  async stopAll(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    for (const [name] of this.servers) {
      await this.stopServer(name);
    }
  }

  // ── JSON-RPC Communication ───────────────────────────────────────────────────

  private sendRequest(name: string, method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const server = this.servers.get(name);
      if (!server?.process?.stdin) {
        reject(new Error(`Server ${name} is not running`));
        return;
      }

      const id = nextId();
      const request: MCPRequest = { jsonrpc: '2.0', id, method, params };

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request timeout for ${name}/${method}`));
      }, 60000);

      this.pendingRequests.set(id, { serverName: name, resolve, reject, timeout });
      
      try {
        server.process.stdin.write(JSON.stringify(request) + '\n', (error) => {
          if (error) {
            clearTimeout(timeout);
            this.pendingRequests.delete(id);
            reject(new Error(`Failed to write request: ${error.message}`));
          }
        });
      } catch (err: any) {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(new Error(`Exception writing request: ${err.message}`));
      }
    });
  }

  // ── Tool Operations ──────────────────────────────────────────────────────────

  async listTools(name: string): Promise<any[]> {
    if (name === 'google_workspace' || name === 'notion') {
      // These use direct API connectors
      return this.getDirectTools(name);
    }
    const server = this.servers.get(name);
    if (!server || server.status !== 'running') {
      const started = await this.startServer(name);
      if (!started) return [];
    }
    try {
      const result = await this.sendRequest(name, 'tools/list');
      return result?.tools || [];
    } catch {
      return [];
    }
  }

  async callTool(serverName: string, toolName: string, args: Record<string, any> = {}): Promise<any> {
    // Handle direct API connectors (Google, Notion)
    if (serverName === 'google_workspace') {
      return this.callGoogleTool(toolName, args);
    }
    if (serverName === 'notion') {
      return this.callNotionTool(toolName, args);
    }

    // MCP server path — auto-start if needed
    const server = this.servers.get(serverName);
    if (!server || server.status !== 'running') {
      const started = await this.startServer(serverName);
      if (!started) {
        if (serverName === 'filesystem') {
          return { error: server?.lastError || 'Local Files connector has no folders configured. Add folder paths in Settings > Integrations > Local Files.' };
        }
        return { error: server?.lastError || `Cannot start ${serverName} server. Check credentials in Settings.` };
      }
    }

    // Auto-fill GitHub owner if missing
    if (serverName === 'github' && !args.owner) {
      const creds = getToken('github') as Record<string, string> | null;
      if (creds?.personal_access_token) {
        try {
          const res = await fetch('https://api.github.com/user', {
            headers: { Authorization: `Bearer ${creds.personal_access_token}` },
          });
          if (res.ok) {
            const user = await res.json();
            args.owner = user.login;
          }
        } catch (e) { console.warn("Caught error:", e); }
      }
    }

    try {
      const result = await this.sendRequest(serverName, 'tools/call', {
        name: toolName,
        arguments: args,
      });
      return result;
    } catch (err: any) {
      return { error: err.message };
    }
  }

  // ── Direct API Connector Methods (Google & Notion) ───────────────────────────

  private async callGoogleTool(tool: string, params: Record<string, any>): Promise<any> {
    if (!(await this.gmailConnector.init())) {
      return { error: 'Google Workspace not configured. Complete OAuth in Settings > Test Connection.' };
    }
    switch (tool) {
      // Read operations
      case 'list_emails':
      case 'search_emails':
      case 'read_emails': return await this.gmailConnector.listEmails(params.maxResults || 10, params.query || '', params.skipCache);
      case 'get_email': return await this.gmailConnector.getEmail(params.messageId);
      case 'list_calendar':
      case 'list_events': return await this.gmailConnector.listCalendarEvents(params.timeMin, params.timeMax);
      // Write operations
      case 'send_email': return await this.gmailConnector.sendEmail(params.to, params.subject, params.body);
      case 'reply_email': return await this.gmailConnector.replyEmail(params.messageId || params.message_id, params.threadId || params.thread_id, params.body);
      case 'forward_email': return await this.gmailConnector.forwardEmail(params.messageId || params.message_id, params.to, params.body);
      case 'list_tasks': return await this.gmailConnector.listTasks();
      case 'create_task': return await this.gmailConnector.createTask(params.listId || params.list_id || '@default', params.title, params.notes, params.due);
      case 'update_task': return await this.gmailConnector.updateTask(params.listId || params.list_id || '@default', params.taskId || params.task_id, params);
      case 'complete_task': return await this.gmailConnector.completeTask(params.listId || params.list_id || '@default', params.taskId || params.task_id);
      case 'create_event':
      case 'schedule_event': return await this.gmailConnector.createCalendarEvent(params.title || params.summary, params.startTime || params.start, params.endTime || params.end, params.description, params.attendees);
      case 'delete_event': return await this.gmailConnector.deleteCalendarEvent(params.eventId || params.event_id);
      default: return { error: `Unknown Google tool: ${tool}` };
    }
  }

  private async callNotionTool(tool: string, params: Record<string, any>): Promise<any> {
    try {
      if (!(await this.notionConnector.init())) {
        return { error: 'Notion not configured. Add your Integration Token in Settings.' };
      }
      switch (tool) {
        // Read operations
        case 'search_pages':
        case 'search': return await this.notionConnector.searchPages(params.query || '');
        case 'get_page': return await this.notionConnector.getPage(params.pageId);
        case 'list_databases': return await this.notionConnector.listDatabases();
        // Write operations
        case 'create_page':
        case 'update_page': {
          let parentId = params.parentId || params.parent_id || (tool === 'update_page' ? params.pageId || params.page_id : '');
          if (!parentId) {
            // Attempt to resolve a default parent page
            const defaultParent = await this.notionConnector.getDefaultParent();
            if (!defaultParent) {
              return { error: 'No Notion page found to use as parent. Please share at least one page with your integration in Notion settings.' };
            }
            parentId = defaultParent;
          }
          return await this.notionConnector.createPage(parentId, params.title, params.content || params.body);
        }
        default: return { error: `Unknown Notion tool: ${tool}` };
      }
    } catch (err: any) {
      return { error: `Notion API Error: ${err.message}` };
    }
  }

  private getDirectTools(name: string): any[] {
    if (name === 'google_workspace') {
      return [
        { name: 'list_emails', description: 'List recent emails' },
        { name: 'search_emails', description: 'Search emails by query' },
        { name: 'get_email', description: 'Get email details by ID' },
        { 
          name: 'send_email', 
          description: 'Send an email to a user. Use this to compose and deliver emails. Always populate the to, subject, and body.',
          inputSchema: {
            type: "object",
            properties: {
              _thinking: { type: "string", description: "Use this field to think step-by-step about who the recipient is, what the subject should be, and what the body should contain before generating the final fields." },
              to: { type: "string", description: "The recipient's email address" },
              subject: { type: "string", description: "The subject line of the email" },
              body: { type: "string", description: "The main content/body of the email" }
            },
            required: ["_thinking", "to", "subject", "body"]
          }
        },
        {
          name: 'reply_email',
          description: 'Reply to an email thread. You must fetch the thread details first to get the messageId and threadId.',
          inputSchema: {
            type: "object",
            properties: {
              _thinking: { type: "string", description: "Think step-by-step about the context of the reply and verify you have the correct messageId before generating the fields." },
              to: { type: "string", description: "The recipient's email address" },
              subject: { type: "string", description: "The subject line of the email, starting with Re:" },
              body: { type: "string", description: "The body of the reply" },
              messageId: { type: "string", description: "The ID of the message being replied to" },
              threadId: { type: "string", description: "The thread ID of the conversation" }
            },
            required: ["_thinking", "to", "subject", "body", "messageId"]
          }
        },
        { name: 'list_calendar', description: 'List today\'s calendar events' },
        {
          name: 'create_event',
          description: 'Create a calendar event. Ensure the times are valid ISO 8601 strings.',
          inputSchema: {
            type: "object",
            properties: {
              _thinking: { type: "string", description: "Think step-by-step to calculate the correct start and end times based on the user's relative prompt (e.g., 'tomorrow at 3pm')." },
              title: { type: "string", description: "Title of the event" },
              startTime: { type: "string", description: "ISO 8601 start time" },
              endTime: { type: "string", description: "ISO 8601 end time" },
              description: { type: "string", description: "Event description/details" },
              attendees: { type: "string", description: "Comma-separated list of attendee emails" }
            },
            required: ["_thinking", "title", "startTime", "endTime"]
          }
        }
      ];
    }
    if (name === 'notion') {
      return [
        { name: 'search_pages', description: 'Search Notion pages' },
        { name: 'get_page', description: 'Get a specific page' },
        { name: 'list_databases', description: 'List Notion databases' },
        { 
          name: 'create_page', 
          description: 'Create a new Notion page with a title and content block.',
          inputSchema: {
            type: "object",
            properties: {
              _thinking: { type: "string", description: "Think step-by-step about what the user wants to document and structure it clearly." },
              title: { type: "string", description: "Title of the new Notion page" },
              content: { type: "string", description: "The content/body of the new page" }
            },
            required: ["_thinking", "title", "content"]
          }
        },
      ];
    }
    return [];
  }

  // ── Status ────────────────────────────────────────────────────────────────────

  getStatus(): MCPServerStatusInfo[] {
    const statuses: MCPServerStatusInfo[] = [];
    for (const [name, server] of this.servers) {
      statuses.push({ name, status: server.status, restartCount: server.restartCount, lastError: server.lastError });
    }
    // Add direct connector statuses
    statuses.push({ name: 'google_workspace', status: 'direct_api' });
    statuses.push({ name: 'notion', status: 'direct_api' });
    return statuses;
  }

  /**
   * Reload configuration — re-reads token store. Call after settings change.
   */
  reloadConfig(): void {
    // Servers will pick up new tokens on next startServer() call via getEnv()
  }

  /**
   * Send a tool call (legacy compatibility with old orchestrator interface).
   * Maps to callTool internally.
   */
  async sendToolCall(
    serverName: string,
    toolName: string,
    params: Record<string, unknown>
  ): Promise<any> {
    return this.callTool(serverName, toolName, params as Record<string, any>);
  }
}
