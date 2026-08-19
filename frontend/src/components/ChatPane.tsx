import type { ChatMessage, ToolCallCard } from "@pi-debug/shared";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../state/useAppStore";

export function ChatPane() {
  const current = useAppStore((s) => s.current);
  const streaming = useAppStore((s) => s.streaming);
  const streamError = useAppStore((s) => s.streamError);
  const providers = useAppStore((s) => s.providers);
  const activeProviderId = useAppStore((s) => s.activeProviderId);
  const setActiveProvider = useAppStore((s) => s.setActiveProvider);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);

  return (
    <section className="flex min-h-0 flex-col border-r border-hair bg-chassis">
      <header className="flex items-center justify-between gap-3 border-b border-hair px-4 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">{current?.title ?? "No session"}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            {current ? `${current.messages.length} messages · ${current.trajectory.length} events` : "—"}
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
          Left: sessions persisted in this browser. Center: the turn you are debugging. Right: plugins
          discovered from this PI process (skills, tools, SCP) plus the trajectory ledger.
        </p>
        <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-mute">
          After you add a skill under <span className="font-mono">~/.pi/agent/skills</span>, click Refresh on
          the Plugins tab (or reload this page).
        </p>
        <ul className="mt-6 space-y-2 font-mono text-[12px] text-mute">
          <li>1. Optional: open Connectors and add an OpenAI-compatible or Anthropic endpoint.</li>
          <li>2. Send a prompt. PI Agent runs against this workspace with the selected connector.</li>
          <li>3. Open Trajectory and click a row to expand it — system prompt is the Prompt event.</li>
        </ul>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      {current.messages.map((message) => (
        <MessageBlock
          key={message.id}
          message={message}
          highlight={highlightMessageId === message.id}
        />
      ))}
      <div ref={bottom} />
    </div>
  );
}

function MessageBlock({ message, highlight }: { message: ChatMessage; highlight: boolean }) {
  const roleLabel =
    message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : message.role === "tool" ? "Tool" : "System";

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
      </div>
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
