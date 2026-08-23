import { useMemo, useState } from "react";

const HIDDEN_KEYS = new Set([
  "usage",
  "cost",
  "diagnostics",
  "timestamp",
  "api",
  "provider",
  "model",
  "responseModel",
  "responseId",
  "stopReason",
  "rawStopReason",
  "endTurn",
  "deferred",
  "errorMessage",
  "cacheRead",
  "cacheWrite",
  "totalTokens",
]);

export function JsonTree({ value }: { value: unknown }) {
  const hiddenCount = useMemo(() => countHidden(value), [value]);
  const [showHidden, setShowHidden] = useState(false);

  return (
    <div
      className="json-tree mt-1.5 max-h-96 overflow-auto font-mono text-[11px] leading-relaxed"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowHidden((v) => !v)}
          className="mb-1 font-mono text-[10px] uppercase tracking-wide text-faint hover:text-ink"
        >
          {showHidden ? "Hide metadata" : `Show ${hiddenCount} hidden fields`}
        </button>
      ) : null}
      <TreeNode name={null} value={value} path="$" depth={0} showHidden={showHidden} />
    </div>
  );
}

function TreeNode({
  name,
  value,
  path,
  depth,
  showHidden,
}: {
  name: string | null;
  value: unknown;
  path: string;
  depth: number;
  showHidden: boolean;
}) {
  const container = isContainer(value);
  const [open, setOpen] = useState(() => defaultOpen(name, value, depth));

  if (!container) {
    return (
      <div className="flex gap-2 py-px">
        {name != null ? <span className={nameClass(name)}>{name}</span> : null}
        <Leaf value={value} />
      </div>
    );
  }

  const entries = containerEntries(value, showHidden);
  const kind = Array.isArray(value) ? `[${value.length}]` : `{${Object.keys(value as object).length}}`;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline gap-1.5 py-px text-left hover:text-ink"
      >
        <span className="w-3 shrink-0 text-faint">{open ? "▾" : "▸"}</span>
        {name != null ? <span className={nameClass(name)}>{name}</span> : null}
        <span className="text-faint">{kind}</span>
      </button>
      {open ? (
        <div className="ml-3 border-l border-hair/80 pl-2">
          {entries.length === 0 ? <div className="text-faint">empty</div> : null}
          {entries.map(([key, child]) => (
            <TreeNode
              key={`${path}.${key}`}
              name={key}
              value={child}
              path={`${path}.${key}`}
              depth={depth + 1}
              showHidden={showHidden}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Leaf({ value }: { value: unknown }) {
  if (value === null) return <span className="text-faint">null</span>;
  if (typeof value === "boolean") return <span className="text-moss">{String(value)}</span>;
  if (typeof value === "number") return <span className="text-moss">{value}</span>;
  if (typeof value === "string") {
    return (
      <span className="min-w-0 flex-1 select-text whitespace-pre-wrap break-words text-ink">{value}</span>
    );
  }
  return <span className="text-mute">{String(value)}</span>;
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return Boolean(value) && typeof value === "object";
}

function containerEntries(value: Record<string, unknown> | unknown[], showHidden: boolean): Array<[string, unknown]> {
  if (Array.isArray(value)) {
    return value.map((child, index) => [`[${index}]`, child]);
  }
  return Object.entries(value).filter(([key]) => showHidden || !HIDDEN_KEYS.has(key));
}

function defaultOpen(name: string | null, value: unknown, depth: number): boolean {
  if (depth === 0) return true;
  if (name === "content" || name === "messages") return true;
  if (name?.startsWith("[") && isContainer(value)) return true;
  if (isRecord(value) && ("text" in value || "thinking" in value || "type" in value)) return true;
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nameClass(name: string): string {
  return name.startsWith("[") ? "text-copper" : "text-scope";
}

function countHidden(value: unknown): number {
  if (!isRecord(value)) return 0;
  return Object.keys(value).filter((key) => HIDDEN_KEYS.has(key)).length;
}
