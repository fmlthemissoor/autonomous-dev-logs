#!/usr/bin/env node
/**
 * One-shot probe: fetch tweets from a single voice source (handle / list /
 * community URL passed as argv[2]) and print stats + samples. Does NOT touch
 * data/voice-library.json. Use to evaluate a candidate source before adding
 * it to config.yaml.
 *
 *   npx tsx scripts/probe-voice-source.ts "https://x.com/i/communities/1552..."
 */
import { config as loadDotenv } from "dotenv";
import {
  fetchCommunityTweets,
  fetchHandleTweets,
  fetchListTweets,
  type SocialDataTweet,
} from "../src/socialdata.js";

loadDotenv();

const cleanText = (raw: string): string =>
  raw.replace(/\s+https?:\/\/t\.co\/\S+\s*$/g, "").trim();

const parseSource = (raw: string) => {
  const t = raw.trim();
  const list = t.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/lists\/(\d+)/i);
  if (list && list[1]) return { kind: "list" as const, id: list[1] };
  const community = t.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/communities\/(\d+)/i);
  if (community && community[1]) return { kind: "community" as const, id: community[1] };
  const handle = t
    .replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\/$/, "");
  return { kind: "handle" as const, handle };
};

const main = async () => {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: probe-voice-source <handle | list URL | community URL>");
    process.exit(2);
  }
  const apiKey = process.env.SOCIALDATA_API_KEY;
  if (!apiKey) {
    console.error("SOCIALDATA_API_KEY missing in .env");
    process.exit(1);
  }
  const source = parseSource(arg);
  console.log(`probing ${source.kind}: ${arg}\n`);

  const opts = { maxTweets: 1000, maxPages: 25 };
  let tweets: SocialDataTweet[];
  if (source.kind === "handle") {
    tweets = (await fetchHandleTweets(source.handle, apiKey, opts)).tweets;
  } else if (source.kind === "list") {
    tweets = await fetchListTweets(source.id, apiKey, opts);
  } else {
    tweets = await fetchCommunityTweets(source.id, apiKey, opts);
  }

  const originals = tweets.filter(
    (t) => t.type !== "retweet" && !t.in_reply_to_status_id_str && t.full_text.trim().length > 0,
  );
  const cleaned = originals.map((t) => ({ ...t, _clean: cleanText(t.full_text) }));
  const byLen = (min: number) => cleaned.filter((t) => t._clean.length >= min).length;

  console.log(`fetched: ${tweets.length} raw tweets`);
  console.log(`originals (no RT, no reply): ${originals.length}`);
  console.log(`  >= 40 chars: ${byLen(40)}`);
  console.log(`  >= 60 chars: ${byLen(60)}`);
  console.log(`  >= 120 chars: ${byLen(120)}`);
  console.log(`  >= 240 chars: ${byLen(240)}`);

  // Author distribution (lists/communities only meaningfully).
  const authors = new Map<string, number>();
  for (const t of cleaned) {
    const sn = t.user?.screen_name ?? "(unknown)";
    authors.set(sn, (authors.get(sn) ?? 0) + 1);
  }
  if (source.kind !== "handle") {
    const ranked = [...authors.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`\nunique authors among originals: ${ranked.length}`);
    console.log(`top 10:`);
    for (const [sn, n] of ranked.slice(0, 10)) {
      console.log(`  @${sn.padEnd(24)} ${n}`);
    }
  }

  const samples = [...cleaned]
    .filter((t) => t._clean.length >= 60)
    .sort((a, b) => Date.parse(b.tweet_created_at) - Date.parse(a.tweet_created_at))
    .slice(0, 8);

  console.log(`\n--- 8 most recent originals (>= 60 chars) ---\n`);
  for (const t of samples) {
    const sn = t.user?.screen_name ?? "?";
    const date = t.tweet_created_at.slice(0, 10);
    console.log(`@${sn} (${date}) [${t._clean.length} chars]`);
    console.log(t._clean);
    console.log();
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
