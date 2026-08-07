import { ChildProcess } from "child_process";

/**
 * MCP Protocol Handler — JSON-RPC 2.0 over stdio.
 *
 * MCP servers communicate via newline-delimited JSON-RPC 2.0 messages
 * over stdin (requests) and stdout (responses).
 *
 * This module handles:
 * - Sending JSON-RPC requests to a child process stdin
 * - Reading and buffering JSON-RPC responses from stdout
 * - Matching responses to requests via request IDs
 * - Handling partial reads (buffer until newline)
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: JSONRPCError;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

export interface MCPListToolsResponse {
  tools: MCPTool[];
}

export interface MCPToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolResult {
  content: Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

// ── Protocol Handler ───────────────────────────────────────────────────────────

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class MCPProtocolHandler {
  private nextId = 1;
  private pending: Map<number | string, PendingRequest> = new Map();
  private buffer = "";
  private process: ChildProcess | null = null;
  private readonly timeout: number;

  /**
   * @param timeoutMs - Timeout for individual requests in milliseconds (default: 30s)
   */
  constructor(timeoutMs = 30_000) {
    this.timeout = timeoutMs;
  }

  /**
   * Attach to a child process. Sets up stdout data listener for parsing responses.
   */
  attach(childProcess: ChildProcess): void {
    this.process = childProcess;
    this.buffer = "";

    if (!childProcess.stdout) {
      throw new Error("[MCP Protocol] Child process has no stdout stream");
    }

    childProcess.stdout.on("data", (data: Buffer) => {
      this.onData(data.toString("utf-8"));
    });

    // If process exits, reject all pending requests
    childProcess.on("exit", () => {
      this.rejectAllPending(new Error("MCP server process exited"));
    });
  }

  /**
   * Detach from the current process and reject any pending requests.
   */
  detach(): void {
    this.rejectAllPending(new Error("MCP protocol handler detached"));
    this.process = null;
    this.buffer = "";
  }

  /**
   * Send a JSON-RPC request and wait for the matching response.
   */
  sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.process || !this.process.stdin || this.process.killed) {
      return Promise.reject(new Error("[MCP Protocol] No active process to send request to"));
    }

    const id = this.nextId++;
    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params !== undefined && { params }),
    };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`[MCP Protocol] Request timed out after ${this.timeout}ms: ${method}`));
      }, this.timeout);

      this.pending.set(id, { resolve, reject, timer });

      const message = JSON.stringify(request) + "\n";

      try {
        this.process!.stdin!.write(message, "utf-8", (err) => {
          if (err) {
            this.pending.delete(id);
            clearTimeout(timer);
            reject(new Error(`[MCP Protocol] Failed to write to stdin: ${err.message}`));
          }
        });
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error(`[MCP Protocol] Write error: ${(err as Error).message}`));
      }
    });
  }

  /**
   * Send `initialize` handshake required by MCP spec.
   */
  async initialize(): Promise<unknown> {
    return this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "atlas-desktop",
        version: "1.0.0",
      },
    });
  }

  /**
   * Send `initialized` notification (no response expected).
   */
  sendInitialized(): void {
    if (!this.process || !this.process.stdin || this.process.killed) {
      return;
    }
    const notification = JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }) + "\n";

    this.process.stdin.write(notification, "utf-8");
  }

  /**
   * List available tools from the MCP server.
   */
  async listTools(): Promise<MCPListToolsResponse> {
    const result = await this.sendRequest("tools/list", {});
    return result as MCPListToolsResponse;
  }

  /**
   * Call a specific tool on the MCP server.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    const result = await this.sendRequest("tools/call", {
      name,
      arguments: args,
    });
    return result as MCPToolResult;
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  /**
   * Handle incoming data from stdout. Buffers partial messages until a full
   * newline-delimited JSON message is received.
   */
  private onData(chunk: string): void {
    this.buffer += chunk;

    // Process all complete lines
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line.length === 0) continue;

      try {
        const response = JSON.parse(line) as JSONRPCResponse;
        this.handleResponse(response);
      } catch {
        // Not valid JSON — could be log output from the server, ignore
        console.warn("[MCP Protocol] Non-JSON line from server:", line.slice(0, 200));
      }
    }
  }

  /**
   * Route a parsed JSON-RPC response to the matching pending request.
   */
  private handleResponse(response: JSONRPCResponse): void {
    // Notifications (no id) are ignored for now
    if (response.id === null || response.id === undefined) {
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
      console.warn("[MCP Protocol] Received response for unknown request ID:", response.id);
      return;
    }

    this.pending.delete(response.id);
    clearTimeout(pending.timer);

    if (response.error) {
      pending.reject(
        new Error(`[MCP] ${response.error.message} (code: ${response.error.code})`)
      );
    } else {
      pending.resolve(response.result);
    }
  }

  /**
   * Reject all pending requests (called on process exit or detach).
   */
  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}
