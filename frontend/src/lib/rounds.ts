import type { ChatMessage, TrajectoryEvent } from "@pi-debug/shared";

/** One user prompt through its final assistant reply. Turns are the PI steps inside it. */
export type ChatRound = {
  index: number;
  user: ChatMessage | null;
  assistants: AssistantRow[];
};

export type AssistantRow = {
  messages: ChatMessage[];
  turnStart: number;
  turnEnd: number;
};

export function groupChatRounds(messages: ChatMessage[]): ChatRound[] {
  const rounds: ChatRound[] = [];
  let current: ChatRound | null = null;
  let turn = 0;

  for (const message of messages) {
    if (message.role !== "assistant") {
      current = { index: rounds.length + 1, user: message, assistants: [] };
      rounds.push(current);
      turn = 0;
      continue;
    }
    if (!current) {
      current = { index: 1, user: null, assistants: [] };
      rounds.push(current);
    }
    turn += 1;
    const last = current.assistants.at(-1);
    if (!hasAssistantText(message) && last && last.messages.every((item) => !hasAssistantText(item))) {
      last.messages.push(message);
      last.turnEnd = turn;
      continue;
    }
    current.assistants.push({ messages: [message], turnStart: turn, turnEnd: turn });
  }
  return rounds;
}

export function turnRangeLabel(start: number, end: number): string {
  return start === end ? `Turn ${start}` : `Turn ${start}–${end}`;
}

export function payloadNumber(payload: unknown, key: "round" | "turn"): number | undefined {
  if (!payload || typeof payload !== "object" || !(key in payload)) return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "number" && value > 0 ? value : undefined;
}

export function eventRound(event: TrajectoryEvent, messages: ChatMessage[]): number | undefined {
  const stamped = payloadNumber(event.payload, "round");
  if (stamped) return stamped;
  if (event.messageId) {
    const idx = messages.findIndex((message) => message.id === event.messageId);
    if (idx >= 0) {
      const n = messages.slice(0, idx + 1).filter((message) => message.role === "user").length;
      if (n > 0) return n;
    }
  }
  const n = messages.filter((message) => message.role === "user" && message.createdAt <= event.ts).length;
  return n > 0 ? n : undefined;
}

export function stampEventRound(event: TrajectoryEvent, messages: ChatMessage[]): TrajectoryEvent {
  if (payloadNumber(event.payload, "round")) return event;
  const round = eventRound(event, messages);
  if (!round) return event;
  const payload = event.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return { ...event, payload: { ...(payload as Record<string, unknown>), round } };
  }
  if (payload === undefined) return { ...event, payload: { round } };
  return { ...event, payload: { round, value: payload } };
}

function hasAssistantText(message: ChatMessage): boolean {
  return Boolean(message.content.trim());
}
