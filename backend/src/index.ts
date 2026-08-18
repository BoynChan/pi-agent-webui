import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createApp } from "./routes/app.ts";
import { createRuntime } from "./runtime/create-runtime.ts";

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
