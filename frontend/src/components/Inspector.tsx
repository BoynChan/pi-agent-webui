import type {
  ChatMessage,
  PluginDetail,
  PluginKind,
  PluginSummary,
  TrajectoryEvent,
  TrajectoryEventType,
} from "@pi-debug/shared";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useMemo, useState } from "react";
import { JsonTree } from "./JsonTree";
import { eventRound, payloadNumber } from "../lib/rounds";
import { useAppStore } from "../state/useAppStore";
import { clock } from "../lib/time";

const KINDS: PluginKind[] = ["skill", "mcp", "tool", "scp", "other"];
const KIND_LABEL: Record<PluginKind, string> = {
  skill: "Skills",
  mcp: "MCP",
  tool: "Tools",
  scp: "SCP",
  other: "Other plugins",
};

const EVENT_FILTERS: Array<{ id: TrajectoryEventType | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "thinking", label: "Think" },
  { id: "user", label: "User" },
  { id: "text", label: "Text" },
  { id: "skill_load", label: "Skill" },
  { id: "tool_call", label: "Tool" },
  { id: "tool_result", label: "Result" },
  { id: "context", label: "Prompt" },
  { id: "error", label: "Error" },
];

export function Inspector() {
  const tab = useAppStore((s) => s.inspectorTab);
  const setInspectorTab = useAppStore((s) => s.setInspectorTab);
  return (
    <aside className="flex min-h-0 h-full w-full flex-col bg-panel">
      <div className="flex border-b border-hair">
        {(["plugins", "trajectory"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setInspectorTab(id)}
            className={`flex-1 px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] ${
              tab === id ? "bg-inset text-scope" : "text-mute hover:text-ink"
            }`}
          >
            {id === "plugins" ? "Plugins" : "Trajectory"}
          </button>
        ))}
      </div>
      {tab === "plugins" ? <PluginsTab /> : <TrajectoryTab />}
    </aside>
  );
}

function PluginsTab() {
  const plugins = useAppStore((s) => s.plugins);
  const snapshot = useAppStore((s) => s.current?.pluginSnapshot ?? []);
  const selectedPluginId = useAppStore((s) => s.selectedPluginId);
  const pluginDetail = useAppStore((s) => s.pluginDetail);
  const pluginDetailError = useAppStore((s) => s.pluginDetailError);
  const openPlugin = useAppStore((s) => s.openPlugin);
  const refreshPlugins = useAppStore((s) => s.refreshPlugins);
  const runtimeInfo = useAppStore((s) => s.runtimeInfo);
  const collapsedPluginKinds = useAppStore((s) => s.collapsedPluginKinds);
  const togglePluginKind = useAppStore((s) => s.togglePluginKind);
  const [rescanning, setRescanning] = useState(false);

  const list = plugins.length > 0 ? plugins : snapshot;
  const cwd = runtimeInfo?.cwd;
  const selected = list.find((plugin) => plugin.id === selectedPluginId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-faint">
        <span className="truncate" title={cwd}>
          {cwd ? cwd.replace(/^\/Users\/[^/]+/, "~") : "Session catalog"}
        </span>
        <button
          type="button"
          className="shrink-0 text-mute hover:text-ink"
          onClick={() => {
            setRescanning(true);
            void refreshPlugins().finally(() => setRescanning(false));
          }}
        >
          {rescanning ? "Scanning…" : "Refresh"}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {KINDS.map((kind) => {
          const items = list.filter((p) => p.kind === kind);
          if (items.length === 0 && kind !== "mcp") return null;
          const collapsed = collapsedPluginKinds.includes(kind);
          return (
            <section key={kind} className="mb-3">
              <div className="mb-1 flex items-center gap-1 px-1">
                <button
                  type="button"
                  aria-expanded={!collapsed}
                  aria-label={collapsed ? `Show ${KIND_LABEL[kind]}` : `Hide ${KIND_LABEL[kind]}`}
                  title={collapsed ? "Show group" : "Hide group"}
                  onClick={() => togglePluginKind(kind)}
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] font-mono text-[10px] leading-none text-faint hover:bg-bezel hover:text-ink"
                >
                  {collapsed ? "▸" : "▾"}
                </button>
                <h2 className="min-w-0 flex-1 font-mono text-[10px] uppercase tracking-[0.18em] text-mute">
                  {KIND_LABEL[kind]}
                  <span className="ml-2 text-faint">{items.length}</span>
                </h2>
              </div>
              {collapsed ? null : items.length === 0 && kind === "mcp" ? (
                <p className="px-2 pb-2 text-[12px] text-mute">
                  No MCP servers. Add one in <span className="font-mono">.mcp.json</span>, then click Refresh.
                </p>
              ) : null}
              {collapsed
                ? null
                : items.map((plugin) => (
                    <PluginRow
                      key={plugin.id}
                      plugin={plugin}
                      active={selectedPluginId === plugin.id}
                      onOpen={() => void openPlugin(plugin.id)}
                    />
                  ))}
            </section>
          );
        })}
        {list.length === 0 ? (
          <p className="px-2 py-6 text-[12px] text-mute">
            No skills or tools yet. Drop a <span className="font-mono">SKILL.md</span> under{" "}
            <span className="font-mono">.pi/skills</span> or <span className="font-mono">~/.pi/agent/skills</span>
            , then click Refresh.
          </p>
        ) : null}
      </div>
      <PluginDetailPane
        selected={selected}
        detail={pluginDetail}
        error={pluginDetailError}
      />
    </div>
  );
}

