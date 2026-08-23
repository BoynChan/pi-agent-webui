import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createApp } from "./routes/app.ts";
import { createRuntime } from "./runtime/create-runtime.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
loadDotEnv(resolve(repoRoot, ".env"));
const skillPath = [
  resolve(repoRoot, ".venv/bin"),
  "/opt/homebrew/bin",
  "/Applications/LibreOffice.app/Contents/MacOS",
].join(":");
process.env.PATH = `${skillPath}:${process.env.PATH ?? ""}`;

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const host = process.env.PI_DEBUG_HOST ?? "127.0.0.1";
const port = Number(process.env.PI_DEBUG_PORT ?? "8787");
const origin = process.env.PI_DEBUG_CORS_ORIGIN ?? "http://127.0.0.1:5173";

const runtime = await createRuntime();
const app = new Hono();

app.use(
  "*",
  cors({
    origin: [origin, "http://localhost:5173", "http://127.0.0.1:5173"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);
app.route("/", createApp(runtime));

serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`PI debug backend ${runtime.name}  http://${info.address}:${info.port}`);
});
