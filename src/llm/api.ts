import Anthropic from "@anthropic-ai/sdk";
import type { LlmCallOptions, LlmProvider } from "./types.js";
import { extractJson } from "./json-extract.js";

export class AnthropicApiProvider implements LlmProvider {
  readonly name = "anthropic-api";
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async call<T>(opts: LlmCallOptions<T>): Promise<T> {
    const messages: Anthropic.MessageParam[] = [];
    for (const m of opts.fewShot) {
      messages.push({ role: m.role, content: m.content });
    }
    messages.push({ role: "user", content: opts.user });

    // Mark the system prompt and the last few-shot turn as cache breakpoints
    // so they get reused across daily runs (5-minute TTL by default).
    const systemBlocks: Anthropic.TextBlockParam[] = [
      {
        type: "text",
        text: opts.system,
        cache_control: { type: "ephemeral" },
      },
    ];

    if (messages.length > 1) {
      const fewShotBoundary = messages[messages.length - 2];
      if (fewShotBoundary && typeof fewShotBoundary.content === "string") {
        fewShotBoundary.content = [
          {
            type: "text",
            text: fewShotBoundary.content,
            cache_control: { type: "ephemeral" },
          },
        ] as Anthropic.TextBlockParam[];
      }
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: opts.maxOutputTokens ?? 2048,
      system: systemBlocks,
      messages,
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error(`[${opts.label}] no text block in response`);
    }
    const parsed = extractJson(textBlock.text);
    return opts.schema.parse(parsed);
  }
}
