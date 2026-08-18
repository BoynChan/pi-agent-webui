import { useEffect } from "react";
import { ChatPane } from "./ChatPane";
import { Inspector } from "./Inspector";
import { SessionSidebar } from "./SessionSidebar";
import { SettingsModal } from "./SettingsModal";
import { StatusBar } from "./StatusBar";
import { useAppStore } from "../state/useAppStore";

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

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-mute">
        Restoring local sessions…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_360px]">
        <SessionSidebar />
        <ChatPane />
        <Inspector />
      </div>
      <StatusBar />
      {settingsOpen ? <SettingsModal /> : null}
    </div>
  );
}
