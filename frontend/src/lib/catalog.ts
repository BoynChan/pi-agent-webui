import type { PluginSummary, ProviderConfig, ProviderType, ProviderWireConfig } from "@pi-debug/shared";

export const CLIENT_PLUGINS: PluginSummary[] = [
  {
    id: "client.local-sessions",
    name: "local-sessions",
    kind: "other",
    source: "client",
    enabled: true,
    description: "Persists sessions, chat, and trajectory in IndexedDB on this machine.",
    origin: "browser://indexeddb",
  },
  {
    id: "client.connector-vault",
    name: "connector-vault",
    kind: "other",
    source: "client",
    enabled: true,
    description: "Holds LLM provider configs and API keys in localStorage. Never sent except on run.",
    origin: "browser://localStorage",
  },
];

export function mergePlugins(backend: PluginSummary[], client = CLIENT_PLUGINS): PluginSummary[] {
  const seen = new Set(backend.map((p) => p.id));
  return [...backend, ...client.filter((p) => !seen.has(p.id))];
}

export function providerWire(provider: ProviderConfig | undefined): ProviderWireConfig | null {
  if (!provider?.apiKey) return null;
  return {
    type: provider.type,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: provider.defaultModel,
  };
}

export const PROVIDER_PRESETS: Array<{
  type: ProviderType;
  name: string;
  baseUrl: string;
  model: string;
}> = [
  { type: "openai-compatible", name: "OpenAI-compatible", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1" },
  { type: "openai-compatible", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { type: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-5" },
  { type: "custom", name: "Custom gateway", baseUrl: "http://127.0.0.1:8000/v1", model: "local-model" },
];
