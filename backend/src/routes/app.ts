import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { RunRequest } from "@pi-debug/shared";
import type { AgentRuntime } from "../runtime/types.ts";

const VERSION = "0.1.0";

export function createApp(runtime: AgentRuntime): Hono {
  const app = new Hono();
  const inflight = new Map<string, AbortController>();

  app.get("/health", (c) =>
    c.json({ ok: true as const, runtime: runtime.name, version: VERSION, info: runtime.info() }),
  );

  app.get("/api/plugins", (c) =>
    c.json({ plugins: runtime.listPlugins(), runtime: runtime.name, info: runtime.info() }),
  );

  app.post("/api/plugins/reload", async (c) => {
    await runtime.reload();
    return c.json({ plugins: runtime.listPlugins(), runtime: runtime.name, info: runtime.info() });
  });

  app.get("/api/plugins/:id", (c) => {
    const detail = runtime.getPlugin(c.req.param("id"));
    if (!detail) return c.json({ error: "Plugin not found" }, 404);
    return c.json(detail);
  });

  app.post("/api/sessions/:id/stop", (c) => {
    const sessionId = c.req.param("id");
    inflight.get(sessionId)?.abort();
    runtime.stop(sessionId);
    return c.json({ ok: true });
  });

  app.post("/api/sessions/:id/run", async (c) => {
    const sessionId = c.req.param("id");
    let body: RunRequest;
    try {
      body = (await c.req.json()) as RunRequest;
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    inflight.get(sessionId)?.abort();
    const controller = new AbortController();
    inflight.set(sessionId, controller);
    const runId = `run_${crypto.randomUUID().slice(0, 10)}`;

    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache, no-transform");
    c.header("Connection", "keep-alive");
    c.header("X-Accel-Buffering", "no");

    return streamSSE(c, async (stream) => {
      stream.onAbort(() => {
        controller.abort();
        runtime.stop(sessionId);
      });
      try {
        for await (const event of runtime.runTurn({
          sessionId,
          runId,
          messages: body.messages ?? [],
          pluginIds: body.pluginIds,
          provider: body.provider,
          systemPrompt: body.systemPrompt,
          abortSignal: controller.signal,
        })) {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : String(error);
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ type: "error", message }),
          });
        }
      } finally {
        if (inflight.get(sessionId) === controller) inflight.delete(sessionId);
      }
    });
  });

  return app;
}