function PluginDetailPane({
  selected,
  detail,
  error,
}: {
  selected: PluginSummary | undefined;
  detail: PluginDetail | null;
  error: string | null;
}) {
  if (!selected) {
    return (
      <p className="shrink-0 border-t border-hair px-3 py-2 text-[12px] text-faint">
        Click a plugin to see its description. Skills show the SKILL.md summary; MCP servers show the transport.
      </p>
    );
  }

  const name = detail?.name ?? selected.name;
  const description = detail?.description || selected.description;
  const origin = detail?.origin ?? selected.origin ?? selected.source;
  const filePath = detail?.filePath;
  const content = detail?.content;
  const language = detail?.contentLanguage;
  const showBody = Boolean(content) && content !== description;

  return (
    <div className="max-h-[46%] shrink-0 overflow-y-auto border-t border-hair bg-inset px-3 py-3">
      <div className="text-[13px] font-medium">{name}</div>
      <div className="mt-1 font-mono text-[10px] text-faint">
        {selected.kind}
        {origin ? ` · ${origin}` : ""}
        {filePath && filePath !== origin ? ` · ${filePath}` : ""}
      </div>
      {error ? <p className="mt-2 text-[12px] text-rose">{error}</p> : null}
      {description ? (
        <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-mute">{description}</p>
      ) : (
        <p className="mt-2 text-[12px] text-faint">No description.</p>
      )}
      {showBody ? (
        <details className="mt-3 border-t border-hair pt-2">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wide text-faint hover:text-ink">
            {selected.kind === "skill" ? "SKILL.md" : selected.kind === "tool" ? "Schema" : "Details"}
          </summary>
          <div className="markdown mt-2">
            {language === "markdown" ? (
              <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
            ) : (
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-mute">{content}</pre>
            )}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function PluginRow({
  plugin,
  active,
  onOpen,
}: {
  plugin: PluginSummary;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`mb-0.5 flex w-full items-start justify-between gap-2 rounded-[3px] px-2 py-1.5 text-left ${
        active ? "bg-chassis ring-1 ring-scope/30" : "hover:bg-bezel"
      }`}
    >
      <span>
        <span className="block text-[12.5px]">{plugin.name}</span>
        <span className="block truncate font-mono text-[10px] text-faint">{plugin.origin ?? plugin.source}</span>
      </span>
      <span className={`mt-0.5 font-mono text-[9px] uppercase ${plugin.enabled ? "text-moss" : "text-rose"}`}>
        {plugin.enabled ? "on" : "off"}
      </span>
    </button>
  );
}

function TrajectoryTab() {
  const events = useAppStore((s) => s.current?.trajectory ?? []);
  const messages = useAppStore((s) => s.current?.messages ?? []);
  const highlightMessage = useAppStore((s) => s.highlightMessage);
  const highlightTrajectoryId = useAppStore((s) => s.highlightTrajectoryId);
  const setInspectorTab = useAppStore((s) => s.setInspectorTab);
  const [filter, setFilter] = useState<TrajectoryEventType | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!highlightTrajectoryId) return;
    setFilter("all");
    setExpandedId(highlightTrajectoryId);
    window.requestAnimationFrame(() => {
      document.getElementById(`tr-${highlightTrajectoryId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [highlightTrajectoryId]);

  const visible = events.filter((e) => filter === "all" || e.type === filter || related(filter, e.type));

  const segments = useMemo(() => events.map((e) => colorFor(e.type)), [events]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 py-2">
        <div className="scope-bar" title="Event overview — one slice per recorded event">
          {segments.length === 0 ? (
            <div className="h-full flex-1 bg-hair/40" />
          ) : (
            segments.map((color, i) => <span key={i} className="scope-seg" style={{ background: color }} />)
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {EVENT_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                filter === f.id ? "bg-inset text-scope" : "text-faint hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {visible.length === 0 ? (
          <p className="py-8 text-[12px] text-mute">
            Trajectory is empty. Send a prompt — PI Agent records thinking, skill reads, and tool calls on this
            session.
          </p>
        ) : (
          visible.map((event) => {
            const expanded = expandedId === event.id;
            const loop = loopLabel(event, messages);
            const preview = eventPreview(event);
            const jumped = highlightTrajectoryId === event.id;
            return (
              <div
                id={`tr-${event.id}`}
                key={event.id}
                className={`lane lane-${event.type} mb-2 w-full rounded-[3px] bg-inset/60 px-2 py-1.5 text-left ${
                  expanded || jumped ? "ring-1 ring-scope/30" : ""
                } ${jumped ? "flash-hit" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setExpandedId(expanded ? null : event.id);
                    if (event.messageId) highlightMessage(event.messageId);
                  }}
                  className="w-full text-left hover:text-ink"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-wide text-mute">
                      {event.type}
                      {loop}
                    </span>
                    <span className="font-mono text-[10px] text-faint">{clock(event.ts)}</span>
                  </div>
                  <div className="text-[12.5px]">{event.title}</div>
                  {!expanded && preview ? (
                    <div className="mt-0.5 line-clamp-4 font-mono text-[11px] text-mute">{preview}</div>
                  ) : null}
                </button>
                {expanded ? <ExpandedEvent event={event} /> : null}
              </div>
            );
          })
        )}
      </div>
      <p className="border-t border-hair px-3 py-2 font-mono text-[10px] text-faint">
        Click a row to jump to the chat block. The arrow on a message jumps back here.{" "}
        <button type="button" className="text-scope" onClick={() => setInspectorTab("plugins")}>
          Plugins
        </button>
      </p>
    </div>
  );
}

