import type {
  ChatMessage,
  PluginDetail,
  PluginSummary,
  ProviderWireConfig,
  RuntimeEvent,
  RuntimeInfo,
} from "@pi-debug/shared";

export interface RegisteredTool {
  id: string;
  name: string;
  description: string;
  origin?: string;
  enabled?: boolean;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<{ text: string; data?: unknown }>;
}

export interface RegisteredSkill {
  id: string;
  name: string;
  description: string;
  origin?: string;
  enabled?: boolean;
  filePath?: string;
  content: string;
}

export interface RegisteredPlugin {
  id: string;
  name: string;
  kind: "scp" | "other";
  description: string;
  origin?: string;
  enabled?: boolean;
  content?: string;
  contentLanguage?: PluginDetail["contentLanguage"];
  schema?: Record<string, unknown>;
  filePath?: string;
}

export interface RunTurnInput {
  sessionId: string;
  runId: string;
  messages: ChatMessage[];
  pluginIds?: string[];
  provider: ProviderWireConfig | null;
  systemPrompt?: string;
  abortSignal: AbortSignal;
}

/**
 * Adapter every backend runtime must implement.
 *
 * Swap `StubRuntime` for a wrapper around `@earendil-works/pi-agent-core`
 * (`Agent` from `/Users/boyn/code/pi-mono`) without changing HTTP routes:
 *
 *   runtime.registerTool(...)   → Agent tools[]
 *   runtime.registerSkill(...)  → loadSkills / skillsOverride
 *   runtime.runTurn(...)        → agent.prompt() + agent.subscribe(events)
 *
 * Event mapping (pi-agent-core → RuntimeEvent):
 *   runTurn                     → one Round (user → final assistant)
 *   PI turn_start / turn_end    → Turns inside that Round
 *   agent_start / turn_start    → trajectory run_start / turn_start
 *   message_update text_delta   → message_delta field=content
 *   thinking / reasoning        → message_delta field=thinking + trajectory thinking
 *   tool_execution_start        → tool_call + trajectory tool_call
 *   tool_execution_end          → tool_result + trajectory tool_result
 *   agent_end                   → run_end
 */
export interface AgentRuntime {
  readonly name: string;
  registerTool(tool: RegisteredTool): void;
  registerSkill(skill: RegisteredSkill): void;
  registerPlugin(plugin: RegisteredPlugin): void;
  listPlugins(): PluginSummary[];
  getPlugin(id: string): PluginDetail | undefined;
  runTurn(input: RunTurnInput): AsyncIterable<RuntimeEvent>;
  stop(sessionId: string): void;
  /** Rescan skills / tools / extensions from disk. Browser Refresh should call this. */
  reload(): Promise<void>;
  info(): RuntimeInfo;
}
