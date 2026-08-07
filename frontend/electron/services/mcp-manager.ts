import { ChildProcess, spawn } from "child_process";
import { MCPProtocolHandler, MCPToolResult } from "./mcp-protocol";
import { readConfig, AtlasMCPConfig } from "./config";

/**
 * Atlas MCP Server Manager.
 *
 * Manages stdio-based MCP server subprocesses, handling:
 * - Spawning configured MCP servers (Python, npx-based)
 * - Auto-restart on crash (max 3 retries)
 * - Graceful shutdown (SIGTERM → wait 5s → SIGKILL)
 * - JSON-RPC 2.0 communication via the protocol handler
 * - Status tracking for all servers
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type MCPServerStatus = "running" | "stopped" | "error" | "starting";

export interface MCPServerState {
  name: string;
  process: ChildProcess | null;
  protocol: MCPProtocolHandler | null;
  command: string;
  args: string[];
  status: MCPServerStatus;
  env: Record<string, string>;
  restartCount: number;
  maxRestarts: number;
  lastError?: string;
}

export interface MCPServerStatusInfo {
  name: string;
  status: MCPServerStatus;
  restartCount: number;
  lastError?: string;
}

// ── Server Definitions ─────────────────────────────────────────────────────────

interface ServerDefinition {
  command: string;
  args: string[];
  envKeys: string[];
  /** Extra args from config (e.g., filesystem allowed dirs) */
  usesConfigArgs?: boolean;
}

/**
 * Platform-aware command resolution.
 * On Windows, npx needs to be invoked via cmd.exe or with .cmd extension.
 */
