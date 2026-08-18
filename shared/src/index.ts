export type PluginKind = "skill" | "tool" | "scp" | "other";
export type PluginSource = "backend" | "client" | "session";

export interface PluginSummary {
  id: string;
  name: string;
  kind: PluginKind;
  source: PluginSource;
  enabled: boolean;
  description: string;
  origin?: string;
}

export interface PluginDetail extends PluginSummary {
  schema?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  content?: string;
  contentLanguage?: "markdown" | "json" | "text" | "typescript";
  filePath?: string;
}

export type ProviderType = "openai-compatible" | "anthropic" | "custom";

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
}

/** Wire shape sent to the backend. Keys must never be logged. */
export interface ProviderWireConfig {
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export type ChatRole = "user" | "assistant" | "system" | "tool";

export type ToolCallStatus = "pending" | "running" | "ok" | "error";

export interface ToolCallCard {
  id: string;
  name: string;
  args: unknown;
  status: ToolCallStatus;
  resultSnippet?: string;
  result?: unknown;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  thinking?: string;
  toolCalls?: ToolCallCard[];
  toolCallId?: string;
  trajectoryIds: string[];
}

export type TrajectoryEventType =
  | "run_start"
  | "run_end"
  | "turn_start"
  | "turn_end"
  | "thinking"
  | "text"
  | "skill_load"
  | "tool_call"
  | "tool_result"
  | "context"
  | "error";

export interface TrajectoryEvent {
  id: string;
  type: TrajectoryEventType;
  ts: number;
  runId: string;
  turnId?: string;
  messageId?: string;
  title: string;
  detail?: string;
  payload?: unknown;
  durationMs?: number;
}

export interface RunRequest {
  sessionId: string;
  messages: ChatMessage[];
  pluginIds?: string[];
  provider: ProviderWireConfig | null;
  systemPrompt?: string;
}

export type RuntimeEvent =
  | { type: "run_start"; runId: string; ts: number }
  | { type: "run_end"; runId: string; ts: number; outcome: "completed" | "aborted" | "failed"; error?: string }
  | { type: "message_start"; message: ChatMessage }
  | { type: "message_delta"; messageId: string; field: "content" | "thinking"; delta: string }
  | { type: "message_end"; message: ChatMessage }
  | { type: "tool_call"; messageId: string; toolCall: ToolCallCard }
  | { type: "tool_result"; messageId: string; toolCall: ToolCallCard }
  | { type: "trajectory"; event: TrajectoryEvent }
  | { type: "error"; message: string };

export interface HealthResponse {
  ok: true;
  runtime: string;
  version: string;
}

export interface RuntimeInfo {
  name: string;
  cwd: string;
  agentDir: string;
  skillDirs: string[];
  reloadedAt: number;
}

export interface PluginListResponse {
  plugins: PluginSummary[];
  runtime: string;
  info?: RuntimeInfo;
}
