import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import type { ChatMessage } from "@pi-debug/shared";

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** Restore browser-local chat into PI Agent messages, excluding the last user turn (prompted separately). */
export function historyToAgentMessages(messages: ChatMessage[]): AgentMessage[] {
  const prior = messages.slice(0, -1);
  const out: AgentMessage[] = [];

  for (const message of prior) {
    if (message.role === "user") {
      out.push({
        role: "user",
        content: [{ type: "text", text: message.content }],
        timestamp: message.createdAt,
      });
      continue;
    }

    if (message.role === "system") {
      out.push({
        role: "user",
        content: [{ type: "text", text: `[system]\n${message.content}` }],
        timestamp: message.createdAt,
      });
      continue;
    }

    if (message.role === "tool") {
      out.push({
        role: "toolResult",
        toolCallId: message.toolCallId ?? message.id,
        toolName: "tool",
        content: [{ type: "text", text: message.content }],
        isError: false,
        timestamp: message.createdAt,
      } satisfies ToolResultMessage);
      continue;
    }

    if (message.role === "assistant") {
      const content: AssistantMessage["content"] = [];
      if (message.thinking) {
        content.push({ type: "thinking", thinking: message.thinking });
      }
      if (message.content) {
        content.push({ type: "text", text: message.content });
      }
      for (const call of message.toolCalls ?? []) {
        content.push({
          type: "toolCall",
          id: call.id,
          name: call.name,
          arguments: asRecord(call.args),
        });
      }
      out.push({
        role: "assistant",
        content: content.length > 0 ? content : [{ type: "text", text: "" }],
        api: "openai-completions",
        provider: "openai",
        model: "restored",
        usage: EMPTY_USAGE,
        stopReason: message.toolCalls?.length ? "toolUse" : "stop",
        timestamp: message.createdAt,
      } satisfies AssistantMessage);

      for (const call of message.toolCalls ?? []) {
        out.push({
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.name,
          content: [{ type: "text", text: call.resultSnippet ?? snippet(call.result) }],
          isError: call.status === "error",
          timestamp: message.createdAt,
        } satisfies ToolResultMessage);
      }
    }
  }

  return out;
}

export function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === "user" && message.content.trim()) return message.content;
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function snippet(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