function getNpxCommand(): string {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function getPythonCommand(): string {
  return process.platform === "win32" ? "python" : "python3";
}

const SERVER_DEFINITIONS: Record<string, ServerDefinition> = {
  google_workspace: {
    command: getPythonCommand(),
    args: ["-m", "mcp_google_workspace"],
    envKeys: ["GOOGLE_CREDENTIALS_PATH"],
  },
  slack: {
    command: getNpxCommand(),
    args: ["-y", "@anthropic/mcp-server-slack"],
    envKeys: ["SLACK_TOKEN"],
  },
  notion: {
    command: getNpxCommand(),
    args: ["-y", "@anthropic/mcp-server-notion"],
    envKeys: ["NOTION_TOKEN"],
  },
  github: {
    command: getNpxCommand(),
    args: ["-y", "@anthropic/mcp-server-github"],
    envKeys: ["GITHUB_TOKEN"],
  },
  filesystem: {
    command: getNpxCommand(),
    args: ["-y", "@anthropic/mcp-server-filesystem"],
    envKeys: [],
    usesConfigArgs: true,
  },
};

// ── Manager Class ──────────────────────────────────────────────────────────────

export type ToolResponseCallback = (
  serverName: string,
  toolName: string,
  result: MCPToolResult
) => void;

export class MCPServerManager {
  private servers: Map<string, MCPServerState> = new Map();
  private responseCallbacks: ToolResponseCallback[] = [];
  private shuttingDown = false;

  constructor() {
    this.initializeServerStates();
  }

  /**
   * Initialize server state entries from config on disk.
   */
  private initializeServerStates(): void {
    const config = readConfig();

    for (const [name, definition] of Object.entries(SERVER_DEFINITIONS)) {
      const serverConfig = config.servers[name as keyof AtlasMCPConfig["servers"]];
      const env: Record<string, string> = {};

      // Pull env vars from config
      if (serverConfig) {
        for (const key of definition.envKeys) {
          if (serverConfig.env[key]) {
            env[key] = serverConfig.env[key];
          }
        }
      }

      // Build args — include config-specified extra args (like filesystem dirs)
      const args = [...definition.args];
      if (definition.usesConfigArgs && serverConfig?.args) {
        args.push(...serverConfig.args);
      }

      this.servers.set(name, {
        name,
        process: null,
        protocol: null,
        command: definition.command,
        args,
        status: "stopped",
        env,
        restartCount: 0,
        maxRestarts: 3,
      });
    }
  }

  /**
   * Reload configuration from disk (e.g., after user changes settings).
   */
  reloadConfig(): void {
    const config = readConfig();

    for (const [name, definition] of Object.entries(SERVER_DEFINITIONS)) {
      const serverConfig = config.servers[name as keyof AtlasMCPConfig["servers"]];
      const state = this.servers.get(name);
      if (!state || !serverConfig) continue;

      // Update env
      const env: Record<string, string> = {};
      for (const key of definition.envKeys) {
        if (serverConfig.env[key]) {
          env[key] = serverConfig.env[key];
        }
      }
      state.env = env;

      // Update args
      const args = [...definition.args];
      if (definition.usesConfigArgs && serverConfig.args) {
        args.push(...serverConfig.args);
      }
      state.args = args;
    }
  }

  // ── Start / Stop ─────────────────────────────────────────────────────────────

  /**
   * Start all enabled MCP servers based on config.
   */
  async startAll(): Promise<void> {
    const config = readConfig();
    const startPromises: Promise<void>[] = [];

    for (const [name, serverConfig] of Object.entries(config.servers)) {
      if (serverConfig.enabled) {
        startPromises.push(this.startServer(name));
      }
    }

    await Promise.allSettled(startPromises);
  }

  /**
   * Start a specific MCP server by name.
   */
  async startServer(name: string): Promise<void> {
    const state = this.servers.get(name);
    if (!state) {
      throw new Error(`[MCP Manager] Unknown server: ${name}`);
    }

    if (state.status === "running" && state.process && !state.process.killed) {
      console.log(`[MCP Manager] Server "${name}" is already running`);
      return;
    }

    state.status = "starting";
    state.restartCount = 0;
    state.lastError = undefined;

    await this.spawnServer(state);
  }

  /**
   * Stop all running MCP servers gracefully.
   */
  async stopAll(): Promise<void> {
    this.shuttingDown = true;
    const stopPromises: Promise<void>[] = [];

    for (const [name] of this.servers) {
      stopPromises.push(this.stopServer(name));
    }

    await Promise.allSettled(stopPromises);
    this.shuttingDown = false;
  }

  /**
   * Stop a specific MCP server by name.
   */
  async stopServer(name: string): Promise<void> {
    const state = this.servers.get(name);
    if (!state) {
      throw new Error(`[MCP Manager] Unknown server: ${name}`);
    }

    if (!state.process || state.process.killed) {
      state.status = "stopped";
      state.process = null;
      state.protocol?.detach();
      state.protocol = null;
      return;
    }

    // Detach protocol handler
    state.protocol?.detach();
    state.protocol = null;

    await this.gracefulKill(state);
    state.status = "stopped";
  }

  // ── Status ────────────────────────────────────────────────────────────────────

  /**
   * Get status of all servers.
   */
  getStatus(): MCPServerStatusInfo[] {
    const statuses: MCPServerStatusInfo[] = [];
    for (const [, state] of this.servers) {
      statuses.push({
        name: state.name,
        status: state.status,
        restartCount: state.restartCount,
        lastError: state.lastError,
      });
    }
    return statuses;
  }

  // ── Tool Calls ────────────────────────────────────────────────────────────────

  /**
   * Send a tool call to a specific server.
   */
  async sendToolCall(
    serverName: string,
    toolName: string,
    params: Record<string, unknown>
  ): Promise<MCPToolResult> {
    const state = this.servers.get(serverName);
    if (!state) {
      throw new Error(`[MCP Manager] Unknown server: ${serverName}`);
    }
    if (state.status !== "running" || !state.protocol) {
      throw new Error(`[MCP Manager] Server "${serverName}" is not running`);
    }

    const result = await state.protocol.callTool(toolName, params);

    // Notify callbacks
    for (const cb of this.responseCallbacks) {
      try {
        cb(serverName, toolName, result);
      } catch (err) {
        console.error("[MCP Manager] Tool response callback error:", err);
      }
    }

    return result;
  }

  /**
   * List tools available on a specific server.
   */
  async listTools(serverName: string): Promise<Array<{ name: string; description: string }>> {
    const state = this.servers.get(serverName);
    if (!state) {
      throw new Error(`[MCP Manager] Unknown server: ${serverName}`);
    }
    if (state.status !== "running" || !state.protocol) {
      throw new Error(`[MCP Manager] Server "${serverName}" is not running`);
    }

    const response = await state.protocol.listTools();
    return (response.tools || []).map((tool) => ({
      name: tool.name,
      description: tool.description || "",
    }));
  }

  /**
   * Register a callback for tool responses.
   */
  onToolResponse(callback: ToolResponseCallback): () => void {
    this.responseCallbacks.push(callback);
    return () => {
      const idx = this.responseCallbacks.indexOf(callback);
      if (idx >= 0) this.responseCallbacks.splice(idx, 1);
    };
  }

  // ── Internal: Spawn & Lifecycle ──────────────────────────────────────────────

  /**
   * Spawn the child process for an MCP server.
   */
  private async spawnServer(state: MCPServerState): Promise<void> {
    try {
      const mergedEnv: Record<string, string> = {
        ...process.env as Record<string, string>,
        ...state.env,
      };

      console.log(
        `[MCP Manager] Spawning "${state.name}": ${state.command} ${state.args.join(" ")}`
      );

      const child = spawn(state.command, state.args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: mergedEnv,
        // On Windows, use shell to resolve .cmd files and PATH
        shell: process.platform === "win32",
        // Don't throw on ENOENT — we handle it in the error event
        windowsHide: true,
      });

      state.process = child;

      // Set up protocol handler
      const protocol = new MCPProtocolHandler();
      protocol.attach(child);
      state.protocol = protocol;

      // Handle stderr (logging)
      child.stderr?.on("data", (data: Buffer) => {
        const text = data.toString("utf-8").trim();
        if (text) {
          console.log(`[MCP:${state.name}:stderr] ${text}`);
        }
      });

      // Handle process errors (e.g., ENOENT if command not found)
      child.on("error", (err: Error) => {
        console.error(`[MCP Manager] Process error for "${state.name}":`, err.message);
        state.status = "error";
        state.lastError = err.message;
        state.process = null;
        state.protocol?.detach();
        state.protocol = null;
      });

      // Handle process exit
      child.on("exit", (code, signal) => {
        console.log(
          `[MCP Manager] Server "${state.name}" exited with code=${code}, signal=${signal}`
        );

        state.process = null;
        state.protocol?.detach();
        state.protocol = null;

        // Don't restart if we're shutting down or manually stopped
        if (this.shuttingDown || state.status === "stopped") {
          return;
        }

        state.status = "error";
        state.lastError = `Process exited with code ${code}`;

        // Auto-restart if under max retries
        if (state.restartCount < state.maxRestarts) {
          state.restartCount++;
          console.log(
            `[MCP Manager] Auto-restarting "${state.name}" (attempt ${state.restartCount}/${state.maxRestarts})`
          );
          // Delay restart slightly to avoid tight loops
          setTimeout(() => {
            if (state.status !== "stopped" && !this.shuttingDown) {
              this.spawnServer(state).catch((err) => {
                console.error(`[MCP Manager] Restart failed for "${state.name}":`, err);
              });
            }
          }, 1000 * state.restartCount); // Exponential backoff: 1s, 2s, 3s
        } else {
          console.error(
            `[MCP Manager] Server "${state.name}" exceeded max restarts (${state.maxRestarts})`
          );
        }
      });

      // Wait briefly for the process to start (check it didn't immediately die)
      await new Promise<void>((resolve, reject) => {
        const startTimeout = setTimeout(() => {
          // If process is still alive after 2s, consider it started
          if (child.killed || state.status === "error") {
            reject(new Error(`Server "${state.name}" failed to start`));
          } else {
            resolve();
          }
        }, 2000);

        child.on("error", () => {
          clearTimeout(startTimeout);
          reject(new Error(`Server "${state.name}" failed to spawn`));
        });

        // If process exits in the first 2s, it failed to start
        child.on("exit", (code) => {
          if (code !== null && code !== 0) {
            clearTimeout(startTimeout);
            reject(new Error(`Server "${state.name}" exited immediately with code ${code}`));
          }
        });
      });

      // Perform MCP initialization handshake
      try {
        await protocol.initialize();
        protocol.sendInitialized();
        state.status = "running";
        console.log(`[MCP Manager] Server "${state.name}" initialized successfully`);
      } catch (err) {
        console.error(
          `[MCP Manager] MCP handshake failed for "${state.name}":`,
          (err as Error).message
        );
        state.status = "error";
        state.lastError = `MCP handshake failed: ${(err as Error).message}`;
        // Kill the process since it can't be used
        await this.gracefulKill(state);
      }
    } catch (err) {
      state.status = "error";
      state.lastError = (err as Error).message;
      console.error(`[MCP Manager] Failed to spawn "${state.name}":`, (err as Error).message);
    }
  }

  /**
   * Gracefully kill a process: SIGTERM first, then SIGKILL after 5 seconds.
   */
  private gracefulKill(state: MCPServerState): Promise<void> {
    return new Promise((resolve) => {
      const child = state.process;
      if (!child || child.killed) {
        state.process = null;
        resolve();
        return;
      }

      let resolved = false;
      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          state.process = null;
          resolve();
        }
      };

      child.on("exit", cleanup);

      // On Windows, there's no SIGTERM; we use taskkill or just kill the tree
      if (process.platform === "win32") {
        try {
          // child.kill() on Windows sends a terminate signal
          child.kill();
        } catch {
          // Already dead
        }
      } else {
        try {
          child.kill("SIGTERM");
        } catch {
          // Already dead
        }
      }

      // Force kill after 5 seconds if still alive
      const forceKillTimer = setTimeout(() => {
        if (!child.killed) {
          console.warn(`[MCP Manager] Force killing "${state.name}" after 5s timeout`);
          try {
            child.kill("SIGKILL");
          } catch {
            // Already dead
          }
        }
        cleanup();
      }, 5000);

      // Clean up timer if process exits naturally
      child.on("exit", () => {
        clearTimeout(forceKillTimer);
      });
    });
  }
}
