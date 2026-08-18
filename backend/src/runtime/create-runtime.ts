import { StubRuntime } from "./stub-runtime.ts";
import type { AgentRuntime } from "./types.ts";

/**
 * Default runtime is the real PI Agent (`@earendil-works/pi-coding-agent`).
 * Set PI_DEBUG_RUNTIME=stub to keep the in-process demo catalog.
 */
export async function createRuntime(): Promise<AgentRuntime> {
  const mode = process.env.PI_DEBUG_RUNTIME ?? "pi";
  if (mode === "stub") {
    return new StubRuntime();
  }
  const { createPiRuntime } = await import("./pi-runtime.ts");
  return createPiRuntime();
}
