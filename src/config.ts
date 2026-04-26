import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

loadDotenv();

const VoiceLearningSchema = z.object({
  enabled: z.boolean().default(false),
  /** Accounts whose voice you'd like to imitate. Their tweets are used as unlabeled style examples. */
  voice_accounts: z.array(z.string()).default([]),
  /** Max tweets to pull per handle. */
  max_tweets_per_handle: z.number().int().min(10).max(2000).default(300),
  /** How many recent voice examples to surface per inspiration account. */
  examples_per_voice_account: z.number().int().min(1).max(50).default(6),
  /**
   * Drop tweets shorter than this many characters. Short one-liners give
   * weak voice signal — the writer learns more from tweets that show how
   * an account handles paragraphs, line breaks, and transitions.
   */
  min_tweet_chars: z.number().int().min(0).max(2000).default(120),
  /** Drop tweets that are replies to others (in_reply_to_status_id != null). */
  exclude_replies: z.boolean().default(true),
});

const PersonalFeedSchema = z.object({
  /** Pull your own recent tweets and feed them to the writer as PRIOR COVERAGE. */
  enabled: z.boolean().default(false),
  /** How many tweets to pull per refresh. */
  max_tweets: z.number().int().min(10).max(2000).default(200),
  /** How many of those tweets to include in the writer prompt (most recent first). */
  max_examples_in_prompt: z.number().int().min(5).max(200).default(60),
  /** Drop replies — they're conversational, not "broadcast" coverage. */
  exclude_replies: z.boolean().default(true),
});

const ConfigSchema = z.object({
  handle: z.string().min(1),
  persona: z.string().min(1),
  personal_feed: PersonalFeedSchema.default({}),
  /**
   * Manual tweet examples. Used as a fallback when voice_learning is disabled
   * or returns no usable tweets. Required so the writer always has *some*
   * voice signal even on a fresh clone.
   */
  tweet_examples: z.array(z.string().min(1)).min(1),
  voice_learning: VoiceLearningSchema.default({}),
  thread: z.object({
    /**
     * Minimum tweets in a thread. Default 1 — if the day's story is best
     * told in a single tweet, the writer is allowed to return one.
     */
    min_tweets: z.number().int().min(1).max(20).default(1),
    max_tweets: z.number().int().min(1).max(20).default(6),
    /**
     * Per-tweet character ceiling. Higher values let the writer breathe when
     * there's substance, but the prompt instructs it not to pad.
     */
    per_tweet_char_limit: z.number().int().min(140).max(4000).default(560),
  }),
  visual: z.object({
    enabled: z.boolean().default(true),
    allowed_formats: z
      .array(z.enum(["none", "chart", "code_snippet", "illustration"]))
      .min(1)
      .default(["none", "chart", "code_snippet"]),
    chart_title_prefix: z.string().default("Today in code"),
  }),
  transcripts: z.object({
    include_cwd_substrings: z.array(z.string()).default([]),
    exclude_cwd_substrings: z.array(z.string()).default([]),
    /**
     * Skip individual turns whose text contains any of these substrings.
     * Useful when a session has the right cwd but the conversation drifts
     * into another project's files (e.g. "look at /other-project/foo.ts").
     */
    exclude_text_substrings: z.array(z.string()).default([]),
    max_tool_result_chars: z.number().int().min(0).default(800),
  }),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

const EnvSchema = z.object({
  llmProvider: z.enum(["subscription", "api"]),
  anthropicApiKey: z.string().optional(),
  anthropicModel: z.string(),
  claudeCliPath: z.string().optional(),
  telegramBotToken: z.string().optional(),
  telegramChatId: z.string().optional(),
  openaiApiKey: z.string().optional(),
  socialDataApiKey: z.string().optional(),
  lookbackHours: z.number().int().min(1).max(168),
  claudeProjectsDir: z.string(),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

const expandHome = (p: string): string => (p.startsWith("~") ? join(homedir(), p.slice(1)) : p);

export const loadConfig = (): { app: AppConfig; env: EnvConfig } => {
  const cfgPath = resolve(process.cwd(), "config.yaml");
  if (!existsSync(cfgPath)) {
    throw new Error(
      `config.yaml not found at ${cfgPath}. Run \`cp config.example.yaml config.yaml\` and edit it.`,
    );
  }
  const raw = readFileSync(cfgPath, "utf8");
  const app = ConfigSchema.parse(parseYaml(raw));

  const env = EnvSchema.parse({
    llmProvider: process.env.LLM_PROVIDER || "subscription",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929",
    claudeCliPath: process.env.CLAUDE_CLI_PATH || undefined,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || undefined,
    telegramChatId: process.env.TELEGRAM_CHAT_ID || undefined,
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    socialDataApiKey: process.env.SOCIALDATA_API_KEY || undefined,
    lookbackHours: Number(process.env.LOOKBACK_HOURS || 24),
    claudeProjectsDir: expandHome(process.env.CLAUDE_PROJECTS_DIR || "~/.claude/projects"),
  });

  if (env.llmProvider === "api" && !env.anthropicApiKey) {
    throw new Error("LLM_PROVIDER=api requires ANTHROPIC_API_KEY in .env");
  }

  if (app.voice_learning.enabled && !env.socialDataApiKey) {
    throw new Error(
      "voice_learning.enabled=true requires SOCIALDATA_API_KEY in .env. " +
        "Get one at https://socialdata.tools.",
    );
  }

  return { app, env };
};
