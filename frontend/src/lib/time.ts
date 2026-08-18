export function uid(prefix = "id"): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 10)}`;
}

export function relativeTime(ts: number, now = Date.now()): string {
  const delta = Math.max(0, now - ts);
  const sec = Math.round(delta / 1000);
  if (sec < 20) return "just now";
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 10) return `${day}d`;
  return new Date(ts).toLocaleDateString();
}

export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
