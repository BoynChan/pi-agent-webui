import { create } from "zustand";
import type {
  ChatMessage,
  PluginDetail,
  PluginSummary,
  ProviderConfig,
  RuntimeEvent,
  RuntimeInfo,
} from "@pi-debug/shared";
import { fetchHealth, fetchPlugin, fetchPlugins, reloadPlugins, stopRun, streamRun } from "../lib/api";
import { mergePlugins, providerWire } from "../lib/catalog";
import { stampEventRound } from "../lib/rounds";
import {
  deleteSession,
  loadProviders,
  loadSession,
  loadSessionIndex,
  loadUiPrefs,
  saveProviders,
  saveSession,
  saveSessionIndex,
  saveUiPrefs,
  type SessionMeta,
  type SessionRecord,
  type UiPrefs,
} from "../lib/storage";
import { uid } from "../lib/time";

export interface AppState {
  ready: boolean;
  backendOk: boolean;
  backendRuntime: string;
  sessions: SessionMeta[];
  currentId: string | null;
  current: SessionRecord | null;
  providers: ProviderConfig[];
  activeProviderId: string | null;
  plugins: PluginSummary[];
  runtimeInfo: RuntimeInfo | null;
  pluginDetail: PluginDetail | null;
  pluginDetailError: string | null;
  inspectorTab: "plugins" | "trajectory";
  settingsOpen: boolean;
  streaming: boolean;
  streamError: string | null;
  highlightMessageId: string | null;
  highlightTrajectoryId: string | null;
  selectedPluginId: string | null;
  sidebarWidth: number;
  inspectorWidth: number;
  hydrate: () => Promise<void>;
  refreshPlugins: () => Promise<void>;
  syncPlugins: () => Promise<void>;
  createSession: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  removeSession: (id: string) => Promise<void>;
  setInspectorTab: (tab: "plugins" | "trajectory") => void;
  setSettingsOpen: (open: boolean) => void;
  upsertProvider: (provider: ProviderConfig) => void;
  removeProvider: (id: string) => void;
  setActiveProvider: (id: string | null) => void;
  openPlugin: (id: string) => Promise<void>;
  send: (text: string) => Promise<void>;
  retry: (messageId: string, content?: string) => Promise<void>;
  stop: () => Promise<void>;
  highlightMessage: (id: string | null) => void;
  jumpToTrajectory: (id: string | null) => void;
}

function metaOf(record: SessionRecord): SessionMeta {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    preview: record.preview,
    providerId: record.providerId,
  };
}

function titleFrom(text: string): string {
  const line = text.trim().split("\n")[0] ?? "Untitled session";
  return line.slice(0, 48) || "Untitled session";
}

let persistTimer: number | undefined;
function persistUi(get: () => AppState): void {
  const s = get();
  const prefs: UiPrefs = {
    activeSessionId: s.currentId,
    activeProviderId: s.activeProviderId,
    inspectorTab: s.inspectorTab,
    sidebarWidth: s.sidebarWidth,
    inspectorWidth: s.inspectorWidth,
  };
  saveUiPrefs(prefs);
}

async function persistCurrent(record: SessionRecord, sessions: SessionMeta[]): Promise<void> {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(async () => {
    await saveSession(record);
    await saveSessionIndex(sessions.map((m) => (m.id === record.id ? metaOf(record) : m)));
  }, 80);
}

