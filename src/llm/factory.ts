import type { EnvConfig } from "../config.js";
import { AnthropicApiProvider } from "./api.js";
import { ClaudeSubscriptionProvider } from "./subscription.js";
import type { LlmProvider } from "./types.js";

export const buildLlmProvider = (env: EnvConfig): LlmProvider => {
  if (env.llmProvider === "api") {
    if (!env.anthropicApiKey) {
      throw new Error("LLM_PROVIDER=api requires ANTHROPIC_API_KEY");
    }
    return new AnthropicApiProvider(env.anthropicApiKey, env.anthropicModel);
  }
  return new ClaudeSubscriptionProvider(env.claudeCliPath);
};
