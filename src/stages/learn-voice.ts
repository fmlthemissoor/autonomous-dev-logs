import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AppConfig, EnvConfig } from "../config.js";
import { fetchHandleTweets, type SocialDataTweet } from "../socialdata.js";

export interface LabeledTweet {
  /** The actual text of the tweet. */
  text: string;
  /** Engagement score we computed (only meaningful for the self bucket). */
  score?: number;
  /** Tweet metrics, useful for debugging and for surfacing to the writer. */
  metrics?: {
    likes: number;
    retweets: number;
    replies: number;
    quotes: number;
    bookmarks: number;
    views: number | null;
  };
  /** Source handle (e.g. "@fmlonsol"). */
  source: string;
  /** ISO timestamp of when the tweet was posted. */
  postedAt: string;
}

export interface VoiceCorpus {
  /** Top performers from your own account (only present if you have enough originals). */
  highPerforming: LabeledTweet[];
  /** Bottom performers from your own account (only present if you have enough originals). */
  lowPerforming: LabeledTweet[];
  /** Recent originals from your own account, used as voice examples when bucketing isn't viable. */
  selfVoice: LabeledTweet[];
  /** Recent originals from the inspiration accounts. No metrics labeling. */
  voiceAccounts: LabeledTweet[];
  /** When this corpus was assembled (cache decision relies on this). */
  builtAtIso: string;
  /** Free-form notes about what we did/skipped — useful in logs. */
  notes: string[];
}

const CACHE_PATH = ".cache/voice.json";

const isOriginal = (tweet: SocialDataTweet, excludeReplies: boolean): boolean => {
  if (tweet.type === "retweet") return false;
  if (excludeReplies && tweet.in_reply_to_status_id_str) return false;
  return tweet.full_text.trim().length > 0;
};

const cleanText = (raw: string): string => {
  // Drop trailing t.co URLs (image/quote attachments) — they show as link
  // shorteners that aren't part of the tweet "voice" we want to imitate.
  return raw.replace(/\s+https?:\/\/t\.co\/\S+\s*$/g, "").trim();
};

const scoreTweet = (
  tweet: SocialDataTweet,
  weights: AppConfig["voice_learning"]["weights"],
): number => {
  const views = tweet.views_count ?? 0;
  return (
    weights.likes * tweet.favorite_count +
    weights.retweets * tweet.retweet_count +
    weights.replies * tweet.reply_count +
    weights.quotes * tweet.quote_count +
    weights.bookmarks * tweet.bookmark_count +
    weights.views * views
  );
};

const toLabeled = (tweet: SocialDataTweet, source: string, score?: number): LabeledTweet => ({
  text: cleanText(tweet.full_text),
  score,
  metrics: {
    likes: tweet.favorite_count,
    retweets: tweet.retweet_count,
    replies: tweet.reply_count,
    quotes: tweet.quote_count,
    bookmarks: tweet.bookmark_count,
    views: tweet.views_count,
  },
  source,
  postedAt: tweet.tweet_created_at,
});

const readCache = (path: string): VoiceCorpus | null => {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as VoiceCorpus;
  } catch {
    return null;
  }
};

const writeCache = (path: string, corpus: VoiceCorpus): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(corpus, null, 2));
};

const cacheIsFresh = (corpus: VoiceCorpus | null, refreshHours: number): boolean => {
  if (!corpus) return false;
  const builtMs = Date.parse(corpus.builtAtIso);
  if (!Number.isFinite(builtMs)) return false;
  return Date.now() - builtMs < refreshHours * 3600 * 1000;
};

const buildSelfBuckets = (
  originals: SocialDataTweet[],
  source: string,
  cfg: AppConfig["voice_learning"],
  notes: string[],
): { high: LabeledTweet[]; low: LabeledTweet[]; selfVoice: LabeledTweet[] } => {
  if (originals.length === 0) {
    return { high: [], low: [], selfVoice: [] };
  }

  if (originals.length < cfg.min_originals_for_bucketing) {
    notes.push(
      `${source}: only ${originals.length} originals (< ${cfg.min_originals_for_bucketing}); ` +
        `using as unlabeled voice examples instead of bucketing.`,
    );
    const recent = [...originals]
      .sort((a, b) => Date.parse(b.tweet_created_at) - Date.parse(a.tweet_created_at))
      .slice(0, cfg.examples_per_voice_account * 2);
    return {
      high: [],
      low: [],
      selfVoice: recent.map((t) => toLabeled(t, source)),
    };
  }

  const eligible = originals.filter((t) => (t.views_count ?? 0) >= cfg.min_views_floor);
  if (eligible.length < cfg.min_originals_for_bucketing) {
    notes.push(
      `${source}: only ${eligible.length} originals above min_views_floor=${cfg.min_views_floor}; ` +
        `using all originals as unlabeled voice examples.`,
    );
    return {
      high: [],
      low: [],
      selfVoice: originals
        .slice(0, cfg.examples_per_voice_account * 2)
        .map((t) => toLabeled(t, source)),
    };
  }

  const scored = eligible
    .map((t) => ({ tweet: t, score: scoreTweet(t, cfg.weights) }))
    .sort((a, b) => b.score - a.score);

  const high = scored.slice(0, cfg.examples_per_bucket).map((s) => toLabeled(s.tweet, source, s.score));
  const low = scored
    .slice(-cfg.examples_per_bucket)
    .reverse()
    .map((s) => toLabeled(s.tweet, source, s.score));

  notes.push(
    `${source}: bucketed ${eligible.length} originals — ` +
      `top score ${scored[0]?.score.toFixed(1)}, bottom score ${scored[scored.length - 1]?.score.toFixed(1)}.`,
  );
  return { high, low, selfVoice: [] };
};