function applyEvent(record: SessionRecord, event: RuntimeEvent): SessionRecord {
  const next: SessionRecord = {
    ...record,
    messages: [...record.messages],
    trajectory: [...record.trajectory],
    updatedAt: Date.now(),
  };

  const patchMessage = (id: string, fn: (m: ChatMessage) => ChatMessage) => {
    const idx = next.messages.findIndex((m) => m.id === id);
    if (idx >= 0) {
      const current = next.messages[idx];
      if (current) next.messages[idx] = fn(current);
    }
  };

  switch (event.type) {
    case "message_start":
      next.messages.push(event.message);
      break;
    case "message_delta":
      patchMessage(event.messageId, (m) =>
        event.field === "thinking"
          ? { ...m, thinking: (m.thinking ?? "") + event.delta }
          : { ...m, content: m.content + event.delta },
      );
      break;
    case "message_end":
      patchMessage(event.message.id, (m) => ({
        ...event.message,
        thinking: event.message.thinking ?? m.thinking,
        content: event.message.content || m.content,
        trajectoryIds: m.trajectoryIds,
      }));
      break;
    case "tool_call":
      patchMessage(event.messageId, (m) => {
        const existing = m.toolCalls ?? [];
        const idx = existing.findIndex((t) => t.id === event.toolCall.id);
        const toolCalls = [...existing];
        if (idx >= 0) toolCalls[idx] = event.toolCall;
        else toolCalls.push(event.toolCall);
        return { ...m, toolCalls };
      });
      break;
    case "tool_result":
      patchMessage(event.messageId, (m) => ({
        ...m,
        toolCalls: (m.toolCalls ?? []).map((t) => (t.id === event.toolCall.id ? event.toolCall : t)),
      }));
      break;
    case "trajectory": {
      next.trajectory.push(stampEventRound(event.event, next.messages));
      if (event.event.messageId) {
        patchMessage(event.event.messageId, (m) => ({
          ...m,
          trajectoryIds: [...m.trajectoryIds, event.event.id],
        }));
      }
      break;
    }
    case "error":
      next.trajectory.push(
        stampEventRound(
          {
            id: uid("tr"),
            type: "error",
            ts: Date.now(),
            runId: "client",
            title: "Stream error",
            detail: event.message,
          },
          next.messages,
        ),
      );
      break;
    default:
      break;
  }

  const last = [...next.messages].reverse().find((m) => m.content.trim());
  if (last) next.preview = last.content.replace(/\s+/g, " ").slice(0, 80);
  return next;
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  backendOk: false,
  backendRuntime: "unknown",
  sessions: [],
  currentId: null,
  current: null,
  providers: [],
  activeProviderId: null,
  plugins: [],
  runtimeInfo: null,
  pluginDetail: null,
  pluginDetailError: null,
  inspectorTab: "plugins",
  settingsOpen: false,
  streaming: false,
  streamError: null,
  highlightMessageId: null,
  highlightTrajectoryId: null,
  selectedPluginId: null,
  sidebarWidth: 260,
  inspectorWidth: 360,

  hydrate: async () => {
    const prefs = loadUiPrefs();
    const providers = loadProviders();
    let index = await loadSessionIndex();
    const health = await fetchHealth();
    try {
      await get().refreshPlugins();
    } catch {
      // plugins refresh is best-effort during hydrate
    }

    if (index.length === 0) {
      const blank = newSession(prefs.activeProviderId ?? providers[0]?.id ?? null);
      await saveSession(blank);
      index = [metaOf(blank)];
      await saveSessionIndex(index);
      set({
        ready: true,
        backendOk: health.ok,
        backendRuntime: health.runtime ?? "down",
        providers,
        activeProviderId: prefs.activeProviderId ?? providers[0]?.id ?? null,
        sessions: index,
        currentId: blank.id,
        current: blank,
        inspectorTab: prefs.inspectorTab ?? "plugins",
        sidebarWidth: prefs.sidebarWidth ?? 260,
        inspectorWidth: prefs.inspectorWidth ?? 360,
      });
      persistUi(get);
      return;
    }

    const currentId =
      (prefs.activeSessionId && index.some((s) => s.id === prefs.activeSessionId) && prefs.activeSessionId) ||
      index[0]!.id;
    const current = (await loadSession(currentId)) ?? null;
    set({
      ready: true,
      backendOk: health.ok,
      backendRuntime: health.runtime ?? "down",
      providers,
      activeProviderId: prefs.activeProviderId ?? providers[0]?.id ?? null,
      sessions: index.sort((a, b) => b.updatedAt - a.updatedAt),
      currentId,
      current,
      inspectorTab: prefs.inspectorTab ?? "plugins",
      sidebarWidth: prefs.sidebarWidth ?? 260,
      inspectorWidth: prefs.inspectorWidth ?? 360,
    });
    persistUi(get);
  },

  refreshPlugins: async () => {
    const res = await reloadPlugins();
    set({
      plugins: mergePlugins(res.plugins),
      backendRuntime: res.runtime,
      backendOk: true,
      runtimeInfo: res.info ?? null,
    });
  },

  syncPlugins: async () => {
    const res = await fetchPlugins();
    set({
      plugins: mergePlugins(res.plugins),
      backendRuntime: res.runtime,
      backendOk: true,
      runtimeInfo: res.info ?? get().runtimeInfo,
    });
  },

  createSession: async () => {
    const record = newSession(get().activeProviderId);
    const sessions = [metaOf(record), ...get().sessions];
    await saveSession(record);
    await saveSessionIndex(sessions);
    set({ sessions, currentId: record.id, current: record, streamError: null });
    persistUi(get);
  },

  selectSession: async (id) => {
    if (get().streaming) await get().stop();
    const record = await loadSession(id);
    if (!record) return;
    set({ currentId: id, current: record, streamError: null, selectedPluginId: null, pluginDetail: null });
    persistUi(get);
  },

  renameSession: async (id, title) => {
    const sessions = get().sessions.map((s) => (s.id === id ? { ...s, title, updatedAt: Date.now() } : s));
    set({ sessions });
    if (get().current?.id === id) {
      const current = { ...get().current!, title, updatedAt: Date.now() };
      set({ current });
      await persistCurrent(current, sessions);
    } else {
      const record = await loadSession(id);
      if (record) await persistCurrent({ ...record, title }, sessions);
    }
  },

  removeSession: async (id) => {
    await deleteSession(id);
    let sessions = get().sessions.filter((s) => s.id !== id);
    if (sessions.length === 0) {
      const record = newSession(get().activeProviderId);
      await saveSession(record);
      sessions = [metaOf(record)];
      await saveSessionIndex(sessions);
      set({ sessions, currentId: record.id, current: record });
      persistUi(get);
      return;
    }
    await saveSessionIndex(sessions);
    if (get().currentId === id) {
      const next = sessions[0]!;
      const record = await loadSession(next.id);
      set({ sessions, currentId: next.id, current: record ?? null });
    } else {
      set({ sessions });
    }
    persistUi(get);
  },

  setInspectorTab: (tab) => {
    set({ inspectorTab: tab });
    persistUi(get);
  },

  setSettingsOpen: (open) => set({ settingsOpen: open }),

  upsertProvider: (provider) => {
    const existing = get().providers;
    const providers = existing.some((p) => p.id === provider.id)
      ? existing.map((p) => (p.id === provider.id ? provider : p))
      : [...existing, provider];
    saveProviders(providers);
    set({
      providers,
      activeProviderId: get().activeProviderId ?? provider.id,
    });
    persistUi(get);
  },

  removeProvider: (id) => {
    const providers = get().providers.filter((p) => p.id !== id);
    saveProviders(providers);
    const activeProviderId = get().activeProviderId === id ? (providers[0]?.id ?? null) : get().activeProviderId;
    set({ providers, activeProviderId });
    persistUi(get);
  },

  setActiveProvider: (id) => {
    set({ activeProviderId: id });
    const current = get().current;
    if (current) {
      const next = { ...current, providerId: id, updatedAt: Date.now() };
      set({ current: next });
      void persistCurrent(next, get().sessions);
    }
    persistUi(get);
  },

  openPlugin: async (id) => {
    set({ selectedPluginId: id, pluginDetail: null, pluginDetailError: null, inspectorTab: "plugins" });
    persistUi(get);
    if (id.startsWith("client.")) {
      const summary = get().plugins.find((p) => p.id === id);
      set({
        pluginDetail: summary
          ? {
              ...summary,
              content:
                id === "client.local-sessions"
                  ? "IndexedDB keys:\n  pi-debug.session-index.v1\n  pi-debug.session.<id>\nStores messages, trajectory, and the plugin snapshot for each session."
                  : "localStorage keys:\n  pi-debug.providers.v1  (API keys, base URLs, models)\n  pi-debug.ui.v1         (active session, panel widths)\nKeys are sent to the backend only inside POST /api/sessions/:id/run.",
              contentLanguage: "text",
            }
          : null,
      });
      return;
    }
    try {
      const detail = await fetchPlugin(id);
      set({ pluginDetail: detail });
    } catch (error) {
      set({ pluginDetailError: error instanceof Error ? error.message : String(error) });
    }
  },

  send: async (text) => {
    const trimmed = text.trim();
    if (!trimmed || get().streaming) return;
    let current = get().current;
    if (!current) {
      await get().createSession();
      current = get().current;
    }
    if (!current) return;

    const user: ChatMessage = {
      id: uid("msg"),
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
      trajectoryIds: [],
    };
    const titled = current.messages.length === 0 ? titleFrom(trimmed) : current.title;
    await executeRun(get, set, {
      ...current,
      title: titled,
      messages: [...current.messages, user],
      updatedAt: Date.now(),
      preview: trimmed.slice(0, 80),
      pluginSnapshot: get().plugins,
      providerId: get().activeProviderId,
    });
  },

  retry: async (messageId, content) => {
    if (get().streaming) await get().stop();
    const current = get().current;
    if (!current) return;
    const idx = current.messages.findIndex((message) => message.id === messageId && message.role === "user");
    if (idx < 0) return;
    const user = current.messages[idx];
    if (!user) return;
    const nextContent = (content ?? user.content).trim();
    if (!nextContent) return;
    const patched: SessionRecord = {
      ...current,
      title: idx === 0 ? titleFrom(nextContent) : current.title,
      messages: current.messages.map((message, index) =>
        index === idx ? { ...message, content: nextContent } : message,
      ),
    };
    await executeRun(get, set, truncateForRetry(patched, idx));
  },

  stop: async () => {
    runGeneration += 1;
    const id = get().currentId;
    runAbort?.abort();
    if (id) await stopRun(id).catch(() => undefined);
    set({ streaming: false });
  },

  highlightMessage: (id) => {
    flashSeq += 1;
    const seq = flashSeq;
    set({ highlightMessageId: null });
    if (!id) return;
    window.requestAnimationFrame(() => {
      if (flashSeq !== seq) return;
      set({ highlightMessageId: id });
      window.setTimeout(() => {
        if (flashSeq === seq && get().highlightMessageId === id) set({ highlightMessageId: null });
      }, 1400);
    });
  },

  jumpToTrajectory: (id) => {
    set({ highlightTrajectoryId: id, inspectorTab: "trajectory" });
    persistUi(get);
    if (id) {
      window.setTimeout(() => {
        if (get().highlightTrajectoryId === id) set({ highlightTrajectoryId: null });
      }, 1600);
    }
  },
}));

