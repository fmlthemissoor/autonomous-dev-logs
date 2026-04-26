import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AppConfig, EnvConfig } from "../config.js";
import { fetchHandleTweets, type SocialDataTweet } from "../socialdata.js";

export interface PersonalTweet {
  text: string;
  postedAt: string;
}

export interface PersonalFeed {
  /** The handle these tweets belong to (mirrors app.handle). */
  handle: string;
  /** Recent originals from the user's own account. */
  tweets: PersonalTweet[];
  /** When this feed was assembled. */
  builtAtIso: string;
  notes: string[];
}

const FEED_PATH = "data/personal-feed.json";

const feedPath = (): string => join(process.cwd(), FEED_PATH);

const isOriginal = (tweet: SocialDataTweet, excludeReplies: boolean): boolean => {
  if (tweet.type === "retweet") return false;
  if (excludeReplies && tweet.in_reply_to_status_id_str) return false;
  return tweet.full_text.trim().length > 0;
};

const cleanText = (raw: string): string =>
  raw.replace(/\s+https?:\/\/t\.co\/\S+\s*$/g, "").trim();

const emptyFeed = (handle: string, note: string): PersonalFeed => ({
  handle,
  tweets: [],
  builtAtIso: new Date().toISOString(),
  notes: [note],
});

/**
 * Read the persisted personal-feed file. Never fetches. Used by the daily
 * pipeline so `npm run send` doesn't hit SocialData on every run.
 */
export const loadPersonalFeed = (app: AppConfig): PersonalFeed | null => {
  if (!app.personal_feed.enabled) return null;
  const path = feedPath();
  if (!existsSync(path)) {
    return emptyFeed(
      app.handle,
      `no personal feed at ${FEED_PATH}. Run \`npm run refresh-personal-feed\` to build one.`,
    );
  }
  try {
    const feed = JSON.parse(readFileSync(path, "utf8")) as PersonalFeed;
    const ageDays = ((Date.now() - Date.parse(feed.builtAtIso)) / 86_400_000).toFixed(1);
    feed.notes = [`loaded from disk, ${ageDays}d old (no SocialData call)`];
    return feed;
  } catch (err) {
    return emptyFeed(
      app.handle,
      `personal feed at ${FEED_PATH} unreadable (${err instanceof Error ? err.message : String(err)}).`,
    );
  }
};

/**
 * Fetch the user's own tweets from SocialData and write the feed to disk.
 * Called explicitly via `npm run refresh-personal-feed`.
 */
export const refreshPersonalFeed = async (
  app: AppConfig,
  env: EnvConfig,
): Promise<PersonalFeed> => {
  const cfg = app.personal_feed;
  if (!cfg.enabled) {
    throw new Error("personal_feed.enabled is false in config.yaml — nothing to refresh.");
  }
  if (!env.socialDataApiKey) {
    throw new Error("SOCIALDATA_API_KEY is missing in .env.");
  }
  if (!app.handle) {
    throw new Error("config.handle is required to fetch your personal feed.");
  }

  const notes: string[] = [];
  const { tweets } = await fetchHandleTweets(app.handle, env.socialDataApiKey, {
    maxTweets: cfg.max_tweets,
    maxPages: 10,
  });
  const originals = tweets.filter((t) => isOriginal(t, cfg.exclude_replies));
  notes.push(
    `pulled ${originals.length} originals (${tweets.length - originals.length} non-originals dropped).`,
  );

  const personal: PersonalTweet[] = originals
    .sort((a, b) => Date.parse(b.tweet_created_at) - Date.parse(a.tweet_created_at))
    .map((t) => ({ text: cleanText(t.full_text), postedAt: t.tweet_created_at }));

  const feed: PersonalFeed = {
    handle: app.handle,
    tweets: personal,
    builtAtIso: new Date().toISOString(),
    notes,
  };

  const path = feedPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(feed, null, 2));
  return feed;
};

export const personalFeedPath = (): string => feedPath();
