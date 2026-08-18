---
name: debug-harness
description: How to inspect this local PI Agent Web UI — sessions, connectors, plugins, and trajectory.
---

# Debug harness

Use this skill when the user is exploring the PI Agent debug UI itself.

## Layout
- Left: browser-local sessions (IndexedDB)
- Center: the current turn
- Right → Plugins: skills, tools, SCP discovered from this PI process
- Right → Trajectory: tool calls, skill reads, context injection

## After adding a skill or tool
1. Write a `SKILL.md` under `~/.pi/agent/skills/<name>/`. This UI does not load `<cwd>/.pi/skills` or Codex `~/.agents/skills`.
2. Click **Refresh** on the Plugins tab (or reload the page). The backend rescans disk; the next run injects the new catalog into the system prompt.
3. Custom tools/extensions also require Refresh — a full `session.reload()`.

## Connectors
API keys live in this browser (`localStorage`) and are forwarded per run. They are not written to `~/.pi/agent/auth.json`.
