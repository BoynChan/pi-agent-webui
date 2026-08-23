import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type {
  ChatMessage,
  PluginDetail,
  PluginSummary,
  RuntimeEvent,
  RuntimeInfo,
  ToolCallCard,
  TrajectoryEvent,
  TrajectoryEventType,
} from "@pi-debug/shared";
import { EventPump } from "./event-pump.ts";
import { historyToAgentMessages, lastUserText } from "./pi-messages.ts";
import { modelFromProvider, placeholderModel } from "./pi-model.ts";
import { PluginRegistry } from "./plugin-registry.ts";
import type {
  AgentRuntime,
  RegisteredPlugin,
  RegisteredSkill,
  RegisteredTool,
  RunTurnInput,
} from "./types.ts";

function now(): number {
  return Date.now();
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function tryRealpath(path: string): string {
  const resolved = resolve(path);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved.replace(/[/\\]+$/, "") || resolved;
  }
}

/** True if `filePath` is `dir` or a descendant. Handles trailing slashes and symlinks. */
function isUnderDir(filePath: string, dir: string): boolean {
  const root = tryRealpath(dir);
  const target = tryRealpath(filePath);
  if (target === root) return true;
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return target.startsWith(prefix);
}

function defaultCwd(): string {
  const fromEnv = process.env.PI_DEBUG_CWD?.trim();
  if (fromEnv) return resolve(fromEnv);
  const cwd = process.cwd();
  // `pnpm --dir backend dev` starts inside packages/backend; coding tools should see the repo root.
  if (cwd.endsWith("/backend") && existsSync(join(cwd, "..", "pnpm-workspace.yaml"))) {
    return resolve(cwd, "..");
  }
  return cwd;
}

export async function createPiRuntime(): Promise<PiAgentRuntime> {
  const runtime = new PiAgentRuntime();
  await runtime.init();
  return runtime;
}

export class PiAgentRuntime implements AgentRuntime {
  readonly name = "pi";
  private readonly overlays = new PluginRegistry();
  private readonly piCatalog = new PluginRegistry();
  private readonly controllers = new Map<string, AbortController>();
  private session: AgentSession | undefined;
  private resourceLoader: DefaultResourceLoader | undefined;
  private modelRuntime: ModelRuntime | undefined;
  private cwd = process.cwd();
  private agentDir = "";
  private skillDirs: string[] = [];
  private reloadedAt = 0;
  private ready: Promise<void> | undefined;

  async init(): Promise<void> {
    this.cwd = defaultCwd();
    this.agentDir = process.env.PI_AGENT_DIR?.trim()
      ? resolve(process.env.PI_AGENT_DIR)
      : getAgentDir();
    const skillsDir = join(this.agentDir, "skills");
    this.skillDirs = [skillsDir];

    this.modelRuntime = await ModelRuntime.create({ refreshOnCreate: false });
    const settingsManager = SettingsManager.create(this.cwd, this.agentDir);
    this.resourceLoader = new DefaultResourceLoader({
      cwd: this.cwd,
      agentDir: this.agentDir,
      settingsManager,
      noSkills: true,
      additionalSkillPaths: [skillsDir],
      skillsOverride: (current) => ({
        skills: current.skills.filter((skill) => isUnderDir(skill.filePath, skillsDir)),
        diagnostics: current.diagnostics,
      }),
    });
    await this.resourceLoader.reload();

    const created = await createAgentSession({
      cwd: this.cwd,
      agentDir: this.agentDir,
      modelRuntime: this.modelRuntime,
      resourceLoader: this.resourceLoader,
      settingsManager,
      sessionManager: SessionManager.inMemory(this.cwd),
      model: placeholderModel(),
    });
    this.session = created.session;
    await this.session.bindExtensions({ mode: "print" }).catch((error: unknown) => {
      console.warn("PI bindExtensions:", error instanceof Error ? error.message : error);
    });
    this.enableDiscoveredTools();
    this.syncCatalog();
    this.ready = Promise.resolve();
    console.log(
      `PI runtime cwd=${this.cwd} agentDir=${this.agentDir} skills=${this.piCatalog.list().filter((p) => p.kind === "skill").length} tools=${this.piCatalog.list().filter((p) => p.kind === "tool").length}`,
    );
  }

