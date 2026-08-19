import type {
  ChatMessage,
  PluginDetail,
  PluginSummary,
  RuntimeEvent,
  TrajectoryEvent,
  TrajectoryEventType,
  ToolCallCard,
} from "@pi-debug/shared";
import { streamChat, type ChatCompletionMessage, type ConnectorTool } from "./connector.ts";
import { PluginRegistry } from "./plugin-registry.ts";
import type { AgentRuntime, RegisteredPlugin, RegisteredSkill, RegisteredTool, RunTurnInput } from "./types.ts";

function now(): number {
  return Date.now();
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

export class StubRuntime implements AgentRuntime {
  readonly name = "stub";
  private readonly registry = new PluginRegistry();
  private readonly controllers = new Map<string, AbortController>();

  constructor() {
    seedDefaultCatalog(this);
  }

  registerTool(tool: RegisteredTool): void {
    this.registry.registerTool(tool);
  }

  registerSkill(skill: RegisteredSkill): void {
    this.registry.registerSkill(skill);
  }

  registerPlugin(plugin: RegisteredPlugin): void {
    this.registry.registerPlugin(plugin);
  }

  listPlugins(): PluginSummary[] {
    return this.registry.list();
  }

  getPlugin(id: string): PluginDetail | undefined {
    return this.registry.get(id);
  }

  info() {
    return {
      name: this.name,
      cwd: process.cwd(),
      agentDir: "",
      skillDirs: [],
      reloadedAt: Date.now(),
    };
  }

  async reload(): Promise<void> {
    // Stub catalog is in-process only.
  }

  stop(sessionId: string): void {
    this.controllers.get(sessionId)?.abort();
  }

  async *runTurn(input: RunTurnInput): AsyncIterable<RuntimeEvent> {
    const existing = this.controllers.get(input.sessionId);
    existing?.abort();
    const controller = new AbortController();
    this.controllers.set(input.sessionId, controller);

    const signal = abortAny(input.abortSignal, controller.signal);
    const runId = input.runId;
    const turnId = id("turn");
    const ts = now();

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

    try {
      yield { type: "run_start", runId, ts };
      yield emitTraj("run_start", "Run started", { ts, payload: { runtime: this.name } });
      yield emitTraj("turn_start", "Turn opened", { ts });
      const systemPrompt = input.systemPrompt ?? defaultSystemPrompt(this);
      yield emitTraj("context", "System prompt", {
        detail: systemPrompt,
        payload: { chars: systemPrompt.length, packets: ["skill-catalog", "workspace-facts"] },
      });

      if (!input.provider?.apiKey) {
        yield* this.demoTurn(input, emitTraj, signal);
        yield { type: "run_end", runId, ts: now(), outcome: "completed" };
        yield emitTraj("run_end", "Run completed (demo runtime)", {
          payload: { mode: "demo" },
        });
        return;
      }

      yield* this.llmTurn(input, emitTraj, signal);
      const aborted = signal.aborted;
      yield {
        type: "run_end",
        runId,
        ts: now(),
        outcome: aborted ? "aborted" : "completed",
      };
      yield emitTraj("run_end", aborted ? "Run aborted" : "Run completed", {
        payload: { mode: "llm" },
      });
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        yield { type: "run_end", runId, ts: now(), outcome: "aborted" };
        yield emitTraj("run_end", "Run aborted");
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      yield { type: "error", message };
      yield emitTraj("error", "Runtime fault", { detail: message });
      yield { type: "run_end", runId, ts: now(), outcome: "failed", error: message };
    } finally {
      if (this.controllers.get(input.sessionId) === controller) {
        this.controllers.delete(input.sessionId);
      }
    }
  }

  private async *demoTurn(
    input: RunTurnInput,
    emitTraj: (type: TrajectoryEventType, title: string, extra?: Partial<TrajectoryEvent>) => RuntimeEvent,
    signal: AbortSignal,
  ): AsyncIterable<RuntimeEvent> {
    const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
    const prompt = lastUser?.content ?? "";
    const messageId = id("msg");
    const started = now();

    const message: ChatMessage = {
      id: messageId,
      role: "assistant",
      content: "",
      createdAt: started,
      thinking: "",
      toolCalls: [],
      trajectoryIds: [],
    };

    yield { type: "message_start", message: { ...message } };

    const thinking =
      "No provider key on this request, so the stub runtime is walking a recorded debug path instead of calling a model. Trajectory events still fire so the inspector is usable.";
    for (const piece of chunkText(thinking, 42)) {
      if (signal.aborted) return;
      await sleep(18, signal);
      message.thinking = (message.thinking ?? "") + piece;
      yield { type: "message_delta", messageId, field: "thinking", delta: piece };
    }
    yield emitTraj("thinking", "Reasoning", { messageId, detail: thinking, durationMs: 80 });

    yield emitTraj("skill_load", "Loaded skill: debug-session", {
      detail: "SKILL.md from stub catalog",
      payload: { skillId: "skill.debug-session" },
      messageId,
    });

    const inspectCall: ToolCallCard = {
      id: id("call"),
      name: "inspect_runtime",
      args: { include: "plugins" },
      status: "running",
    };
    message.toolCalls = [inspectCall];
    yield { type: "tool_call", messageId, toolCall: inspectCall };
    yield emitTraj("tool_call", "inspect_runtime", {
      messageId,
      payload: inspectCall.args,
    });

    const tool = this.registry.tools.get("tool.inspect_runtime");
    const result = tool
      ? await tool.execute({ include: "plugins" })
      : { text: "runtime stub" };
    if (signal.aborted) return;
    await sleep(120, signal);
    inspectCall.status = "ok";
    inspectCall.result = result.data ?? result.text;
    inspectCall.resultSnippet = result.text.slice(0, 280);
    yield { type: "tool_result", messageId, toolCall: { ...inspectCall } };
    yield emitTraj("tool_result", "inspect_runtime → ok", {
      messageId,
      detail: inspectCall.resultSnippet,
    });

    const body = demoReply(prompt);
    for (const piece of chunkText(body, 36)) {
      if (signal.aborted) return;
      await sleep(16, signal);
      message.content += piece;
      yield { type: "message_delta", messageId, field: "content", delta: piece };
    }
    yield emitTraj("text", "Assistant text", { messageId, detail: `${body.length} chars` });
    yield { type: "message_end", message: { ...message, toolCalls: [{ ...inspectCall }] } };
    yield emitTraj("turn_end", "Turn closed", { messageId });
  }

  private async *llmTurn(
    input: RunTurnInput,
    emitTraj: (type: TrajectoryEventType, title: string, extra?: Partial<TrajectoryEvent>) => RuntimeEvent,
    signal: AbortSignal,
  ): AsyncIterable<RuntimeEvent> {
    const tools = [...this.registry.tools.values()].filter((t) => t.enabled !== false);
    const connectorTools: ConnectorTool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    const llmMessages = toConnectorMessages(input.messages, input.systemPrompt ?? defaultSystemPrompt(this));
    let loops = 0;

    while (loops < 6) {
      loops += 1;
      if (signal.aborted) return;

      const messageId = id("msg");
      const message: ChatMessage = {
        id: messageId,
        role: "assistant",
        content: "",
        createdAt: now(),
        thinking: "",
        toolCalls: [],
        trajectoryIds: [],
      };
      yield { type: "message_start", message: { ...message } };

      const pendingCalls: Array<{ id: string; name: string; arguments: string }> = [];
      let errored = false;

      for await (const chunk of streamChat(input.provider!, llmMessages, connectorTools, signal)) {
        if (chunk.type === "thinking" && chunk.thinking) {
          message.thinking = (message.thinking ?? "") + chunk.thinking;
          yield { type: "message_delta", messageId, field: "thinking", delta: chunk.thinking };
        }
        if (chunk.type === "text" && chunk.text) {
          message.content += chunk.text;
          yield { type: "message_delta", messageId, field: "content", delta: chunk.text };
        }
        if (chunk.type === "tool_call" && chunk.toolCall) {
          pendingCalls.push(chunk.toolCall);
        }
        if (chunk.type === "error") {
          errored = true;
          const err = chunk.error ?? "Provider error";
          yield { type: "error", message: err };
          yield emitTraj("error", "Provider error", { detail: err, messageId });
          yield { type: "message_end", message: { ...message } };
          return;
        }
      }

      if (message.thinking) {
        yield emitTraj("thinking", "Reasoning", { messageId, detail: `${message.thinking.length} chars` });
      }
      if (message.content) {
        yield emitTraj("text", "Assistant text", { messageId, detail: `${message.content.length} chars` });
      }

      if (pendingCalls.length === 0) {
        yield { type: "message_end", message: { ...message } };
        yield emitTraj("turn_end", "Turn closed", { messageId });
        return;
      }

      const cards: ToolCallCard[] = [];
      for (const call of pendingCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = { _raw: call.arguments };
        }
        const card: ToolCallCard = {
          id: call.id,
          name: call.name,
          args,
          status: "running",
        };
        cards.push(card);
        message.toolCalls = [...cards];
        yield { type: "tool_call", messageId, toolCall: { ...card } };
        yield emitTraj("tool_call", call.name, { messageId, payload: args });

        if (call.name === "load_skill" && typeof args.name === "string") {
          yield emitTraj("skill_load", `Loaded skill: ${args.name}`, {
            messageId,
            payload: args,
          });
        }

        const tool = [...this.registry.tools.values()].find((t) => t.name === call.name);
        try {
          const result = tool
            ? await tool.execute(args)
            : { text: `Unknown tool ${call.name}` };
          card.status = tool ? "ok" : "error";
          card.result = result.data ?? result.text;
          card.resultSnippet = result.text.slice(0, 400);
        } catch (error) {
          card.status = "error";
          card.resultSnippet = error instanceof Error ? error.message : String(error);
        }
        yield { type: "tool_result", messageId, toolCall: { ...card } };
        yield emitTraj("tool_result", `${call.name} → ${card.status}`, {
          messageId,
          detail: card.resultSnippet,
        });
      }

      yield { type: "message_end", message: { ...message, toolCalls: cards.map((c) => ({ ...c })) } };

      llmMessages.push({
        role: "assistant",
        content: message.content,
        tool_calls: pendingCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments },
        })),
      });
      for (const card of cards) {
        llmMessages.push({
          role: "tool",
          tool_call_id: card.id,
          content: card.resultSnippet ?? "",
        });
      }
      void errored;
    }

    yield emitTraj("error", "Tool loop cap reached", { detail: "Stopped after 6 model steps." });
  }
}

