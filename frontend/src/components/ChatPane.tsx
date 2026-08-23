import type { ChatMessage, ToolCallCard, TrajectoryEvent } from "@pi-debug/shared";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { groupChatRounds, turnRangeLabel } from "../lib/rounds";
import { useAppStore } from "../state/useAppStore";

export function ChatPane() {
  const current = useAppStore((s) => s.current);
  const streaming = useAppStore((s) => s.streaming);
  const streamError = useAppStore((s) => s.streamError);
  const stopNotice = useAppStore((s) => s.stopNotice);
  const providers = useAppStore((s) => s.providers);
  const activeProviderId = useAppStore((s) => s.activeProviderId);
  const setActiveProvider = useAppStore((s) => s.setActiveProvider);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-chassis">
      <header className="flex items-center justify-between gap-3 border-b border-hair px-4 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">{current?.title ?? "No session"}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            {current
              ? `${current.messages.filter((m) => m.role === "user").length} rounds · ${current.messages.length} messages · ${current.trajectory.length} events`
              : "—"}
          </div>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-mute">
          Model
          <select
            value={activeProviderId ?? ""}
            onChange={(e) => setActiveProvider(e.target.value || null)}
            className="max-w-[220px] rounded-[3px] border border-hair bg-inset px-2 py-1 text-[12px] text-ink"
          >
            <option value="">No connector</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.defaultModel}
              </option>
            ))}
          </select>
        </label>
      </header>

      <MessageList />

      {stopNotice ? (
        <div className="border-t border-sand/35 bg-sand/10 px-4 py-2 font-mono text-[12px] text-sand">
          {stopNotice}
        </div>
      ) : null}
      {streamError ? (
        <div className="border-t border-rose/30 bg-rose/10 px-4 py-2 text-[12px] text-rose">
          {streamError}{" "}
          <button type="button" className="underline" onClick={() => setSettingsOpen(true)}>
            Check connectors
          </button>
        </div>
      ) : null}

      <Composer disabled={!current || streaming} streaming={streaming} />
    </section>
  );
}