  info(): RuntimeInfo {
    return {
      name: this.name,
      cwd: this.cwd,
      agentDir: this.agentDir,
      skillDirs: this.skillDirs,
      reloadedAt: this.reloadedAt,
    };
  }

  registerTool(tool: RegisteredTool): void {
    this.overlays.registerTool(tool);
  }

  registerSkill(skill: RegisteredSkill): void {
    this.overlays.registerSkill(skill);
  }

  registerPlugin(plugin: RegisteredPlugin): void {
    this.overlays.registerPlugin(plugin);
  }

  listPlugins(): PluginSummary[] {
    return [...this.piCatalog.list(), ...this.overlays.list()];
  }

  getPlugin(pluginId: string): PluginDetail | undefined {
    return this.piCatalog.get(pluginId) ?? this.overlays.get(pluginId);
  }

  stop(sessionId: string): void {
    this.controllers.get(sessionId)?.abort();
    void this.session?.abort();
  }

  async reload(): Promise<void> {
    if (!this.session || !this.resourceLoader) {
      await this.init();
      return;
    }
    await this.session.reload();
    this.enableDiscoveredTools();
    this.syncCatalog();
  }

  async *runTurn(input: RunTurnInput): AsyncIterable<RuntimeEvent> {
    await this.ready;
    if (!this.session || !this.modelRuntime) {
      yield { type: "error", message: "PI runtime is not initialized." };
      return;
    }

    const existing = this.controllers.get(input.sessionId);
    existing?.abort();
    const controller = new AbortController();
    this.controllers.set(input.sessionId, controller);
    const signal = abortAny(input.abortSignal, controller.signal);

    const runId = input.runId;
    const turnId = id("turn");
    const ts = now();
    const round = Math.max(1, input.messages.filter((message) => message.role === "user").length);
    const pump = new EventPump();

    const emitTraj = (
      type: TrajectoryEventType,
      title: string,
      extra?: Partial<TrajectoryEvent>,
    ): RuntimeEvent => ({
      type: "trajectory",
      event: {
        id: extra?.id ?? id("tr"),
        type,
        ts: extra?.ts ?? now(),
        runId,
        turnId,
        title,
        detail: extra?.detail,
        payload: extra?.payload,
        messageId: extra?.messageId,
        durationMs: extra?.durationMs,
      },
    });

    pump.push({ type: "run_start", runId, ts });
    pump.push(
      emitTraj("run_start", "PI Agent run started", {
        ts,
        payload: {
          cwd: this.cwd,
          round,
        },
      }),
    );

    if (!input.provider?.apiKey) {
      const message = "No connector API key on this request. Open Connectors and select a provider.";
      pump.push({ type: "error", message });
      pump.push(emitTraj("error", "Missing connector", { detail: message }));
      pump.push({ type: "run_end", runId, ts: now(), outcome: "failed", error: message });
      pump.close();
      yield* pump.iterate();
      return;
    }

    const prompt = lastUserText(input.messages);
    if (!prompt) {
      const message = "Nothing to send — last message is not a user prompt.";
      pump.push({ type: "error", message });
      pump.push({ type: "run_end", runId, ts: now(), outcome: "failed", error: message });
      pump.close();
      yield* pump.iterate();
      return;
    }

    const { model, providerId } = modelFromProvider(input.provider);
    try {
      await this.modelRuntime.setRuntimeApiKey(providerId, input.provider.apiKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pump.push({ type: "error", message: `Could not attach connector key: ${message}` });
      pump.push({ type: "run_end", runId, ts: now(), outcome: "failed", error: message });
      pump.close();
      yield* pump.iterate();
      return;
    }

    this.session.agent.state.model = model;
    await this.session.abort().catch(() => undefined);
    await this.session.agent.waitForIdle();
    this.session.agent.reset();
    this.session.agent.state.messages = historyToAgentMessages(input.messages);

    const skills = this.resourceLoader?.getSkills().skills ?? [];
    let assistantId: string | undefined;
    let assistant: ChatMessage | undefined;
    const toolCards = new Map<string, ToolCallCard>();
    const loop = { turn: 0, round };
    pump.push(
      emitTraj("turn_start", `Round ${loop.round} opened`, {
        detail: `User → final assistant is round ${loop.round}`,
        payload: { round: loop.round, turn: 0 },
      }),
    );

    if (prompt.startsWith("/skill:")) {
      const skillName = prompt.slice(7).split(/\s+/)[0] ?? "";
      pump.push(
        emitTraj("skill_load", `Expanded /skill:${skillName}`, {
          payload: { ...loop, skill: skillName },
        }),
      );
    }

    const lastUserId = [...input.messages].reverse().find((message) => message.role === "user")?.id;
    const previousOnPayload = this.session.agent.onPayload;
    this.session.agent.onPayload = async (payload, _model) => {
      const next = previousOnPayload ? await previousOnPayload(payload, model) : payload;
      const body = redactSecrets(jsonSafe(next ?? payload));
      const chars = jsonChars(body);
      pump.push(
        emitTraj("user", "Request body", {
          messageId: lastUserId,
          detail: loopDetail(loop, `${chars} chars`),
          payload: { ...loop, message: body },
        }),
      );
      return next;
    };

    const unsubscribe = this.session.subscribe((event) => {
      mapSessionEvent(event, {
        emit: (runtimeEvent) => pump.push(runtimeEvent),
        emitTraj,
        skills: skills.map((s) => ({ name: s.name, filePath: s.filePath })),
        getSystemPrompt: () => this.session?.systemPrompt ?? "",
        cwd: this.cwd,
        loop,
        get assistantId() {
          return assistantId;
        },
        setAssistant(next: ChatMessage) {
          assistantId = next.id;
          assistant = next;
        },
        assistant,
        toolCards,
      });
    });

    const onAbort = () => {
      void this.session?.abort();
    };
    signal.addEventListener("abort", onAbort, { once: true });

    const run = this.session
      .prompt(prompt)
      .then(() => {
        const aborted = signal.aborted;
        pump.push({
          type: "run_end",
          runId,
          ts: now(),
          outcome: aborted ? "aborted" : "completed",
        });
        pump.push(emitTraj("run_end", aborted ? "Run aborted" : "Run completed"));
      })
      .catch((error: unknown) => {
        if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          pump.push({ type: "run_end", runId, ts: now(), outcome: "aborted" });
          pump.push(emitTraj("run_end", "Run aborted"));
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        pump.push({ type: "error", message });
        pump.push(emitTraj("error", "PI Agent fault", { detail: message }));
        pump.push({ type: "run_end", runId, ts: now(), outcome: "failed", error: message });
      })
      .finally(() => {
        unsubscribe();
        signal.removeEventListener("abort", onAbort);
        if (this.session) this.session.agent.onPayload = previousOnPayload;
        pump.close();
        if (this.controllers.get(input.sessionId) === controller) {
          this.controllers.delete(input.sessionId);
        }
      });

    yield* pump.iterate();
    await run;
  }

  private enableDiscoveredTools(): void {
    if (!this.session) return;
    const names = this.session.getAllTools().map((tool) => tool.name);
    if (names.length > 0) this.session.setActiveToolsByName(names);
  }

  private syncCatalog(): void {
    const next = new PluginRegistry();
    const session = this.session;
    const loader = this.resourceLoader;
    if (!session || !loader) {
      this.piCatalog.list();
      this.reloadedAt = now();
      return;
    }

    const skillsDir = this.skillDirs[0] ?? join(this.agentDir, "skills");
    const active = new Set(session.getActiveToolNames());
    for (const skill of loader.getSkills().skills) {
      if (!isUnderDir(skill.filePath, skillsDir)) continue;
      let content = "";
      try {
        content = readFileSync(skill.filePath, "utf8");
      } catch {
        content = skill.description;
      }
      next.registerSkill({
        id: `skill.${skill.name}`,
        name: skill.name,
        description: skill.description,
        origin: skill.sourceInfo?.source ? `${skill.sourceInfo.source}:${skill.filePath}` : skill.filePath,
        filePath: skill.filePath,
        enabled: !skill.disableModelInvocation,
        content,
      });
    }

    for (const tool of session.getAllTools()) {
      const parameters = asJsonSchema(tool.parameters);
      next.registerTool({
        id: `tool.${tool.name}`,
        name: tool.name,
        description: tool.description,
        origin: tool.sourceInfo?.path ?? `pi://tools/${tool.name}`,
        enabled: active.has(tool.name),
        parameters,
        execute: async () => ({ text: "Inspect-only. PI Agent executes this tool during a run." }),
      });
    }

    const skillList = loader
      .getSkills()
      .skills.filter((s) => isUnderDir(s.filePath, skillsDir))
      .map((s) => `- ${s.name}: ${s.description}`)
      .join("\n");
    next.registerPlugin({
      id: "scp.skill-catalog",
      name: "skill-catalog",
      kind: "scp",
      origin: "pi://system-prompt/skills",
      description: "Session context packet: available skills injected into the PI system prompt.",
      contentLanguage: "text",
      content: skillList || "(no skills discovered)",
    });

    const agentsFiles = loader.getAgentsFiles().agentsFiles;
    next.registerPlugin({
      id: "scp.agents-md",
      name: "agents-md",
      kind: "scp",
      origin: agentsFiles[0]?.path ?? "pi://AGENTS.md",
      description: "Project / user AGENTS.md (and CLAUDE.md) files folded into the system prompt.",
      contentLanguage: "markdown",
      filePath: agentsFiles[0]?.path,
      content:
        agentsFiles.length === 0
          ? "(no AGENTS.md found)"
          : agentsFiles.map((file) => `<!-- ${file.path} -->\n${file.content}`).join("\n\n"),
    });

    next.registerPlugin({
      id: "scp.workspace",
      name: "workspace",
      kind: "scp",
      origin: this.cwd,
      description: "Working directory and skill search paths for this PI process.",
      contentLanguage: "json",
      content: JSON.stringify(
        {
          cwd: this.cwd,
          agentDir: this.agentDir,
          skillDirs: this.skillDirs,
          reloadedAt: new Date(this.reloadedAt || Date.now()).toISOString(),
        },
        null,
        2,
      ),
    });

    next.registerPlugin({
      id: "other.pi-runtime",
      name: "pi-runtime",
      kind: "other",
      origin: "@earendil-works/pi-coding-agent",
      description: "Embedded PI Agent session. Refresh Plugins to rescan skills, tools, and extensions from disk.",
      contentLanguage: "text",
      content: [
        `cwd: ${this.cwd}`,
        `agentDir: ${this.agentDir}`,
        `skills: ${join(this.agentDir, "skills")} only (PI_AGENT_DIR/skills)`,
        "Codex ~/.agents/skills, project .agents/skills, <cwd>/.pi/skills, and <cwd>/skills are not loaded.",
        "Click Refresh (or reload the page) after adding a SKILL.md or extension tool.",
      ].join("\n"),
    });

    this.piCatalog.tools.clear();
    this.piCatalog.skills.clear();
    this.piCatalog.plugins.clear();
    for (const skill of next.skills.values()) this.piCatalog.registerSkill(skill);
    for (const tool of next.tools.values()) this.piCatalog.registerTool(tool);
    for (const plugin of next.plugins.values()) this.piCatalog.registerPlugin(plugin);
    this.reloadedAt = now();
  }
}

interface MapContext {
  emit: (event: RuntimeEvent) => void;
  emitTraj: (type: TrajectoryEventType, title: string, extra?: Partial<TrajectoryEvent>) => RuntimeEvent;
  skills: Array<{ name: string; filePath: string }>;
  getSystemPrompt: () => string;
  cwd: string;
  loop: { turn: number; round: number };
  readonly assistantId: string | undefined;
  setAssistant: (message: ChatMessage) => void;
  assistant: ChatMessage | undefined;
  toolCards: Map<string, ToolCallCard>;
}

function mapSessionEvent(event: AgentSessionEvent, ctx: MapContext): void {
  switch (event.type) {
    case "agent_start": {
      ctx.loop.turn = 0;
      const systemPrompt = ctx.getSystemPrompt();
      ctx.emit(
        ctx.emitTraj("context", "System prompt", {
          detail: systemPrompt || "(empty system prompt)",
          payload: {
            ...ctx.loop,
            chars: systemPrompt.length,
            cwd: ctx.cwd,
            skillNames: ctx.skills.map((s) => s.name),
          },
        }),
      );
      return;
    }
    case "turn_start": {
      ctx.loop.turn += 1;
      const { turn, round } = ctx.loop;
      ctx.emit(
        ctx.emitTraj("turn_start", `PI turn ${turn}`, {
          detail: `Round ${round} · turn ${turn} — one model response plus any tools in this step`,
          payload: { ...ctx.loop },
        }),
      );
      return;
    }
    case "turn_end": {
      const { turn, round } = ctx.loop;
      const toolCount = event.toolResults?.length ?? 0;
      ctx.emit(
        ctx.emitTraj("turn_end", `PI turn ${turn} ended`, {
          detail:
            toolCount > 0
              ? `Round ${round} · turn ${turn} closed after ${toolCount} tool result${toolCount === 1 ? "" : "s"}`
              : `Round ${round} · turn ${turn} closed — no tools`,
          payload: { ...ctx.loop, toolCount },
        }),
      );
      return;
    }
    case "message_start": {
      if (event.message.role !== "assistant") return;
      const message: ChatMessage = {
        id: id("msg"),
        role: "assistant",
        content: "",
        createdAt: now(),
        thinking: "",
        toolCalls: [],
        trajectoryIds: [],
      };
      ctx.setAssistant(message);
      ctx.emit({ type: "message_start", message: { ...message } });
      return;
    }
    case "message_update": {
      const messageId = ctx.assistantId;
      if (!messageId) return;
      const inner = event.assistantMessageEvent;
      if (inner.type === "text_delta" && inner.delta) {
        ctx.emit({ type: "message_delta", messageId, field: "content", delta: inner.delta });
      }
      if (inner.type === "thinking_delta" && inner.delta) {
        ctx.emit({ type: "message_delta", messageId, field: "thinking", delta: inner.delta });
      }
      return;
    }
    case "message_end": {
      if (event.message.role === "user") {
        const text = userText(event.message);
        ctx.emit(
          ctx.emitTraj("user", "User request", {
            detail: loopDetail(ctx.loop, text ? `${text.length} chars` : "empty"),
            payload: { ...ctx.loop, message: jsonSafe(event.message) },
          }),
        );
        return;
      }
      if (event.message.role !== "assistant" || !ctx.assistant) return;
      const text = assistantText(event.message);
      const thinking = assistantThinking(event.message);
      const ended: ChatMessage = {
        ...ctx.assistant,
        content: text || ctx.assistant.content,
        thinking: thinking || ctx.assistant.thinking,
        toolCalls: ctx.assistant.toolCalls ?? [],
      };
      if (thinking) {
        ctx.emit(
          ctx.emitTraj("thinking", "Reasoning", {
            messageId: ended.id,
            detail: loopDetail(ctx.loop, `${thinking.length} chars`),
            payload: { ...ctx.loop, thinking },
          }),
        );
      }
      ctx.emit(
        ctx.emitTraj("text", "Assistant text", {
          messageId: ended.id,
          detail: loopDetail(ctx.loop, text ? `${text.length} chars` : "no text · tool-only"),
          payload: { ...ctx.loop, message: jsonSafe(event.message) },
        }),
      );
      ctx.emit({ type: "message_end", message: ended });
      return;
    }
    case "tool_execution_start": {
      const messageId = ctx.assistantId;
      const card: ToolCallCard = {
        id: event.toolCallId,
        name: event.toolName,
        args: event.args,
        status: "running",
      };
      ctx.toolCards.set(event.toolCallId, card);
      if (messageId) ctx.emit({ type: "tool_call", messageId, toolCall: { ...card } });
      ctx.emit(
        ctx.emitTraj("tool_call", event.toolName, {
          messageId,
          detail: loopDetail(ctx.loop, argsPreview(event.args) || event.toolName),
          payload: { ...ctx.loop, args: event.args },
        }),
      );
      const path = toolPath(event.args);
      if (path && isSkillPath(path, ctx.skills)) {
        ctx.emit(
          ctx.emitTraj("skill_load", `Read skill file ${path}`, {
            messageId,
            detail: loopDetail(ctx.loop, path),
            payload: { ...ctx.loop, path },
          }),
        );
      }
      return;
    }
    case "tool_execution_end": {
      const messageId = ctx.assistantId;
      const existing = ctx.toolCards.get(event.toolCallId);
      const snippet = toolResultSnippet(event.result);
      const card: ToolCallCard = {
        id: event.toolCallId,
        name: event.toolName,
        args: existing?.args ?? {},
        status: event.isError ? "error" : "ok",
        result: event.result,
        resultSnippet: snippet,
      };
      ctx.toolCards.set(event.toolCallId, card);
      if (messageId) ctx.emit({ type: "tool_result", messageId, toolCall: { ...card } });
      ctx.emit(
        ctx.emitTraj("tool_result", `${event.toolName} → ${card.status}`, {
          messageId,
          detail: loopDetail(ctx.loop, snippet),
          payload: { ...ctx.loop },
        }),
      );
      return;
    }
    default:
      return;
  }
}

function loopDetail(loop: { turn: number; round: number }, text: string): string {
  if (loop.turn > 0) return `round ${loop.round} · turn ${loop.turn} · ${text}`;
  return `round ${loop.round} · ${text}`;
}

function argsPreview(args: unknown): string {
  try {
    const text = JSON.stringify(args);
    return text && text !== "{}" && text !== "null" ? text : "";
  } catch {
    return "";
  }
}

function jsonSafe(value: unknown): unknown {
  try {
    return JSON.parse(
      JSON.stringify(value, (_key, item) => {
        if (typeof item === "bigint") return item.toString();
        if (typeof item === "function" || typeof item === "undefined") return undefined;
        return item;
      }),
    );
  } catch {
    return { error: "Could not serialize value" };
  }
}

function jsonChars(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function redactSecrets(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = { ...(value as Record<string, unknown>) };
  for (const key of Object.keys(record)) {
    if (/^(api[_-]?key|authorization|secret|password)$/i.test(key) && typeof record[key] === "string") {
      record[key] = "••••";
    }
  }
  return record;
}

function userText(message: { content?: unknown }): string {
  if (typeof message.content === "string") return message.content;
  return assistantText(message);
}

function assistantText(message: { content?: unknown }): string {
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((block): block is { type: "text"; text: string } => {
      return Boolean(block && typeof block === "object" && (block as { type?: string }).type === "text");
    })
    .map((block) => block.text)
    .join("");
}

function assistantThinking(message: { content?: unknown }): string {
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((block): block is { type: "thinking"; thinking: string } => {
      return Boolean(block && typeof block === "object" && (block as { type?: string }).type === "thinking");
    })
    .map((block) => block.thinking)
    .join("");
}

function toolPath(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;
  const value = record.path ?? record.file_path ?? record.filePath;
  return typeof value === "string" ? value : "";
}

function isSkillPath(path: string, skills: Array<{ filePath: string }>): boolean {
  if (path.includes("SKILL.md")) return true;
  const resolved = resolve(path);
  return skills.some((skill) => resolve(skill.filePath) === resolved);
}

function toolResultSnippet(result: unknown): string {
  if (result && typeof result === "object") {
    const record = result as { content?: unknown; details?: unknown };
    if (Array.isArray(record.content)) {
      const text = record.content
        .map((block) => {
          if (block && typeof block === "object" && "text" in block) {
            return String((block as { text: string }).text);
          }
          return "";
        })
        .join("");
      if (text) return text.slice(0, 800);
    }
    try {
      return JSON.stringify(record.details ?? result).slice(0, 800);
    } catch {
      return String(result).slice(0, 800);
    }
  }
  return String(result ?? "").slice(0, 800);
}

function asJsonSchema(value: unknown): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return { type: "object", properties: {} };
  }
}

function abortAny(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (a.aborted || b.aborted) {
    controller.abort();
    return controller.signal;
  }
  a.addEventListener("abort", onAbort, { once: true });
  b.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}
