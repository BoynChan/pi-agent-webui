import type { PluginKind, PluginSummary, TrajectoryEvent, TrajectoryEventType } from "@pi-debug/shared";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useMemo, useState } from "react";
import { useAppStore } from "../state/useAppStore";
import { clock } from "../lib/time";

const KINDS: PluginKind[] = ["skill", "tool", "scp", "other"];
const KIND_LABEL: Record<PluginKind, string> = {
  skill: "Skills",
  tool: "Tools",
  scp: "SCP",
  other: "Other plugins",
};

const EVENT_FILTERS: Array<{ id: TrajectoryEventType | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "thinking", label: "Think" },
  { id: "text", label: "Text" },
  { id: "skill_load", label: "Skill" },
  { id: "tool_call", label: "Tool" },
  { id: "tool_result", label: "Result" },
  { id: "context", label: "SCP" },
  { id: "error", label: "Error" },
];

export function Inspector() {
  const tab = useAppStore((s) => s.inspectorTab);
  const setInspectorTab = useAppStore((s) => s.setInspectorTab);
  return (
    <aside className="flex min-h-0 flex-col bg-panel">
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
  const [rescanning, setRescanning] = useState(false);

  const list = plugins.length > 0 ? plugins : snapshot;
  const cwd = runtimeInfo?.cwd;

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
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {KINDS.map((kind) => {
          const items = list.filter((p) => p.kind === kind);
          if (items.length === 0) return null;
          return (
            <section key={kind} className="mb-3">
              <h2 className="px-2 pb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-mute">
                {KIND_LABEL[kind]}
                <span className="ml-2 text-faint">{items.length}</span>
              </h2>
              {items.map((plugin) => (
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
            <span className="font-mono">~/.pi/agent/skills</span>, then click Refresh.
          </p>
        ) : null}
        {selectedPluginId ? (
          <div className="mt-2 rounded-[3px] border border-hair bg-inset p-3">
            {pluginDetailError ? <p className="text-[12px] text-rose">{pluginDetailError}</p> : null}
            {!pluginDetail && !pluginDetailError ? (
              <p className="font-mono text-[11px] text-mute">Loading plugin…</p>
            ) : null}
            {pluginDetail ? (
              <div>
                <div className="text-[13px] font-medium">{pluginDetail.name}</div>
                <div className="mt-1 font-mono text-[10px] text-faint">
                  {pluginDetail.kind} · {pluginDetail.origin ?? pluginDetail.source}
                  {pluginDetail.filePath ? ` · ${pluginDetail.filePath}` : ""}
                </div>
                <p className="mt-2 text-[12px] text-mute">{pluginDetail.description}</p>
                {pluginDetail.content ? (
                  <div className="markdown mt-3 max-h-80 overflow-auto border-t border-hair pt-3">
                    {pluginDetail.contentLanguage === "markdown" ? (
                      <Markdown remarkPlugins={[remarkGfm]}>{pluginDetail.content}</Markdown>
                    ) : (
                      <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-mute">
                        {pluginDetail.content}
                      </pre>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="px-2 pt-2 text-[12px] text-faint">
            Select a plugin to read its schema or SKILL.md. After you add a skill or tool on disk, click Refresh — a
            browser reload also rescans.
          </p>
        )}
      </div>
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
  const highlightMessage = useAppStore((s) => s.highlightMessage);
  const setInspectorTab = useAppStore((s) => s.setInspectorTab);
  const [filter, setFilter] = useState<TrajectoryEventType | "all">("all");

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
          visible.map((event) => (
            <button
              key={event.id}
              type="button"
              onClick={() => {
                if (event.messageId) highlightMessage(event.messageId);
              }}
              className={`lane lane-${event.type} mb-2 w-full rounded-[3px] bg-inset/60 px-2 py-1.5 text-left hover:bg-inset`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wide text-mute">{event.type}</span>
                <span className="font-mono text-[10px] text-faint">{clock(event.ts)}</span>
              </div>
              <div className="text-[12.5px]">{event.title}</div>
              {event.detail ? (
                <div className="mt-0.5 line-clamp-3 font-mono text-[11px] text-mute">{event.detail}</div>
              ) : null}
            </button>
          ))
        )}
      </div>
      <p className="border-t border-hair px-3 py-2 font-mono text-[10px] text-faint">
        Click a row to flash the chat block.{" "}
        <button type="button" className="text-scope" onClick={() => setInspectorTab("plugins")}>
          Plugins
        </button>
      </p>
    </div>
  );
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
