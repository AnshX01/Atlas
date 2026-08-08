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
}

interface MCPServer {
  name: string;
  process: ChildProcess | null;
  status: 'stopped' | 'starting' | 'running' | 'error';
  restartCount: number;
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
  private pendingRequests: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timeout: NodeJS.Timeout }> = new Map();
  private buffers: Map<string, string> = new Map();

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
        if (!creds?.bot_token) return null;
        return { SLACK_BOT_TOKEN: creds.bot_token };
      },
    });

    this.defineServer('filesystem', {
      name: 'filesystem',
      command: npxPath,
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      env: {},
      getEnv: () => {
        const creds = getToken('local_fs') as Record<string, string> | null;
        if (!creds?.watch_paths && !creds?.paths) return null;
        const paths = (creds.watch_paths || creds.paths || '').split('\n').filter(Boolean);
        if (paths.length === 0) return null;
        // Filesystem server takes paths as additional args
        return { FS_PATHS: paths.join(',') };
      },
    });

    console.log('[MCP Manager] Initialized with servers: github, slack, filesystem, google_workspace (direct), notion (direct)');
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

    const env = server.config.getEnv();
    if (!env) {
      console.warn(`[MCP Manager] Cannot start ${name} - no credentials configured`);
      return false;
    }

    server.status = 'starting';

    try {
      const proc = spawn(server.config.command, server.config.args, {
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        windowsHide: true,
      });

      server.process = proc;
      this.buffers.set(name, '');

      proc.stdout?.on('data', (data: Buffer) => {
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
      });

      proc.stderr?.on('data', (data: Buffer) => {
        console.error(`[MCP ${name}] stderr:`, data.toString().trim());
      });

      proc.on('exit', (code) => {
        console.log(`[MCP ${name}] Process exited with code ${code}`);
        server.status = 'stopped';
        server.process = null;
      });

      proc.on('error', (err: Error) => {
        console.error(`[MCP Manager] Process error for "${name}":`, err.message);
        server.status = 'error';
        server.process = null;
      });

      // Wait a moment for startup
      await new Promise(r => setTimeout(r, 2000));

      // Initialize the MCP server with handshake
      await this.sendRequest(name, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'atlas', version: '1.0.0' },
      });

      // Send initialized notification (no id = notification)
      if (server.process?.stdin) {
        const notification = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });
        server.process.stdin.write(notification + '\n');
      }

      server.status = 'running';
      console.log(`[MCP Manager] Server ${name} started successfully`);
      return true;
    } catch (err: any) {
      console.error(`[MCP Manager] Failed to start ${name}:`, err.message);
      server.status = 'error';
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
      server.process.kill();
    } catch {
      // Already dead
    }

    server.process = null;
    server.status = 'stopped';
    console.log(`[MCP Manager] Server ${name} stopped`);
  }

  async stopAll(): Promise<void> {
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
      }, 30000);

      this.pendingRequests.set(id, { resolve, reject, timeout });
      server.process.stdin.write(JSON.stringify(request) + '\n');
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
      if (!started) return { error: `Cannot start ${serverName} server. Check credentials in Settings.` };
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
      case 'list_emails':
      case 'search_emails':
      case 'read_emails': return await this.gmailConnector.listEmails(params.maxResults || 10, params.query || '');
      case 'get_email': return await this.gmailConnector.getEmail(params.messageId);
      case 'send_email': return await this.gmailConnector.sendEmail(params.to, params.subject, params.body);
      case 'list_calendar':
      case 'list_events': return await this.gmailConnector.listCalendarEvents();
      default: return { error: `Unknown Google tool: ${tool}` };
    }
  }

  private async callNotionTool(tool: string, params: Record<string, any>): Promise<any> {
    if (!(await this.notionConnector.init())) {
      return { error: 'Notion not configured. Add your Integration Token in Settings.' };
    }
    switch (tool) {
      case 'search_pages':
      case 'search': return await this.notionConnector.searchPages(params.query || '');
      case 'get_page': return await this.notionConnector.getPage(params.pageId);
      case 'list_databases': return await this.notionConnector.listDatabases();
      case 'create_page': return await this.notionConnector.createPage(params.parentId, params.title, params.content);
      default: return { error: `Unknown Notion tool: ${tool}` };
    }
  }

  private getDirectTools(name: string): any[] {
    if (name === 'google_workspace') {
      return [
        { name: 'list_emails', description: 'List recent emails' },
        { name: 'search_emails', description: 'Search emails by query' },
        { name: 'get_email', description: 'Get email details by ID' },
        { name: 'send_email', description: 'Send an email' },
        { name: 'list_calendar', description: 'List today\'s calendar events' },
      ];
    }
    if (name === 'notion') {
      return [
        { name: 'search_pages', description: 'Search Notion pages' },
        { name: 'get_page', description: 'Get a specific page' },
        { name: 'list_databases', description: 'List Notion databases' },
        { name: 'create_page', description: 'Create a new Notion page' },
      ];
    }
    return [];
  }

  // ── Status ────────────────────────────────────────────────────────────────────

  getStatus(): MCPServerStatusInfo[] {
    const statuses: MCPServerStatusInfo[] = [];
    for (const [name, server] of this.servers) {
      statuses.push({ name, status: server.status, restartCount: server.restartCount });
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
    console.log('[MCP Manager] Config reload requested');
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
