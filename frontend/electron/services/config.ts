import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

/**
 * Atlas MCP Configuration Manager.
 *
 * Reads/writes a JSON config file from the user's appData directory
 * for storing MCP server tokens, paths, and enablement state.
 *
 * Config file location:
 *   Windows: %APPDATA%/Atlas/mcp-config.json
 *   macOS:   ~/Library/Application Support/Atlas/mcp-config.json
 *   Linux:   ~/.config/Atlas/mcp-config.json
 */

export interface MCPServerConfig {
  enabled: boolean;
  env: Record<string, string>;
  /** Extra command args (e.g., allowed directories for filesystem server) */
  args?: string[];
}

export interface AtlasMCPConfig {
  servers: {
    google_workspace: MCPServerConfig;
    slack: MCPServerConfig;
    notion: MCPServerConfig;
    github: MCPServerConfig;
    filesystem: MCPServerConfig;
  };
}

const DEFAULT_CONFIG: AtlasMCPConfig = {
  servers: {
    google_workspace: {
      enabled: false,
      env: { GOOGLE_CREDENTIALS_PATH: "" },
    },
    slack: {
      enabled: false,
      env: { SLACK_TOKEN: "" },
    },
    notion: {
      enabled: false,
      env: { NOTION_TOKEN: "" },
    },
    github: {
      enabled: false,
      env: { GITHUB_TOKEN: "" },
    },
    filesystem: {
      enabled: false,
      env: {},
      args: [],
    },
  },
};

function getConfigPath(): string {
  const userDataPath = app.getPath("userData");
  return path.join(userDataPath, "mcp-config.json");
}

/**
 * Read the MCP config from disk. Creates a default config if none exists.
 */
export function readConfig(): AtlasMCPConfig {
  const configPath = getConfigPath();

  try {
    if (!fs.existsSync(configPath)) {
      writeConfig(DEFAULT_CONFIG);
      return { ...DEFAULT_CONFIG };
    }

    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AtlasMCPConfig>;

    // Merge with defaults to handle missing keys on upgrade
    return {
      servers: {
        ...DEFAULT_CONFIG.servers,
        ...parsed.servers,
      },
    };
  } catch (err) {
    console.error("[MCP Config] Failed to read config, using defaults:", err);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Write the MCP config to disk.
 */
export function writeConfig(config: AtlasMCPConfig): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  } catch (err) {
    console.error("[MCP Config] Failed to write config:", err);
  }
}

/**
 * Update a specific server's config.
 */
export function updateServerConfig(
  serverName: keyof AtlasMCPConfig["servers"],
  update: Partial<MCPServerConfig>
): AtlasMCPConfig {
  const config = readConfig();
  config.servers[serverName] = {
    ...config.servers[serverName],
    ...update,
  };
  writeConfig(config);
  return config;
}

/**
 * Get the config path for display/debugging purposes.
 */
export function getConfigFilePath(): string {
  return getConfigPath();
}
