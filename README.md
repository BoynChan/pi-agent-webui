# PI Agent Debug UI

Local Web UI for debugging [PI Agent](https://github.com/earendil-works/pi) (`@earendil-works/pi-agent-core`), laid out like [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): sessions on the left, conversation in the center, plugins + trajectory on the right.

This is a frontend/backend split. The browser owns sessions, chat, traces, and LLM keys. The backend is the future PI Agent embed point: it exposes a plugin registry and a streaming run API.

## Layout

```
┌────────────┬──────────────────────────┬─────────────────┐
│ Sessions   │ Chat / tool cards        │ Plugins         │
│ create     │ markdown + thinking      │  skills         │
│ rename     │ composer send / stop     │  tools          │
│ delete     │                          │  SCP packets    │
│            │                          │ Trajectory      │
│ Connectors │                          │  event ledger   │
└────────────┴──────────────────────────┴─────────────────┘
```

Harness influence (not a pixel clone):

- Three-column AppFrame (sidebar / conversation / details), matching `dsh-client-ui-layout`.
- Session list + New session + settings in the left rail (`dsh-client-ui-sidebar`).
- Trajectory as a turn-aware event ledger with type-colored lanes and a time overview bar (`dsh-client-ui-trajectory`).
- Plugins grouped the way Harness treats capabilities: skills, tools, SCP (session context packets / context injection), other.
- “Model-visible means recorded”: context injection shows up as trajectory `context` events.

## Stack

- Frontend: Vite 6, React 19, TypeScript, Tailwind 4
- Backend: Hono on Node, SSE
- Storage: IndexedDB (`idb-keyval`) for sessions; `localStorage` for connector keys and UI prefs

## Run locally (Mac)

This repo uses **pnpm workspaces** (this machine maps `npm` to pnpm). From the repo root:

```sh
cd pi-agent-webui-1
cp .env.example .env   # optional; no secrets
pnpm install
pnpm dev
```

- UI: http://127.0.0.1:5173
- API: http://127.0.0.1:8787 (`GET /health`)

Separate processes:

```sh
pnpm dev:backend
pnpm dev:frontend
```

Send a prompt with a connector selected (⌘,). The backend embeds **PI Agent** (`@earendil-works/pi-coding-agent`): it discovers skills and tools from disk, streams thinking / tool cards / trajectory, and executes the real `read` / `bash` / `edit` / `write` (plus grep/find/ls and extension tools) in `PI_DEBUG_CWD`.

After you add a new `SKILL.md` or extension tool, click **Refresh** on the Plugins tab (or reload the page). That runs `POST /api/plugins/reload` and rescans disk. The next chat turn sees the updated catalog.

## Where data lives

| What | Where |
| --- | --- |
| Sessions, messages, trajectory, plugin snapshots | Browser IndexedDB (`pi-debug.session.*`) |
| LLM provider configs + API keys | Browser `localStorage` (`pi-debug.providers.v1`) |
| Active session / panel prefs | Browser `localStorage` (`pi-debug.ui.v1`) |
| Registered skills / tools / SCP | Backend process, discovered from disk (`GET /api/plugins`, `POST /api/plugins/reload`) |

Keys are sent only on `POST /api/sessions/:id/run` and are not written to disk by the server. Do not commit `.env` with secrets; this repo never asks you to put keys in files.

## Connectors

Footer **Connectors** (⌘,) adds providers:

- **OpenAI-compatible** — DeepSeek, OpenRouter, Ollama, company gateways
- **Anthropic** — `x-api-key` + `/v1/messages`
- **Custom** — same wire as OpenAI-compatible, any base URL

The active connector is chosen per session in the chat header. Keys stay in the browser and are attached to the PI `ModelRuntime` only for that run (not written to `~/.pi/agent/auth.json`).

## Backend contract

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Runtime name + workspace info |
| GET | `/api/plugins` | Skills, tools, SCP, other |
| POST | `/api/plugins/reload` | Rescan skills / tools / extensions from disk |
| GET | `/api/plugins/:id` | Detail + file/schema contents |
| POST | `/api/sessions/:id/run` | SSE stream of `RuntimeEvent` |
| POST | `/api/sessions/:id/stop` | Abort the in-flight run |

`AgentRuntime` (`backend/src/runtime/types.ts`):

```
registerTool / registerSkill / registerPlugin
runTurn({ messages, plugins, providerConfig, abortSignal }) -> async iterable events
```

Default `createRuntime()` embeds PI Agent (`PiAgentRuntime`). Set `PI_DEBUG_RUNTIME=stub` for the in-process demo catalog.

Skill discovery: **only** `~/.pi/agent/skills` (or `PI_AGENT_DIR/skills`). Codex/Agent Skills under `~/.agents/skills`, project `.agents/skills`, `<cwd>/.pi/skills`, and `<cwd>/skills` are not loaded.

Tools come from PI’s built-ins (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) plus any coding-agent extensions/custom tools. Clicking **Refresh** calls `session.reload()` so a newly dropped `SKILL.md` or extension is visible in the Plugins tab **and** injected on the next turn.

## Workspace

```sh
export PI_DEBUG_CWD=/path/to/the/repo/you/want/pi/to/edit
pnpm dev
```

Coding tools (`read`/`write`/`bash`/…) run against that directory. Do not import the DeepSeek Harness repo into this project.

## Keyboard

- ⌘N / Ctrl+N — new session
- ⌘, / Ctrl+, — connectors
- Alt+↑ / Alt+↓ — previous / next session
- Esc — close modal or stop stream
- Enter — send (Shift+Enter newline)

## Scripts

```sh
pnpm dev           # both sides
pnpm typecheck
pnpm build
```
