import type { PluginDetail, PluginListResponse, RunRequest, RuntimeEvent } from "@pi-debug/shared";

export async function fetchHealth(): Promise<{ ok: boolean; runtime?: string }> {
  try {
    const res = await fetch("/health");
    if (!res.ok) return { ok: false };
    return (await res.json()) as { ok: boolean; runtime?: string };
  } catch {
    return { ok: false };
  }
}

export async function fetchPlugins(): Promise<PluginListResponse> {
  const res = await fetch("/api/plugins");
  if (!res.ok) throw new Error(`plugins ${res.status}`);
  return (await res.json()) as PluginListResponse;
}

export async function reloadPlugins(): Promise<PluginListResponse> {
  const res = await fetch("/api/plugins/reload", { method: "POST" });
  if (!res.ok) throw new Error(`reload ${res.status}`);
  return (await res.json()) as PluginListResponse;
}

export async function fetchPlugin(id: string): Promise<PluginDetail> {
  const res = await fetch(`/api/plugins/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`plugin ${res.status}`);
  return (await res.json()) as PluginDetail;
}

export async function stopRun(sessionId: string): Promise<void> {
  await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/stop`, { method: "POST" });
}

export async function* streamRun(
  sessionId: string,
  body: RunRequest,
  signal: AbortSignal,
): AsyncGenerator<RuntimeEvent> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `run ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const data = part
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) continue;
      try {
        yield JSON.parse(data) as RuntimeEvent;
      } catch {
        // skip malformed frames
      }
    }
  }
}