function MessageList() {
  const current = useAppStore((s) => s.current);
  const highlightMessageId = useAppStore((s) => s.highlightMessageId);
  const retry = useAppStore((s) => s.retry);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [current?.messages, current?.messages.at(-1)?.content]);

  useEffect(() => {
    if (!highlightMessageId) return;
    document.getElementById(`msg-${highlightMessageId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightMessageId]);

  if (!current || current.messages.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-scope">Empty session</p>
        <h1 className="mt-2 max-w-xl text-[22px] font-medium leading-snug">
          Local debug bench for PI Agent.
        </h1>
        <p className="mt-3 max-w-xl text-[13.5px] leading-relaxed text-mute">
          Left: sessions persisted in this browser. Center: the round you are debugging. Right: plugins
          discovered from this PI process (skills, tools, MCP, SCP) plus the trajectory ledger. The
          agent identity is a personal assistant — it reads the live tool / MCP / skill catalog each turn.
        </p>
        <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-mute">
          After you add a skill under <span className="font-mono">.pi/skills</span> in this repo or{" "}
          <span className="font-mono">~/.pi/agent/skills</span>, click Refresh on the Plugins tab (or reload
          this page).
        </p>
        <ul className="mt-6 space-y-2 font-mono text-[12px] text-mute">
          <li>1. Optional: open Connectors and add an OpenAI-compatible or Anthropic endpoint.</li>
          <li>2. Send a prompt. PI Agent runs against this workspace with the selected connector.</li>
          <li>3. Open Trajectory and click a row to expand it — system prompt is the Prompt event.</li>
        </ul>
      </div>
    );
  }

  const rounds = groupChatRounds(current.messages);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
      {rounds.map((round) => (
        <section key={round.user?.id ?? round.assistants[0]?.messages[0]?.id ?? `round-${round.index}`} className="mb-5">
          <div className="mb-2 flex items-center gap-2 px-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-sand">Round {round.index}</span>
            <span className="h-px flex-1 bg-hair" />
          </div>
          {round.user ? (
            <UserRoundRow
              user={round.user}
              highlight={highlightMessageId === round.user.id}
              onRetry={(id, text) => void retry(id, text)}
            />
          ) : null}
          {round.assistants.map((row, index) => (
            <ChatRow key={row.messages[0]?.id} turnLabel={turnRangeLabel(row.turnStart, row.turnEnd)}>
              <AssistantGroup
                messages={row.messages}
                highlightId={highlightMessageId}
                interim={index < round.assistants.length - 1}
              />
            </ChatRow>
          ))}
        </section>
      ))}
      <div ref={bottom} />
    </div>
  );
}

function UserRoundRow({
  user,
  highlight,
  onRetry,
}: {
  user: ChatMessage;
  highlight: boolean;
  onRetry: (id: string, text?: string) => void;
}) {
  return (
    <ChatRow turnLabel={null}>
      <MessageBlock message={user} highlight={highlight} onRetry={(text) => onRetry(user.id, text)} />
    </ChatRow>
  );
}

function ChatRow({
  turnLabel,
  children,
}: {
  turnLabel: string | null;
  children: ReactNode;
}) {
  return (
    <div className="mb-3 flex gap-2">
      <div className="w-16 shrink-0 pt-2 text-right font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
        {turnLabel}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function hasAssistantText(message: ChatMessage): boolean {
  return Boolean(message.content.trim());
}

function AssistantGroup({
  messages,
  highlightId,
  interim,
}: {
  messages: ChatMessage[];
  highlightId: string | null;
  interim: boolean;
}) {
  const first = messages[0];
  if (!first) return null;
  const highlight = messages.some((message) => message.id === highlightId);
  const last = messages[messages.length - 1] ?? first;
  const textMessage = [...messages].reverse().find(hasAssistantText);

  return (
    <article className={`rounded-[3px] px-3 py-2 ${highlight ? "flash-hit" : ""}`}>
      {messages.map((message) => (
        <div key={message.id} id={`msg-${message.id}`} />
      ))}
      <div className="mb-1 flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
        <span className={interim ? "text-faint" : "text-scope"}>Assistant</span>
        <span>{new Date(first.createdAt).toLocaleTimeString()}</span>
        {messages.length > 1 ? (
          <span className="text-faint">
            {new Date(last.createdAt).toLocaleTimeString() !== new Date(first.createdAt).toLocaleTimeString()
              ? `– ${new Date(last.createdAt).toLocaleTimeString()}`
              : `${messages.length} calls`}
          </span>
        ) : null}
        <JumpToTrajectory messages={messages} className="ml-auto" />
      </div>
      {messages.map((message) =>
        message.thinking ? (
          <details
            key={`${message.id}-think`}
            className="mb-2 rounded-[3px] border border-hair bg-inset px-3 py-2 text-[12px] text-mute"
          >
            <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wide text-violet">
              Thinking
            </summary>
            <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{message.thinking}</pre>
          </details>
        ) : null,
      )}
      {textMessage ? (
        <div className={interim ? "markdown markdown-interim" : "markdown"}>
          <Markdown remarkPlugins={[remarkGfm]}>{textMessage.content}</Markdown>
        </div>
      ) : null}
      {messages.flatMap((message) => message.toolCalls ?? []).map((call) => (
        <ToolCard key={call.id} call={call} />
      ))}
    </article>
  );
}

function MessageBlock({
  message,
  highlight,
  onRetry,
}: {
  message: ChatMessage;
  highlight: boolean;
  onRetry?: (content?: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const roleLabel =
    message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : message.role === "tool" ? "Tool" : "System";

  useEffect(() => {
    if (!editing) return;
    setDraft(message.content);
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    el.selectionStart = el.value.length;
    el.selectionEnd = el.value.length;
  }, [editing, message.content]);

  const commitEdit = () => {
    const next = draft.trim();
    if (!next || !onRetry) return;
    setEditing(false);
    onRetry(next);
  };

  return (
    <article
      id={`msg-${message.id}`}
      className={`mb-4 rounded-[3px] px-3 py-2 ${highlight ? "flash-hit" : ""}`}
    >
      <div className="mb-1 flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
        <span className={message.role === "user" ? "text-sand" : message.role === "assistant" ? "text-scope" : "text-mute"}>
          {roleLabel}
        </span>
        <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
        <span className="ml-auto flex items-center gap-2">
          <JumpToTrajectory messages={[message]} />
          {onRetry && !editing ? (
            <>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-mute hover:text-sand"
                title="Edit this prompt, then regenerate from here"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onRetry()}
                className="text-mute hover:text-sand"
                title="Retry this prompt and clear messages and trajectory below"
              >
                Retry
              </button>
            </>
          ) : null}
        </span>
      </div>
      {editing ? (
        <div>
          <textarea
            ref={editorRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
                setDraft(message.content);
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commitEdit();
              }
            }}
            rows={Math.min(12, Math.max(3, draft.split("\n").length + 1))}
            className="mt-1 w-full resize-none rounded-[3px] border border-sand/40 bg-inset px-3 py-2 text-[13px] leading-relaxed text-ink"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(message.content);
              }}
              className="font-mono text-[10px] uppercase tracking-wide text-mute hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={commitEdit}
              disabled={!draft.trim()}
              className="rounded-[3px] bg-sand px-2.5 py-1 text-[12px] font-medium text-chassis disabled:opacity-40"
            >
              Regenerate
            </button>
          </div>
        </div>
      ) : (
        <>
      {message.thinking ? (
        <details className="mb-2 rounded-[3px] border border-hair bg-inset px-3 py-2 text-[12px] text-mute">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wide text-violet">Thinking</summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{message.thinking}</pre>
        </details>
      ) : null}
      {message.content ? (
        <div className="markdown">
          <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
        </div>
      ) : (
        <div className="font-mono text-[11px] text-faint">…</div>
      )}
        </>
      )}
      {message.toolCalls?.map((call) => (
        <ToolCard key={call.id} call={call} />
      ))}
    </article>
  );
}

function ToolCard({ call }: { call: ToolCallCard }) {
  const [open, setOpen] = useState(false);
  const args = summarize(call.args);
  return (
    <div
      className={`mt-2 rounded-[3px] bg-inset ${
        call.status === "running" || call.status === "pending"
          ? "tool-card-running"
          : call.status === "aborted"
            ? "border border-sand/40"
            : "border border-copper/35"
      }`}
    >
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen((v) => !v)}>
        <span className="font-mono text-[11px] text-copper">{call.name}</span>
        <span className="truncate font-mono text-[11px] text-mute">{args}</span>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-wide text-faint">{call.status}</span>
      </button>
      {open ? (
        <div className="border-t border-hair px-3 py-2 font-mono text-[11px] leading-relaxed text-mute">
          <div className="text-[10px] uppercase tracking-wide text-faint">Arguments</div>
          <pre className="mt-1 whitespace-pre-wrap">{JSON.stringify(call.args, null, 2)}</pre>
          {call.resultSnippet ? (
            <>
              <div className="mt-2 text-[10px] uppercase tracking-wide text-faint">Result</div>
              <pre className="mt-1 whitespace-pre-wrap">{call.resultSnippet}</pre>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function JumpToTrajectory({
  messages,
  className,
}: {
  messages: ChatMessage[];
  className?: string;
}) {
  const events = useAppStore((s) => s.current?.trajectory ?? []);
  const jumpToTrajectory = useAppStore((s) => s.jumpToTrajectory);
  const eventId = resolveTrajectoryId(messages, events);
  if (!eventId) return null;
  return (
    <button
      type="button"
      title="Jump to trajectory"
      onClick={() => jumpToTrajectory(eventId)}
      className={`text-mute hover:text-scope ${className ?? ""}`}
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
        <path
          d="M6.5 3.5H13v6.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="square"
        />
        <path
          d="M13 3.5 3.5 13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="square"
        />
      </svg>
    </button>
  );
}

function resolveTrajectoryId(messages: ChatMessage[], events: TrajectoryEvent[]): string | null {
  const ids = new Set(messages.map((message) => message.id));
  const linked = events.filter((event) => event.messageId && ids.has(event.messageId));
  const preferred =
    linked.find((event) => event.type === "turn_start") ??
    linked.find((event) => event.type === "user") ??
    linked.find((event) => event.type === "text") ??
    linked.find((event) => event.type === "tool_call") ??
    linked[0];
  if (preferred) return preferred.id;
  for (const message of messages) {
    const fromMessage = message.trajectoryIds[0];
    if (fromMessage && events.some((event) => event.id === fromMessage)) return fromMessage;
  }
  return null;
}

function summarize(args: unknown): string {
  try {
    const text = JSON.stringify(args);
    return text.length > 90 ? `${text.slice(0, 90)}…` : text;
  } catch {
    return "";
  }
}

function Composer({ disabled, streaming }: { disabled: boolean; streaming: boolean }) {
  const send = useAppStore((s) => s.send);
  const stop = useAppStore((s) => s.stop);
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const onSubmit = () => {
    const text = value;
    setValue("");
    void send(text);
  };

  return (
    <form
      className="border-t border-hair p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (streaming) void stop();
        else onSubmit();
      }}
    >
      <textarea
        ref={ref}
        value={value}
        disabled={disabled && !streaming}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (streaming) void stop();
            else onSubmit();
          }
        }}
        rows={3}
        placeholder="Message PI Agent…"
        className="w-full resize-none rounded-[3px] border border-hair bg-inset px-3 py-2 text-[13px] leading-relaxed text-ink placeholder:text-faint"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="font-mono text-[10px] text-faint">Enter to send · Shift+Enter newline · Esc stops</span>
        <button
          type="submit"
          className="rounded-[3px] bg-scope px-3 py-1 text-[12px] font-medium text-chassis disabled:opacity-40"
          disabled={!streaming && (disabled || !value.trim())}
        >
          {streaming ? "Stop" : "Send"}
        </button>
      </div>
    </form>
  );
}
