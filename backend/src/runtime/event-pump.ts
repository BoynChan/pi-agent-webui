import type { RuntimeEvent } from "@pi-debug/shared";

/** Async queue that turns push-style PI events into an async iterable. */
export class EventPump {
  private readonly queue: RuntimeEvent[] = [];
  private readonly waiters: Array<() => void> = [];
  private closed = false;

  push(event: RuntimeEvent): void {
    if (this.closed) return;
    this.queue.push(event);
    this.waiters.shift()?.();
  }

  close(): void {
    this.closed = true;
    while (this.waiters.length > 0) this.waiters.shift()?.();
  }

  async *iterate(): AsyncIterable<RuntimeEvent> {
    while (true) {
      const next = this.queue.shift();
      if (next) {
        yield next;
        continue;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }
}
