import type { ProviderWireConfig } from "@pi-debug/shared";

export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export interface ConnectorTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ConnectorChunk {
  type: "text" | "thinking" | "tool_call" | "done" | "error";
  text?: string;
  thinking?: string;
  toolCall?: { id: string; name: string; arguments: string };
  finishReason?: string;
  error?: string;
}

const OPENAI_TOOLS = (tools: ConnectorTool[]) =>
  tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));

function joinUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1") && path.startsWith("/v1/")) {
    return `${trimmed}${path.slice(3)}`;
  }
  if (path.startsWith("http")) return path;
  return `${trimmed}${path}`;
}

function headersFor(provider: ProviderWireConfig): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (provider.type === "anthropic") {
    headers["x-api-key"] = provider.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers.authorization = `Bearer ${provider.apiKey}`;
  }
  return headers;
}

async function* iterateOpenAiSse(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const dataLines = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());
      if (dataLines.length === 0) continue;
      const data = dataLines.join("\n");
      if (data === "[DONE]") return;
      try {
        yield JSON.parse(data) as Record<string, unknown>;
      } catch {
        // ignore malformed keepalives
      }
    }
  }
}

/**
 * Provider connector. Receives credentials per request from the browser.
 * Never persist or log apiKey.
 */
export async function* streamChat(
  provider: ProviderWireConfig,
  messages: ChatCompletionMessage[],
  tools: ConnectorTool[],
  signal: AbortSignal,
): AsyncGenerator<ConnectorChunk> {
  if (provider.type === "anthropic") {
    yield* streamAnthropic(provider, messages, tools, signal);
    return;
  }
  yield* streamOpenAiCompatible(provider, messages, tools, signal);
}

async function* streamOpenAiCompatible(
  provider: ProviderWireConfig,
  messages: ChatCompletionMessage[],
  tools: ConnectorTool[],
  signal: AbortSignal,
): AsyncGenerator<ConnectorChunk> {
  const url = joinUrl(provider.baseUrl, "/v1/chat/completions");
  const payload: Record<string, unknown> = {
    model: provider.model,
    stream: true,
    messages,
  };
  if (tools.length > 0) payload.tools = OPENAI_TOOLS(tools);

  const response = await fetch(url, {
    method: "POST",
    headers: headersFor(provider),
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    yield {
      type: "error",
      error: `Provider ${response.status}: ${sanitizeError(text) || response.statusText}`,
    };
    return;
  }
  if (!response.body) {
    yield { type: "error", error: "Provider returned an empty body." };
    return;
  }

  const toolAcc = new Map<number, { id: string; name: string; arguments: string }>();

  for await (const event of iterateOpenAiSse(response.body)) {
    const choices = event.choices as Array<Record<string, unknown>> | undefined;
    const choice = choices?.[0];
    const delta = (choice?.delta ?? {}) as Record<string, unknown>;
    const finish = choice?.finish_reason as string | undefined;

    const reasoning =
      (typeof delta.reasoning_content === "string" && delta.reasoning_content) ||
      (typeof delta.reasoning === "string" && delta.reasoning) ||
      "";
    if (reasoning) yield { type: "thinking", thinking: reasoning };

    if (typeof delta.content === "string" && delta.content) {
      yield { type: "text", text: delta.content };
    }

    const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
    if (toolCalls) {
      for (const call of toolCalls) {
        const index = typeof call.index === "number" ? call.index : 0;
        const existing = toolAcc.get(index) ?? { id: "", name: "", arguments: "" };
        if (typeof call.id === "string") existing.id = call.id;
        const fn = (call.function ?? {}) as Record<string, unknown>;
        if (typeof fn.name === "string") existing.name += fn.name;
        if (typeof fn.arguments === "string") existing.arguments += fn.arguments;
        toolAcc.set(index, existing);
      }
    }

    if (finish === "tool_calls") {
      for (const call of toolAcc.values()) {
        yield {
          type: "tool_call",
          toolCall: {
            id: call.id || crypto.randomUUID(),
            name: call.name,
            arguments: call.arguments || "{}",
          },
        };
      }
      toolAcc.clear();
    }

    if (finish && finish !== "tool_calls") {
      yield { type: "done", finishReason: finish };
    }
  }
  yield { type: "done", finishReason: "stop" };
}

async function* streamAnthropic(
  provider: ProviderWireConfig,
  messages: ChatCompletionMessage[],
  tools: ConnectorTool[],
  signal: AbortSignal,
): AsyncGenerator<ConnectorChunk> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const converted = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

  const url = joinUrl(provider.baseUrl, "/v1/messages");
  const payload: Record<string, unknown> = {
    model: provider.model,
    max_tokens: 4096,
    stream: true,
    messages: converted,
  };
  if (system) payload.system = system;
  if (tools.length > 0) {
    payload.tools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }

  const response = await fetch(url, {
    method: "POST",
    headers: headersFor(provider),
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    yield { type: "error", error: `Anthropic ${response.status}: ${sanitizeError(text) || response.statusText}` };
    return;
  }
  if (!response.body) {
    yield { type: "error", error: "Anthropic returned an empty body." };
    return;
  }

  let toolName = "";
  let toolId = "";
  let toolArgs = "";

  for await (const event of iterateOpenAiSse(response.body)) {
    const type = event.type as string | undefined;
    if (type === "content_block_delta") {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
        yield { type: "thinking", thinking: delta.thinking };
      }
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        yield { type: "text", text: delta.text };
      }
      if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
        toolArgs += delta.partial_json;
      }
    }
    if (type === "content_block_start") {
      const block = event.content_block as Record<string, unknown> | undefined;
      if (block?.type === "tool_use") {
        toolName = String(block.name ?? "");
        toolId = String(block.id ?? crypto.randomUUID());
        toolArgs = "";
      }
    }
    if (type === "content_block_stop" && toolName) {
      yield {
        type: "tool_call",
        toolCall: { id: toolId, name: toolName, arguments: toolArgs || "{}" },
      };
      toolName = "";
    }
    if (type === "message_stop") {
      yield { type: "done", finishReason: "stop" };
    }
  }
}

/** Strip anything that looks like a bearer token from upstream error bodies. */
export function sanitizeError(text: string): string {
  return text
    .replace(/sk-[a-zA-Z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+[^\s"]+/gi, "Bearer [redacted]")
    .slice(0, 800);
}
