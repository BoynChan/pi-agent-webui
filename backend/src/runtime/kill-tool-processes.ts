import { execFileSync } from "node:child_process";

const KEEP = /(?:^|[/\s])(esbuild|tsx|node|vite)(?:\s|$)/;
const ORPHAN_TOOL = /(?:^|[/\s])(bash|sh|zsh|dash|find|grep|sleep)(?:\s|$)/;
const PI_ENV = /PI_(SESSION_ID|MODEL|PROVIDER)=/;

function childPids(ppid: number): number[] {
  try {
    const out = execFileSync("pgrep", ["-P", String(ppid)], {
      encoding: "utf8",
      timeout: 1000,
    });
    return out
      .split(/\s+/)
      .map(Number)
      .filter((pid) => Number.isFinite(pid) && pid > 1);
  } catch {
    return [];
  }
}

function commandOf(pid: number): string {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      timeout: 1000,
    }).trim();
  } catch {
    return "";
  }
}

function descendantPids(rootPid: number): number[] {
  const found: number[] = [];
  const seen = new Set<number>();
  const stack = [...childPids(rootPid)];
  while (stack.length > 0) {
    const pid = stack.pop();
    if (pid === undefined || seen.has(pid)) continue;
    seen.add(pid);
    found.push(pid);
    stack.push(...childPids(pid));
  }
  return found;
}

/** Direct children of the backend, minus tsx/esbuild watchers, plus their trees. */
function collectAttachedToolPids(rootPid: number): number[] {
  const found = new Set<number>();
  for (const pid of childPids(rootPid)) {
    const command = commandOf(pid);
    if (!command || KEEP.test(command)) continue;
    found.add(pid);
    for (const child of descendantPids(pid)) found.add(child);
  }
  return [...found];
}

/**
 * PI bash injects PI_SESSION_ID / PI_MODEL. After `bash -c` execs, the process
 * may be reparented to pid 1 and disappear from our child walk.
 */
function collectPiEnvPids(): number[] {
  try {
    const rows = execFileSync("ps", ["-ax", "-o", "pid=", "-o", "ppid=", "-o", "command="], {
      encoding: "utf8",
      timeout: 2000,
    })
      .trim()
      .split("\n");

    const found: number[] = [];
    for (const line of rows) {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) continue;
      const pid = Number(match[1]);
      const ppid = Number(match[2]);
      const command = match[3] ?? "";
      if (pid === process.pid || (ppid !== 1 && ppid !== 0) || !ORPHAN_TOOL.test(command)) continue;
      try {
        const envLine = execFileSync("ps", ["eww", "-p", String(pid), "-o", "command="], {
          encoding: "utf8",
          timeout: 400,
        });
        if (PI_ENV.test(envLine)) found.push(pid);
      } catch {
        // Process vanished or env is unreadable.
      }
    }
    return found;
  } catch {
    return [];
  }
}

function killPid(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Not a process-group leader.
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

/** Kill bash/find descendants spawned by PI tools. Leaves tsx/esbuild/node watchers alone. */
export function killToolChildProcesses(rootPid = process.pid): void {
  const pids = new Set([...collectAttachedToolPids(rootPid), ...collectPiEnvPids()]);
  for (const pid of pids) killPid(pid);
}
