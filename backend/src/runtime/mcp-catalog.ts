import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface McpServerRecord {
  name: string;
  enabled: boolean;
  origin: string;
  description: string;
  definition: Record<string, unknown>;
}

const SECRET_KEYS = new Set(["headers", "env", "bearerToken", "oauth"]);

/** Same merge order as pi-mcp-adapter: later files win. */
function mcpConfigPaths(cwd: string, agentDir: string): string[] {
  return [
    join(homedir(), ".config", "mcp", "mcp.json"),
    join(homedir(), ".agents", "mcp.json"),
    join(homedir(), ".agents", "mcp", "mcp.json"),
    join(agentDir, "mcp.json"),
    join(cwd, ".mcp.json"),
    join(cwd, ".pi", "mcp.json"),
  ];
}

function readServers(path: string): Record<string, Record<string, unknown>> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { mcpServers?: unknown };
    const servers = raw.mcpServers;
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) return undefined;
    const out: Record<string, Record<string, unknown>> = {};
    for (const [name, entry] of Object.entries(servers as Record<string, unknown>)) {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        out[name] = entry as Record<string, unknown>;
      }
    }
    return out;
  } catch {
    return undefined;
  }
}

function describeServer(def: Record<string, unknown>): string {
  if (typeof def.url === "string" && def.url) return `HTTP ${def.url}`;
  if (typeof def.command === "string" && def.command) {
    const args = Array.isArray(def.args) ? def.args.map(String).join(" ") : "";
    return args ? `stdio ${def.command} ${args}` : `stdio ${def.command}`;
  }
  if (typeof def.socket === "string" && def.socket) return `socket ${def.socket}`;
  return "MCP server";
}

function redact(value: unknown, key?: string): unknown {
  if (key && SECRET_KEYS.has(key) && value && typeof value === "object") {
    if (key === "bearerToken" || typeof value !== "object") return "••••";
    if (Array.isArray(value)) return value.map((item) => redact(item));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = typeof v === "string" ? "••••" : redact(v, k);
    }
    return out;
  }
  if (key === "bearerToken" && typeof value === "string") return "••••";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redact(v, k);
    }
    return out;
  }
  return value;
}

export function listMcpServers(cwd: string, agentDir: string): McpServerRecord[] {
  const merged = new Map<string, { def: Record<string, unknown>; path: string }>();
  for (const path of mcpConfigPaths(cwd, agentDir)) {
    const servers = readServers(resolve(path));
    if (!servers) continue;
    for (const [name, def] of Object.entries(servers)) {
      merged.set(name, { def, path });
    }
  }
  return [...merged.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, { def, path }]) => ({
      name,
      enabled: def.disabled !== true,
      origin: path,
      description: describeServer(def),
      definition: redact(def) as Record<string, unknown>,
    }));
}
