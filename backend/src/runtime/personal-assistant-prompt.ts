import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildSystemPromptOptions, ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import type { McpServerRecord } from "./mcp-catalog.ts";

function realpathOrResolve(path: string): string {
  const resolved = resolve(path);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved.replace(/[/\\]+$/, "") || resolved;
  }
}

function isUnderDir(filePath: string, dir: string): boolean {
  const root = realpathOrResolve(dir);
  const target = realpathOrResolve(filePath);
  if (target === root) return true;
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return target.startsWith(prefix);
}

const homeDir = homedir();
const codexDir = resolve(homeDir, ".codex");
const homeContextNames = new Set(["AGENTS.md", "AGENTS.MD", "AGENTS.override.md", "CLAUDE.md", "CLAUDE.MD"]);

/** Codex / home-level context files must not be folded into the harness system prompt. */
export function isExcludedContextFile(filePath: string): boolean {
  if (isUnderDir(filePath, codexDir)) return true;
  const target = realpathOrResolve(filePath);
  const homeRoot = realpathOrResolve(homeDir);
  if (dirname(target) === homeRoot && homeContextNames.has(target.slice(homeRoot.length + 1))) {
    return true;
  }
  return false;
}

export function filterHarnessContextFiles<T extends { path: string }>(files: T[]): T[] {
  return files.filter((file) => !isExcludedContextFile(file.path));
}

/** PI's default template injects a "Pi documentation" pointer block. Never keep it. */
export function stripPiDocumentation(prompt: string): string {
  return prompt
    .replace(
      /\n*Pi documentation \(read only when the user asks about pi itself[\s\S]*?(?=\n\n[A-Z<\n]|\nCurrent working directory:|$)/,
      "",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const harnessSystemPromptPath = resolve(harnessRoot, ".pi", "SYSTEM.md");

/** Fallback when `.pi/SYSTEM.md` is missing. Keep in the same spirit as that file. */
export const PERSONAL_ASSISTANT_PROMPT = `You are a personal assistant running inside pi, a tool-using agent harness.

Help with whatever the user asks — research, writing, scheduling, messaging, documents, life admin, coding, or anything else. Coding is one capability among many, not your identity. Do not stay inside a coding-only role.

## How you get capabilities

Do not assume a fixed toolbox. Each turn, your real capabilities come from three live sources:

1. **Tools** — the function tools attached to this request, plus the "Live capabilities this turn" list. Read names and descriptions before acting. Built-ins may cover files and shell; MCP servers and extensions may add domain tools.
2. **Skills** — specialized playbooks in \`<available_skills>\`. When a skill matches the task, read its SKILL.md with the \`read\` tool first, then follow it. Resolve relative paths against that skill's directory. Do not reconstruct a skill from memory.
3. **MCP** — Model Context Protocol servers expose extra tools (docs, search, calendar, mail, chat, and so on). If an MCP tool exists for the domain, prefer it over improvising.

If a needed capability is missing, say so and suggest enabling a skill, MCP server, or tool. Do not pretend you can do it.

## Working style

- Be concrete. Prefer using a tool over describing what you would do.
- Match the user's language.
- Ask a short clarifying question only when a cheap assumption would be costly.
- When you touch files or run commands, show paths and results clearly.
- Be concise.`;

export function harnessSystemPromptFile(): string {
  return harnessSystemPromptPath;
}

/** Identity for this webui. Always re-read so Refresh picks up `.pi/SYSTEM.md` edits. */
export function loadHarnessSystemPrompt(): string {
  if (!existsSync(harnessSystemPromptPath)) return PERSONAL_ASSISTANT_PROMPT;
  try {
    const text = readFileSync(harnessSystemPromptPath, "utf8").trim();
    return text || PERSONAL_ASSISTANT_PROMPT;
  } catch {
    return PERSONAL_ASSISTANT_PROMPT;
  }
}

export function buildLiveCapabilityPacket(
  options: BuildSystemPromptOptions,
  mcpServers: McpServerRecord[],
): string {
  const tools = options.selectedTools ?? [];
  const snippets = options.toolSnippets ?? {};
  const toolLines =
    tools.length > 0
      ? tools.map((name) => (snippets[name] ? `- ${name}: ${snippets[name]}` : `- ${name}`)).join("\n")
      : "- (none this turn — only reply with what you already know)";

  const mcpLines =
    mcpServers.length > 0
      ? mcpServers
          .map((server) => {
            const label = server.enabled ? server.name : `${server.name} (disabled)`;
            return `- ${label}: ${server.description}`;
          })
          .join("\n")
      : "- (no MCP servers configured)";

  const skillLines =
    options.skills && options.skills.length > 0
      ? options.skills
          .filter((skill) => !skill.disableModelInvocation)
          .map((skill) => `- ${skill.name}: ${skill.description}`)
          .join("\n")
      : "- (no skills discovered)";

  return [
    "## Live capabilities this turn",
    "",
    "This list is the source of truth. Read it before acting. Do not assume you are limited to coding.",
    "",
    "### Tools",
    toolLines,
    "",
    "### MCP servers",
    mcpLines,
    "",
    "### Skills (read SKILL.md at the listed path before following one)",
    skillLines,
    "",
    "Use a tool when its description matches the task. Prefer an MCP tool for its domain over improvising.",
  ].join("\n");
}

export function personalAssistantExtension(getMcpServers: () => McpServerRecord[]): InlineExtension {
  return {
    name: "personal-assistant",
    factory: (pi: ExtensionAPI) => {
      pi.on("before_agent_start", (event) => {
        const packet = buildLiveCapabilityPacket(event.systemPromptOptions, getMcpServers());
        return { systemPrompt: `${stripPiDocumentation(event.systemPrompt).trimEnd()}\n\n${packet}\n` };
      });
    },
  };
}
