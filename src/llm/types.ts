import { z } from "zod";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmCallOptions<T> {
  /** Stable system prompt — the API provider will prompt-cache this. */
  system: string;
  /**
   * Stable few-shot examples — kept separate from the live user message so
   * the API provider can prompt-cache them too. Joined into the conversation
   * as alternating user/assistant turns.
   */
  fewShot: LlmMessage[];
  /** The dynamic, per-call user message (transcripts, plan request, etc.). */
  user: string;
  /** Zod schema describing the expected JSON output. */
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** Short label for logs. */
  label: string;
  /** Output token budget. */
  maxOutputTokens?: number;
}

export interface LlmProvider {
  /** Returns parsed JSON validated against the supplied schema. */
  call<T>(opts: LlmCallOptions<T>): Promise<T>;
  /** Tag for logging. */
  readonly name: string;
}
