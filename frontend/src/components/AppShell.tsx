import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChatPane } from "./ChatPane";
import { Inspector } from "./Inspector";
import { SessionSidebar } from "./SessionSidebar";
import { SettingsModal } from "./SettingsModal";
import { StatusBar } from "./StatusBar";
import { useAppStore } from "../state/useAppStore";

const INSPECTOR_MIN = 280;
const INSPECTOR_MAX = 720;
const CHAT_MIN = 320;
const SIDEBAR_OPEN = 260;
const SIDEBAR_RAIL = 44;

function clampInspectorWidth(width: number, sidebarCollapsed: boolean): number {
  const sidebar = sidebarCollapsed ? SIDEBAR_RAIL : SIDEBAR_OPEN;
  const max = Math.max(INSPECTOR_MIN, Math.min(INSPECTOR_MAX, window.innerWidth - sidebar - CHAT_MIN));
  return Math.round(Math.min(max, Math.max(INSPECTOR_MIN, width)));
}

export function AppShell() {
  const hydrate = useAppStore((s) => s.hydrate);
  const ready = useAppStore((s) => s.ready);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const createSession = useAppStore((s) => s.createSession);
  const sessions = useAppStore((s) => s.sessions);
  const currentId = useAppStore((s) => s.currentId);
  const selectSession = useAppStore((s) => s.selectSession);
  const stop = useAppStore((s) => s.stop);
  const streaming = useAppStore((s) => s.streaming);
  const inspectorWidth = useAppStore((s) => s.inspectorWidth);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const setInspectorWidth = useAppStore((s) => s.setInspectorWidth);
  const commitLayout = useAppStore((s) => s.commitLayout);
  const [draggingInspector, setDraggingInspector] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => {
      void fetch("/health")
        .then(async (r) => {
          if (r.ok) await useAppStore.getState().syncPlugins();
        })
        .catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(id);
  }, [ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void createSession();
      }
      if (meta && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      }
      if (e.key === "Escape") {
        if (settingsOpen) setSettingsOpen(false);
        else if (streaming) void stop();
      }
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const idx = sessions.findIndex((s) => s.id === currentId);
        if (idx < 0) return;
        const next = e.key === "ArrowUp" ? idx - 1 : idx + 1;
        const target = sessions[next];
        if (target) void selectSession(target.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createSession, currentId, selectSession, sessions, setSettingsOpen, settingsOpen, stop, streaming]);

  useEffect(() => {
    const onResize = () => {
      const state = useAppStore.getState();
      const next = clampInspectorWidth(state.inspectorWidth, state.sidebarCollapsed);
      if (next !== state.inspectorWidth) state.setInspectorWidth(next);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onHandlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingInspector(true);
    document.body.classList.add("is-col-resizing");
  };

  const onHandlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!draggingInspector) return;
    const right = shellRef.current?.getBoundingClientRect().right ?? window.innerWidth;
    setInspectorWidth(clampInspectorWidth(right - event.clientX, sidebarCollapsed));
  };

  const endInspectorDrag = () => {
    if (!draggingInspector) return;
    setDraggingInspector(false);
    document.body.classList.remove("is-col-resizing");
    commitLayout();
  };

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-mute">
        Restoring local sessions…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={shellRef} className="flex min-h-0 flex-1">
        <SessionSidebar />
        <ChatPane />
        <button
          type="button"
          aria-label="Resize plugins panel"
          title="Drag to resize"
          className={`inspector-split ${draggingInspector ? "is-dragging" : ""}`}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={endInspectorDrag}
          onPointerCancel={endInspectorDrag}
        />
        <div
          className={`inspector-pane flex min-h-0 shrink-0 flex-col ${draggingInspector ? "is-dragging" : ""}`}
          style={{ width: inspectorWidth }}
        >
          <Inspector />
        </div>
      </div>
      <StatusBar />
      {settingsOpen ? <SettingsModal /> : null}
    </div>
  );
}
