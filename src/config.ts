import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

loadDotenv();

const VoiceLearningSchema = z.object({
  enabled: z.boolean().default(false),
  /** Your X handle. Tweets are bucketed by engagement and used as labeled examples. */
  your_handle: z.string().optional(),
  /** Other accounts whose voice you'd like to imitate. Their tweets are used unlabeled. */
  voice_accounts: z.array(z.string()).default([]),
  /** Max tweets to pull per handle. */
  max_tweets_per_handle: z.number().int().min(10).max(2000).default(300),
  /**
   * Minimum number of original tweets (post retweet/reply filter) before we
   * bother bucketing yours by engagement. Below this, we treat them as voice
   * examples only — the absolute engagement numbers are too noisy.
   */
  min_originals_for_bucketing: z.number().int().min(5).max(500).default(20),
  /** How many top/bottom tweets to surface as labeled examples. */
  examples_per_bucket: z.number().int().min(2).max(20).default(6),
  /** How many voice examples per inspiration account. */
  examples_per_voice_account: z.number().int().min(1).max(20).default(4),
  /** Hours between SocialData refreshes. Cached results are reused in between. */
  refresh_interval_hours: z.number().int().min(1).max(720).default(168),
  /** Engagement score weights. */
  weights: z
    .object({
      likes: z.number().default(1),
      retweets: z.number().default(3),
      replies: z.number().default(2),
      quotes: z.number().default(1),
      bookmarks: z.number().default(2),
      views: z.number().default(0.005),
    })
    .default({}),
  /** Ignore tweets with fewer views than this — too statistically noisy. */
  min_views_floor: z.number().int().min(0).default(50),
  /** Drop tweets that are replies to others (in_reply_to_status_id != null). */
  exclude_replies: z.boolean().default(true),
});

const ConfigSchema = z.object({
  handle: z.string().min(1),
  persona: z.string().min(1),
  /**
   * Manual tweet examples. Used as a fallback when voice_learning is disabled
   * or returns no usable tweets. Required so the writer always has *some*
   * voice signal even on a fresh clone.
   */
  tweet_examples: z.array(z.string().min(1)).min(1),
  voice_learning: VoiceLearningSchema.default({}),
  thread: z.object({
    min_tweets: z.number().int().min(1).max(20).default(2),
    max_tweets: z.number().int().min(1).max(20).default(6),
    per_tweet_char_limit: z.number().int().min(140).max(280).default(280),
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
