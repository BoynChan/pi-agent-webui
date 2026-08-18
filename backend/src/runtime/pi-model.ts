import type { ProviderWireConfig } from "@pi-debug/shared";
import type { Model } from "@earendil-works/pi-ai";

const EMPTY_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export function placeholderModel(): Model<"openai-completions"> {
  return {
    id: "pi-debug-placeholder",
    name: "PI debug placeholder",
    api: "openai-completions",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: false,
    input: ["text"],
    cost: EMPTY_COST,
    contextWindow: 128_000,
    maxTokens: 16_384,
  };
}

/** Map a browser connector onto a pi-ai Model. Keys stay on the request, not the model. */
export function modelFromProvider(provider: ProviderWireConfig): {
  model: Model<"openai-completions"> | Model<"anthropic-messages">;
  providerId: string;
} {
  if (provider.type === "anthropic") {
    return {
      providerId: "anthropic",
      model: {
        id: provider.model,
        name: provider.model,
        api: "anthropic-messages",
        provider: "anthropic",
        baseUrl: provider.baseUrl || "https://api.anthropic.com",
        reasoning: true,
        input: ["text", "image"],
        cost: EMPTY_COST,
        contextWindow: 200_000,
        maxTokens: 16_384,
      },
    };
  }

  return {
    providerId: "openai",
    model: {
      id: provider.model,
      name: provider.model,
      api: "openai-completions",
      provider: "openai",
      baseUrl: provider.baseUrl || "https://api.openai.com/v1",
      reasoning: true,
      input: ["text"],
      cost: EMPTY_COST,
      contextWindow: 128_000,
      maxTokens: 16_384,
    },
  };
}
