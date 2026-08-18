import { del, get, set } from "idb-keyval";
import type { ChatMessage, PluginSummary, ProviderConfig, TrajectoryEvent } from "@pi-debug/shared";

export const SETTINGS_KEY = "pi-debug.providers.v1";
export const UI_KEY = "pi-debug.ui.v1";
export const SESSION_INDEX_KEY = "pi-debug.session-index.v1";

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  preview: string;
  providerId: string | null;
}

export interface SessionRecord extends SessionMeta {
  messages: ChatMessage[];
  trajectory: TrajectoryEvent[];
  pluginSnapshot: PluginSummary[];
}

export interface UiPrefs {
  activeSessionId: string | null;
  activeProviderId: string | null;
  inspectorTab: "plugins" | "trajectory";
  sidebarWidth: number;
  inspectorWidth: number;
}

export interface StoredProviders {
  providers: ProviderConfig[];
}

function sessionKey(id: string): string {
  return `pi-debug.session.${id}`;
}

export function loadProviders(): ProviderConfig[] {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredProviders;
    return Array.isArray(parsed.providers) ? parsed.providers : [];
  } catch {
    return [];
  }
}

export function saveProviders(providers: ProviderConfig[]): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ providers } satisfies StoredProviders));
}

export function loadUiPrefs(): Partial<UiPrefs> {
  try {
    const raw = localStorage.getItem(UI_KEY);
    return raw ? (JSON.parse(raw) as UiPrefs) : {};
  } catch {
    return {};
  }
}

export function saveUiPrefs(prefs: UiPrefs): void {
  localStorage.setItem(UI_KEY, JSON.stringify(prefs));
}

export async function loadSessionIndex(): Promise<SessionMeta[]> {
  return (await get<SessionMeta[]>(SESSION_INDEX_KEY)) ?? [];
}

export async function saveSessionIndex(index: SessionMeta[]): Promise<void> {
  await set(SESSION_INDEX_KEY, index);
}

export async function loadSession(id: string): Promise<SessionRecord | undefined> {
  return get<SessionRecord>(sessionKey(id));
}

export async function saveSession(record: SessionRecord): Promise<void> {
  await set(sessionKey(record.id), record);
}

export async function deleteSession(id: string): Promise<void> {
  await del(sessionKey(id));
}
