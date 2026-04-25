import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

loadDotenv();

const ConfigSchema = z.object({
  handle: z.string().min(1),
  persona: z.string().min(1),
  tweet_examples: z.array(z.string().min(1)).min(1),
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
    lookbackHours: Number(process.env.LOOKBACK_HOURS || 24),
    claudeProjectsDir: expandHome(process.env.CLAUDE_PROJECTS_DIR || "~/.claude/projects"),
  });

  if (env.llmProvider === "api" && !env.anthropicApiKey) {
    throw new Error("LLM_PROVIDER=api requires ANTHROPIC_API_KEY in .env");
  }

  return { app, env };
};