let runAbort: AbortController | null = null;
let runGeneration = 0;
let flashSeq = 0;

function truncateForRetry(record: SessionRecord, userIndex: number): SessionRecord {
  const user = record.messages[userIndex];
  if (!user) return record;
  const prior = record.messages.slice(0, userIndex);
  const priorIds = new Set(prior.map((message) => message.id));
  return {
    ...record,
    messages: [
      ...prior,
      { ...user, trajectoryIds: [], thinking: undefined, toolCalls: undefined },
    ],
    trajectory: record.trajectory.filter((event) => {
      if (event.messageId) return priorIds.has(event.messageId);
      return event.ts < user.createdAt;
    }),
    updatedAt: Date.now(),
    preview: user.content.replace(/\s+/g, " ").slice(0, 80),
    pluginSnapshot: record.pluginSnapshot,
  };
}

async function executeRun(
  get: () => AppState,
  set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  seeded: SessionRecord,
): Promise<void> {
  const seq = ++runGeneration;
  const sessions = get().sessions.map((s) => (s.id === seeded.id ? metaOf(seeded) : s));
  set({ current: seeded, sessions, streaming: true, streamError: null });
  await persistCurrent(seeded, sessions);

  const provider = get().providers.find((p) => p.id === get().activeProviderId);
  const controller = new AbortController();
  runAbort = controller;

  try {
    let live = seeded;
    for await (const event of streamRun(
      seeded.id,
      {
        sessionId: seeded.id,
        messages: seeded.messages,
        provider: providerWire(provider),
      },
      controller.signal,
    )) {
      if (runGeneration !== seq) return;
      if (event.type === "error") {
        set({ streamError: event.message });
      }
      live = applyEvent(live, event);
      const nextSessions = get().sessions.map((s) => (s.id === live.id ? metaOf(live) : s));
      set({ current: live, sessions: nextSessions });
    }
    if (runGeneration !== seq) return;
    await persistCurrent(
      live,
      get().sessions.map((s) => (s.id === live.id ? metaOf(live) : s)),
    );
  } catch (error) {
    if (runGeneration !== seq) return;
    if ((error as { name?: string }).name !== "AbortError") {
      set({ streamError: error instanceof Error ? error.message : String(error) });
    }
  } finally {
    if (runGeneration === seq) {
      runAbort = null;
      set({ streaming: false });
    }
  }
}

function newSession(providerId: string | null): SessionRecord {
  const ts = Date.now();
  return {
    id: uid("ses"),
    title: "New session",
    createdAt: ts,
    updatedAt: ts,
    preview: "Empty — send a prompt to start a run.",
    providerId,
    messages: [],
    trajectory: [],
    pluginSnapshot: [],
  };
}
