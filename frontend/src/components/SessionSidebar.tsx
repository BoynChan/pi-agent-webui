import { useState } from "react";
import { relativeTime } from "../lib/time";
import { useAppStore } from "../state/useAppStore";

export function SessionSidebar() {
  const sessions = useAppStore((s) => s.sessions);
  const currentId = useAppStore((s) => s.currentId);
  const createSession = useAppStore((s) => s.createSession);
  const selectSession = useAppStore((s) => s.selectSession);
  const renameSession = useAppStore((s) => s.renameSession);
  const removeSession = useAppStore((s) => s.removeSession);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  return (
    <aside
      className={`sidebar-pane flex min-h-0 shrink-0 flex-col border-r border-hair bg-panel ${
        collapsed ? "sidebar-pane-collapsed" : ""
      }`}
      style={{ width: collapsed ? 44 : 260 }}
    >
      {collapsed ? (
        <div className="flex flex-1 flex-col items-center pt-3">
          <button
            type="button"
            aria-label="Open sessions"
            title="Open sidebar"
            onClick={() => setSidebarCollapsed(false)}
            className="sidebar-open-btn flex h-8 w-8 items-center justify-center rounded-[3px] bg-inset font-mono text-[13px] text-scope hover:bg-bezel hover:text-ink"
          >
            π
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 px-3 py-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-[3px] bg-inset font-mono text-[11px] text-scope">
              π
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-mute">PI Agent</div>
              <div className="font-mono text-[11px] text-faint">debug harness</div>
            </div>
            <button
              type="button"
              aria-label="Collapse sessions"
              title="Collapse sidebar"
              onClick={() => setSidebarCollapsed(true)}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] font-mono text-[12px] text-faint hover:bg-bezel hover:text-ink"
            >
              ‹
            </button>
          </div>

          <div className="sidebar-body px-3 pb-2">
            <button
              type="button"
              onClick={() => void createSession()}
              className="w-full rounded-[3px] border border-hair bg-inset px-2 py-1.5 text-left text-[12.5px] text-ink hover:border-scope/40"
            >
              New session
              <span className="float-right font-mono text-[10px] text-faint">⌘N</span>
            </button>
          </div>

          <div className="sidebar-body min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {sessions.length === 0 ? (
              <p className="px-2 py-6 text-[12px] text-mute">No sessions yet.</p>
            ) : (
              sessions.map((session) => {
                const active = session.id === currentId;
                return (
                  <div
                    key={session.id}
                    className={`group mb-0.5 rounded-[3px] px-2 py-2 ${active ? "bg-inset ring-1 ring-scope/35" : "hover:bg-bezel"}`}
                  >
                    <button type="button" className="block w-full text-left" onClick={() => void selectSession(session.id)}>
                      {editing === session.id ? (
                        <input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={() => {
                            if (draft.trim()) void renameSession(session.id, draft.trim());
                            setEditing(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") setEditing(null);
                          }}
                          className="w-full rounded-[2px] border border-hair bg-chassis px-1 py-0.5 text-[13px]"
                        />
                      ) : (
                        <div className="truncate text-[13px]">{session.title}</div>
                      )}
                      <div className="mt-0.5 flex items-center justify-between gap-2 font-mono text-[10px] text-faint">
                        <span>{relativeTime(session.updatedAt)}</span>
                      </div>
                      <div className="mt-1 truncate text-[11px] text-mute">{session.preview}</div>
                    </button>
                    <div className="mt-1 hidden gap-2 group-hover:flex group-focus-within:flex">
                      <button
                        type="button"
                        className="font-mono text-[10px] uppercase tracking-wide text-mute hover:text-ink"
                        onClick={() => {
                          setEditing(session.id);
                          setDraft(session.title);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="font-mono text-[10px] uppercase tracking-wide text-rose hover:text-ink"
                        onClick={() => void removeSession(session.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="sidebar-body border-t border-hair p-3">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="w-full text-left text-[12px] text-mute hover:text-ink"
            >
              Connectors
              <span className="float-right font-mono text-[10px] text-faint">⌘,</span>
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
