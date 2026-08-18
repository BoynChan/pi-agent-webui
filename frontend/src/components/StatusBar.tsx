import { useAppStore } from "../state/useAppStore";

export function StatusBar() {
  const backendOk = useAppStore((s) => s.backendOk);
  const backendRuntime = useAppStore((s) => s.backendRuntime);
  const streaming = useAppStore((s) => s.streaming);
  const providers = useAppStore((s) => s.providers);
  const activeProviderId = useAppStore((s) => s.activeProviderId);
  const current = useAppStore((s) => s.current);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const provider = providers.find((p) => p.id === activeProviderId);

  return (
    <footer className="flex items-center gap-4 border-t border-hair bg-panel px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
      <span className="flex items-center gap-2">
        {streaming ? <span className="pulse-dot" /> : <span className="h-[7px] w-[7px] rounded-full bg-faint" />}
        {streaming ? "Live" : "Idle"}
      </span>
      <span className={backendOk ? "text-moss" : "text-rose"}>
        {backendOk ? `backend · ${backendRuntime}` : "backend down"}
      </span>
      <button type="button" className="hover:text-ink" onClick={() => setSettingsOpen(true)}>
        {provider ? `${provider.name} · ${provider.defaultModel}` : "no connector"}
      </button>
      <span className="ml-auto">
        {current ? `${current.messages.length} msg · ${current.trajectory.length} tr` : "local store"}
      </span>
    </footer>
  );
}
