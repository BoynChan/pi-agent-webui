import type { PluginDetail, PluginSummary } from "@pi-debug/shared";
import type { RegisteredPlugin, RegisteredSkill, RegisteredTool } from "./types.ts";

export class PluginRegistry {
  readonly tools = new Map<string, RegisteredTool>();
  readonly skills = new Map<string, RegisteredSkill>();
  readonly plugins = new Map<string, RegisteredPlugin>();

  registerTool(tool: RegisteredTool): void {
    this.tools.set(tool.id, { ...tool, enabled: tool.enabled ?? true });
  }

  registerSkill(skill: RegisteredSkill): void {
    this.skills.set(skill.id, { ...skill, enabled: skill.enabled ?? true });
  }

  registerPlugin(plugin: RegisteredPlugin): void {
    this.plugins.set(plugin.id, { ...plugin, enabled: plugin.enabled ?? true });
  }

  list(): PluginSummary[] {
    const summaries: PluginSummary[] = [];
    for (const skill of this.skills.values()) {
      summaries.push({
        id: skill.id,
        name: skill.name,
        kind: "skill",
        source: "backend",
        enabled: skill.enabled ?? true,
        description: skill.description,
        origin: skill.origin,
      });
    }
    for (const tool of this.tools.values()) {
      summaries.push({
        id: tool.id,
        name: tool.name,
        kind: "tool",
        source: "backend",
        enabled: tool.enabled ?? true,
        description: tool.description,
        origin: tool.origin,
      });
    }
    for (const plugin of this.plugins.values()) {
      summaries.push({
        id: plugin.id,
        name: plugin.name,
        kind: plugin.kind,
        source: "backend",
        enabled: plugin.enabled ?? true,
        description: plugin.description,
        origin: plugin.origin,
      });
    }
    return summaries;
  }

  get(id: string): PluginDetail | undefined {
    const skill = this.skills.get(id);
    if (skill) {
      return {
        id: skill.id,
        name: skill.name,
        kind: "skill",
        source: "backend",
        enabled: skill.enabled ?? true,
        description: skill.description,
        origin: skill.origin,
        content: skill.content,
        contentLanguage: "markdown",
        filePath: skill.filePath,
      };
    }
    const tool = this.tools.get(id);
    if (tool) {
      return {
        id: tool.id,
        name: tool.name,
        kind: "tool",
        source: "backend",
        enabled: tool.enabled ?? true,
        description: tool.description,
        origin: tool.origin,
        schema: tool.parameters,
        parameters: tool.parameters,
        content: JSON.stringify(tool.parameters, null, 2),
        contentLanguage: "json",
      };
    }
    const plugin = this.plugins.get(id);
    if (plugin) {
      return {
        id: plugin.id,
        name: plugin.name,
        kind: plugin.kind,
        source: "backend",
        enabled: plugin.enabled ?? true,
        description: plugin.description,
        origin: plugin.origin,
        schema: plugin.schema,
        content: plugin.content,
        contentLanguage: plugin.contentLanguage,
        filePath: plugin.filePath,
      };
    }
    return undefined;
  }
}