function defaultSystemPrompt(runtime: StubRuntime): string {
  const skills = runtime
    .listPlugins()
    .filter((p) => p.kind === "skill" && p.enabled)
    .map((p) => `- ${p.name}: ${p.description}`)
    .join("\n");
  return [
    "You are PI Agent running inside a local debug harness.",
    "Be concrete. Prefer using inspect_runtime or load_skill when the user asks how the runtime is wired.",
    "Available skills:",
    skills || "(none)",
  ].join("\n");
}

function toConnectorMessages(messages: ChatMessage[], systemPrompt: string): ChatCompletionMessage[] {
  const out: ChatCompletionMessage[] = [{ role: "system", content: systemPrompt }];
  for (const message of messages) {
    if (message.role === "tool") {
      out.push({
        role: "tool",
        content: message.content,
        tool_call_id: message.toolCallId,
      });
      continue;
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
        })),
      });
      continue;
    }
    out.push({
      role: message.role === "system" ? "system" : message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    });
  }
  return out;
}

function demoReply(prompt: string): string {
  const clipped = prompt.trim() ? prompt.trim().slice(0, 180) : "(empty)";
  return [
    "Stub runtime answered this turn without a provider key.",
    "",
    `Last user prompt: ${clipped}`,
    "",
    "What just happened:",
    "1. Session context packets (SCP) injected the skill catalog.",
    "2. Skill `debug-session` was marked loaded.",
    "3. Tool `inspect_runtime` ran against the in-process plugin registry.",
    "",
    "Open **Connectors** in the footer, add an OpenAI-compatible, Anthropic, or custom endpoint, then send again. Keys stay in this browser and are forwarded per request — they are not written to disk on the server.",
    "",
    "When you embed `@earendil-works/pi-agent-core`, replace `StubRuntime` in `backend/src/runtime/create-runtime.ts`.",
  ].join("\n");
}

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks.length > 0 ? chunks : [""];
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
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

