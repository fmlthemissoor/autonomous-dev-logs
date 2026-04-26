import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AppConfig, EnvConfig } from "../config.js";
import { fetchHandleTweets, type SocialDataTweet } from "../socialdata.js";

export interface VoiceTweet {
  /** The actual text of the tweet. */
  text: string;
  /** Source handle (e.g. "@paulg"). */
  source: string;
  /** ISO timestamp of when the tweet was posted. */
  postedAt: string;
}

export interface VoiceCorpus {
  /** Recent originals from inspiration accounts, used as unlabeled style examples. */
  voiceAccounts: VoiceTweet[];
  /** When this corpus was assembled (informational only — staleness is a human concern). */
  builtAtIso: string;
  /** Free-form notes about what we did/skipped — useful in logs. */
  notes: string[];
}

const LIBRARY_PATH = "data/voice-library.json";

const isOriginal = (tweet: SocialDataTweet, excludeReplies: boolean): boolean => {
  if (tweet.type === "retweet") return false;
  if (excludeReplies && tweet.in_reply_to_status_id_str) return false;
  return tweet.full_text.trim().length > 0;
};

const cleanText = (raw: string): string => {
  return raw.replace(/\s+https?:\/\/t\.co\/\S+\s*$/g, "").trim();
};

const toVoiceTweet = (tweet: SocialDataTweet, source: string): VoiceTweet => ({
  text: cleanText(tweet.full_text),
  source,
  postedAt: tweet.tweet_created_at,
});

const libraryPath = (): string => join(process.cwd(), LIBRARY_PATH);

const emptyCorpus = (note: string): VoiceCorpus => ({
  voiceAccounts: [],
  builtAtIso: new Date().toISOString(),
  notes: [note],
});

/**
 * Read the persisted voice library from disk. Never fetches. Used by the
 * daily pipeline so `npm run send` doesn't hit SocialData on every run.
 *
 * If the file is missing, returns an empty corpus with a note — the writer
 * still has `tweet_examples` from config.yaml as a fallback.
 */
export const loadVoiceCorpus = (app: AppConfig): VoiceCorpus => {
  if (!app.voice_learning.enabled) {
    return emptyCorpus("voice_learning disabled — using config.tweet_examples only.");
  }

  const path = libraryPath();
  if (!existsSync(path)) {
    return emptyCorpus(
      `no voice library at ${LIBRARY_PATH}. Run \`npm run refresh-voice\` to build one. Falling back to config.tweet_examples.`,
    );
  }

  try {
    const corpus = JSON.parse(readFileSync(path, "utf8")) as VoiceCorpus;
    const ageDays = ((Date.now() - Date.parse(corpus.builtAtIso)) / 86_400_000).toFixed(1);
    // Replace the (stale) refresh-time notes with a clean load marker — the
    // fetch details belong in the refresh-voice script's own output, not in
    // every daily run's log.
    corpus.notes = [`loaded from disk, ${ageDays}d old (no SocialData call)`];
    return corpus;
  } catch (err) {
    return emptyCorpus(
      `voice library at ${LIBRARY_PATH} unreadable (${err instanceof Error ? err.message : String(err)}). Falling back.`,
    );
  }
};

const collectVoiceAccount = async (
  handle: string,
  apiKey: string,
  cfg: AppConfig["voice_learning"],
  notes: string[],
): Promise<VoiceTweet[]> => {
  try {
    const { tweets } = await fetchHandleTweets(handle, apiKey, {
      maxTweets: cfg.max_tweets_per_handle,
      maxPages: 5,
    });
    const originals = tweets.filter((t) => isOriginal(t, cfg.exclude_replies));
    const longEnough = originals.filter(
      (t) => cleanText(t.full_text).length >= cfg.min_tweet_chars,
    );
    if (longEnough.length === 0) {
      notes.push(
        `${handle}: no originals ≥ ${cfg.min_tweet_chars} chars (had ${originals.length} originals total).`,
      );
      return [];
    }
    const recent = [...longEnough]
      .sort((a, b) => Date.parse(b.tweet_created_at) - Date.parse(a.tweet_created_at))
      .slice(0, cfg.examples_per_voice_account);
    notes.push(
      `${handle}: pulled ${recent.length} originals ≥ ${cfg.min_tweet_chars} chars ` +
        `(${originals.length - longEnough.length} too short, ${tweets.length - originals.length} non-originals).`,
    );
    return recent.map((t) => toVoiceTweet(t, handle));
  } catch (err) {
    notes.push(`${handle}: fetch failed — ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
};

/**
 * Fetch fresh voice examples from SocialData and write the library to disk.
 * Called explicitly via `npm run refresh-voice` — never run on every send.
 */
export const refreshVoiceCorpus = async (
  app: AppConfig,
  env: EnvConfig,
): Promise<VoiceCorpus> => {
  const cfg = app.voice_learning;
  if (!cfg.enabled) {
    throw new Error("voice_learning.enabled is false in config.yaml — nothing to refresh.");
  }
  if (cfg.voice_accounts.length === 0) {
    throw new Error("voice_learning.voice_accounts is empty — add at least one handle to refresh.");
  }
  if (!env.socialDataApiKey) {
    throw new Error("SOCIALDATA_API_KEY is missing in .env.");
  }

  const notes: string[] = [];
  const voiceAccounts: VoiceTweet[] = [];

  for (const account of cfg.voice_accounts) {
    const examples = await collectVoiceAccount(account, env.socialDataApiKey, cfg, notes);
    voiceAccounts.push(...examples);
  }

  const corpus: VoiceCorpus = {
    voiceAccounts,
    builtAtIso: new Date().toISOString(),
    notes,
  };

  const path = libraryPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(corpus, null, 2));

  return corpus;
};

export const corpusIsUseful = (corpus: VoiceCorpus): boolean => corpus.voiceAccounts.length > 0;

export const voiceLibraryPath = (): string => libraryPath();