function ExpandedEvent({ event }: { event: TrajectoryEvent }) {
  const value = expandedValue(event);
  if (value !== undefined && value !== null && typeof value === "object") {
    return <JsonTree value={value} />;
  }
  if (typeof value === "string" && value) {
    return (
      <pre className="mt-1.5 max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-mute">
        {value}
      </pre>
    );
  }
  return null;
}

function expandedValue(event: TrajectoryEvent): unknown {
  const payload = event.payload;
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (record.message !== undefined) return record.message;
    if (typeof record.thinking === "string" && record.thinking.length > 0) return record.thinking;
    const args = toolArgs(payload);
    if (args !== undefined) return args;
  }
  return event.detail;
}

function toolArgs(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;
  if ("args" in record) return record.args;
  return undefined;
}

function eventPreview(event: TrajectoryEvent): string | undefined {
  const args = toolArgs(event.payload);
  if (event.type === "tool_call" && args !== undefined) {
    try {
      return JSON.stringify(args);
    } catch {
      /* fall through */
    }
  }
  return event.detail;
}

function loopLabel(event: TrajectoryEvent, messages: ChatMessage[]): string {
  const round = eventRound(event, messages);
  const turn = payloadNumber(event.payload, "turn");
  const parts: string[] = [];
  if (round != null) parts.push(`round ${round}`);
  if (turn != null) parts.push(`turn ${turn}`);
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
}

function related(filter: TrajectoryEventType | "all", type: TrajectoryEventType): boolean {
  if (filter === "tool_call") return type === "tool_result";
  return false;
}

function colorFor(type: TrajectoryEvent["type"]): string {
  switch (type) {
    case "tool_call":
    case "tool_result":
      return "var(--color-copper)";
    case "thinking":
      return "var(--color-violet)";
    case "text":
      return "var(--color-scope)";
    case "user":
      return "var(--color-sand)";
    case "skill_load":
      return "var(--color-sand)";
    case "context":
      return "var(--color-moss)";
    case "error":
      return "var(--color-rose)";
    default:
      return "var(--color-faint)";
  }
}
