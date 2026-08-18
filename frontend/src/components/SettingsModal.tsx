import { useState, type ReactNode } from "react";
import type { ProviderConfig, ProviderType } from "@pi-debug/shared";
import { PROVIDER_PRESETS } from "../lib/catalog";
import { uid } from "../lib/time";
import { useAppStore } from "../state/useAppStore";

export function SettingsModal() {
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const providers = useAppStore((s) => s.providers);
  const upsertProvider = useAppStore((s) => s.upsertProvider);
  const removeProvider = useAppStore((s) => s.removeProvider);
  const activeProviderId = useAppStore((s) => s.activeProviderId);
  const setActiveProvider = useAppStore((s) => s.setActiveProvider);
  const [editing, setEditing] = useState<ProviderConfig | null>(null);

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-chassis/70 p-6" onClick={() => setSettingsOpen(false)}>
      <div
        className="bezel max-h-[88vh] w-full max-w-2xl overflow-hidden rounded-[4px]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-hair px-4 py-3">
          <div>
            <div className="text-[13px] font-medium">Connectors</div>
            <div className="font-mono text-[10px] uppercase tracking-wide text-faint">
              Stored in this browser · forwarded per run · never written by the server
            </div>
          </div>
          <button type="button" className="text-[12px] text-mute hover:text-ink" onClick={() => setSettingsOpen(false)}>
            Close
          </button>
        </header>

        <div className="grid max-h-[calc(88vh-52px)] grid-cols-[220px_minmax(0,1fr)]">
          <div className="border-r border-hair p-3">
            <button
              type="button"
              className="mb-3 w-full rounded-[3px] border border-dashed border-hair px-2 py-1.5 text-left text-[12px] text-mute hover:text-ink"
              onClick={() => setEditing(blankProvider())}
            >
              Add provider
            </button>
            {providers.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setEditing(p)}
                className={`mb-1 w-full rounded-[3px] px-2 py-2 text-left ${
                  editing?.id === p.id ? "bg-inset text-ink" : "text-mute hover:text-ink"
                }`}
              >
                <div className="truncate text-[12.5px]">{p.name}</div>
                <div className="truncate font-mono text-[10px] text-faint">{p.defaultModel}</div>
              </button>
            ))}
            {providers.length === 0 ? (
              <p className="px-1 text-[12px] text-mute">None yet. Add a gateway to leave demo mode.</p>
            ) : null}
          </div>
          <div className="overflow-y-auto p-4">
            {editing ? (
              <ProviderForm
                value={editing}
                active={activeProviderId === editing.id}
                onChange={setEditing}
                onSave={() => {
                  upsertProvider(editing);
                  setActiveProvider(editing.id);
                }}
                onDelete={() => {
                  removeProvider(editing.id);
                  setEditing(null);
                }}
              />
            ) : (
              <p className="text-[13px] text-mute">
                Pick a provider or add one. OpenAI-compatible covers DeepSeek, OpenRouter, Ollama, and most internal
                gateways. Anthropic uses <span className="font-mono">x-api-key</span>.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function blankProvider(): ProviderConfig {
  const preset = PROVIDER_PRESETS[0]!;
  return {
    id: uid("prv"),
    name: preset.name,
    type: preset.type,
    baseUrl: preset.baseUrl,
    apiKey: "",
    defaultModel: preset.model,
  };
}

function ProviderForm({
  value,
  active,
  onChange,
  onSave,
  onDelete,
}: {
  value: ProviderConfig;
  active: boolean;
  onChange: (next: ProviderConfig) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const patch = (partial: Partial<ProviderConfig>) => onChange({ ...value, ...partial });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <label className="block text-[11px] uppercase tracking-wide text-mute">
        Preset
        <select
          className="mt-1 w-full rounded-[3px] border border-hair bg-inset px-2 py-1.5 text-[13px] text-ink"
          value=""
          onChange={(e) => {
            const preset = PROVIDER_PRESETS.find((p) => p.name === e.target.value);
            if (!preset) return;
            patch({
              name: preset.name,
              type: preset.type,
              baseUrl: preset.baseUrl,
              defaultModel: preset.model,
            });
          }}
        >
          <option value="">Apply a starting point…</option>
          {PROVIDER_PRESETS.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <Field label="Name">
        <input value={value.name} onChange={(e) => patch({ name: e.target.value })} className="field" />
      </Field>
      <Field label="Protocol">
        <select
          value={value.type}
          onChange={(e) => patch({ type: e.target.value as ProviderType })}
          className="field"
        >
          <option value="openai-compatible">OpenAI-compatible</option>
          <option value="anthropic">Anthropic</option>
          <option value="custom">Custom (OpenAI-compatible wire)</option>
        </select>
      </Field>
      <Field label="Base URL">
        <input value={value.baseUrl} onChange={(e) => patch({ baseUrl: e.target.value })} className="field font-mono" />
      </Field>
      <Field label="Default model">
        <input
          value={value.defaultModel}
          onChange={(e) => patch({ defaultModel: e.target.value })}
          className="field font-mono"
        />
      </Field>
      <Field label="API key">
        <input
          type="password"
          autoComplete="off"
          value={value.apiKey}
          onChange={(e) => patch({ apiKey: e.target.value })}
          className="field font-mono"
          placeholder="stays in localStorage"
        />
      </Field>
      <div className="flex items-center gap-2 pt-2">
        <button type="submit" className="rounded-[3px] bg-scope px-3 py-1.5 text-[12px] font-medium text-chassis">
          Save in browser
        </button>
        <button type="button" onClick={onDelete} className="text-[12px] text-rose">
          Delete
        </button>
        {active ? <span className="ml-auto font-mono text-[10px] uppercase text-moss">Active</span> : null}
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-[11px] uppercase tracking-wide text-mute">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