export function seedDefaultCatalog(runtime: AgentRuntime): void {
  runtime.registerSkill({
    id: "skill.debug-session",
    name: "debug-session",
    origin: "stub://skills/debug-session/SKILL.md",
    filePath: "skills/debug-session/SKILL.md",
    description: "How to inspect a PI Agent session: plugins, trajectory, and connector config.",
    content: `---
name: debug-session
description: Inspect the local PI Agent debug harness.
---

# Debug session

Use this skill when the user is exploring the harness itself.

## Checklist
- Confirm a session is selected on the left.
- Check Connectors for a provider (OpenAI-compatible gateways are first-class).
- Watch Trajectory for tool_call / skill_load / SCP injection.
- Open a plugin on the right to read SKILL.md or the tool schema.

Do not invent server-side persistence. Sessions live in IndexedDB.
`,
  });

  runtime.registerSkill({
    id: "skill.pi-embed",
    name: "pi-embed",
    origin: "stub://skills/pi-embed/SKILL.md",
    filePath: "skills/pi-embed/SKILL.md",
    description: "Notes for swapping StubRuntime with @earendil-works/pi-agent-core.",
    content: `---
name: pi-embed
description: Embed the real PI Agent runtime.
---

# Embed PI Agent

Local checkout observed at \`/Users/boyn/code/pi-mono\`.

\`\`\`ts
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";

// Map Agent.subscribe events onto RuntimeEvent in PiAgentRuntime.
\`\`\`

Keep \`streamFn\` bound to a connector that uses the per-request provider config so keys never sit on disk.
`,
  });

  runtime.registerTool({
    id: "tool.inspect_runtime",
    name: "inspect_runtime",
    origin: "stub://tools/inspect_runtime",
    description: "List registered skills, tools, SCP packets, and other plugins.",
    parameters: {
      type: "object",
      properties: {
        include: { type: "string", description: "plugins | counts" },
      },
    },
    execute: async () => {
      const plugins = runtime.listPlugins();
      const lines = plugins.map((p) => `${p.kind.padEnd(6)} ${p.name}  (${p.enabled ? "on" : "off"})`);
      return { text: lines.join("\n") || "(empty)", data: plugins };
    },
  });

  runtime.registerTool({
    id: "tool.load_skill",
    name: "load_skill",
    origin: "stub://tools/load_skill",
    description: "Load a registered skill by name and return its SKILL.md body.",
    parameters: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
      },
    },
    execute: async (args) => {
      const name = String(args.name ?? "");
      const match = runtime
        .listPlugins()
        .find((p) => p.kind === "skill" && (p.name === name || p.id === name || p.id.endsWith(name)));
      if (!match) return { text: `Skill not found: ${name}` };
      const detail = runtime.getPlugin(match.id);
      return { text: detail?.content ?? match.description, data: detail };
    },
  });

  runtime.registerTool({
    id: "tool.read",
    name: "read",
    origin: "pi-core://tools/read",
    description: "Placeholder for PI Agent's read tool. Stub refuses filesystem access.",
    parameters: {
      type: "object",
      required: ["path"],
      properties: { path: { type: "string" } },
    },
    execute: async (args) => ({
      text: `Stub read: filesystem tools are disabled until PiAgentRuntime is wired. Requested ${String(args.path ?? "")}`,
    }),
  });

  runtime.registerTool({
    id: "tool.bash",
    name: "bash",
    origin: "pi-core://tools/bash",
    description: "Placeholder for PI Agent's bash tool. Stub refuses shell execution.",
    enabled: false,
    parameters: {
      type: "object",
      required: ["command"],
      properties: { command: { type: "string" } },
    },
    execute: async () => ({ text: "bash is disabled in the stub runtime." }),
  });

  runtime.registerPlugin({
    id: "scp.skill-catalog",
    name: "skill-catalog",
    kind: "scp",
    origin: "stub://scp/skill-catalog",
    description: "Session context packet: injects the skill directory into the model-visible log.",
    contentLanguage: "text",
    content:
      "SCP skill-catalog\nInjects available skill names + descriptions before each turn.\nRecorded as trajectory type=context so the inspector can audit what the model saw.",
  });

  runtime.registerPlugin({
    id: "scp.workspace-facts",
    name: "workspace-facts",
    kind: "scp",
    origin: "stub://scp/workspace-facts",
    description: "Session context packet: workspace path, runtime name, plugin counts.",
    contentLanguage: "json",
    content: JSON.stringify(
      {
        runtime: "stub",
        purpose: "local PI Agent debug harness",
        persist: "browser IndexedDB + localStorage",
      },
      null,
      2,
    ),
  });

  runtime.registerPlugin({
    id: "other.acp-bridge",
    name: "acp-bridge",
    kind: "other",
    origin: "stub://other/acp-bridge",
    description: "Reserved Agent Client Protocol seat (DeepSeek Harness ships packages/acp). Not connected in v1.",
    contentLanguage: "text",
    content: "ACP is listed so the Plugins tab matches Harness's 'everything is a plugin' inspector. No RPC yet.",
  });
}