const collectVoiceAccount = async (
  handle: string,
  apiKey: string,
  cfg: AppConfig["voice_learning"],
  notes: string[],
): Promise<LabeledTweet[]> => {
  try {
    const { tweets } = await fetchHandleTweets(handle, apiKey, {
      maxTweets: cfg.max_tweets_per_handle,
      maxPages: 5,
    });
    const originals = tweets.filter((t) => isOriginal(t, cfg.exclude_replies));
    if (originals.length === 0) {
      notes.push(`${handle}: no original tweets after filtering.`);
      return [];
    }
    // For voice accounts we don't bucket — just take the most recent originals
    // to keep things current. They reflect "voice we want to follow" not "what
    // earned engagement".
    const recent = [...originals]
      .sort((a, b) => Date.parse(b.tweet_created_at) - Date.parse(a.tweet_created_at))
      .slice(0, cfg.examples_per_voice_account);
    notes.push(`${handle}: using ${recent.length} recent originals as voice examples.`);
    return recent.map((t) => toLabeled(t, handle));
  } catch (err) {
    notes.push(`${handle}: fetch failed — ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
};

export const buildVoiceCorpus = async (app: AppConfig, env: EnvConfig): Promise<VoiceCorpus> => {
  const cfg = app.voice_learning;
  if (!cfg.enabled) {
    return {
      highPerforming: [],
      lowPerforming: [],
      selfVoice: [],
      voiceAccounts: [],
      builtAtIso: new Date().toISOString(),
      notes: ["voice_learning disabled — using config.tweet_examples only."],
    };
  }
  if (!env.socialDataApiKey) {
    throw new Error("voice_learning.enabled=true but SOCIALDATA_API_KEY is missing.");
  }

  const cachePath = join(process.cwd(), CACHE_PATH);
  const cached = readCache(cachePath);
  if (cacheIsFresh(cached, cfg.refresh_interval_hours)) {
    const ageHours = ((Date.now() - Date.parse(cached!.builtAtIso)) / 3600 / 1000).toFixed(1);
    cached!.notes = [
      ...(cached!.notes || []),
      `[cache hit at ${ageHours}h old; refresh_interval_hours=${cfg.refresh_interval_hours}]`,
    ];
    return cached!;
  }

  const notes: string[] = [];
  const corpus: VoiceCorpus = {
    highPerforming: [],
    lowPerforming: [],
    selfVoice: [],
    voiceAccounts: [],
    builtAtIso: new Date().toISOString(),
    notes,
  };

  if (cfg.your_handle) {
    try {
      const { tweets } = await fetchHandleTweets(cfg.your_handle, env.socialDataApiKey, {
        maxTweets: cfg.max_tweets_per_handle,
        maxPages: 10,
      });
      const originals = tweets.filter((t) => isOriginal(t, cfg.exclude_replies));
      const buckets = buildSelfBuckets(originals, cfg.your_handle, cfg, notes);
      corpus.highPerforming = buckets.high;
      corpus.lowPerforming = buckets.low;
      corpus.selfVoice = buckets.selfVoice;
    } catch (err) {
      notes.push(
        `${cfg.your_handle}: self fetch failed — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  for (const account of cfg.voice_accounts) {
    const examples = await collectVoiceAccount(account, env.socialDataApiKey, cfg, notes);
    corpus.voiceAccounts.push(...examples);
  }

  writeCache(cachePath, corpus);
  return corpus;
};

/** True if the corpus has any LLM-usable signal at all. */
export const corpusIsUseful = (corpus: VoiceCorpus): boolean =>
  corpus.highPerforming.length > 0 ||
  corpus.lowPerforming.length > 0 ||
  corpus.selfVoice.length > 0 ||
  corpus.voiceAccounts.length > 0;
