import { z } from "zod";

/**
 * Thin client for SocialData.tools — used to read public tweet metadata for
 * voice-learning. Engagement metrics (likes/RTs/replies/quotes/views) are
 * public, so this works without OAuth.
 *
 * Endpoints used:
 *   GET /twitter/user/{handle}             → profile (returns id_str)
 *   GET /twitter/user/{id}/tweets          → paginated tweets (cursor in response)
 *   GET /twitter/list/{id}/tweets          → paginated list tweets
 *   GET /twitter/community/{id}/tweets     → paginated community tweets
 */

const ProfileSchema = z.object({
  id_str: z.string(),
  screen_name: z.string(),
  followers_count: z.number(),
  statuses_count: z.number(),
});

// Embedded author info on list/community tweet responses. Optional because
// the user-tweets endpoint omits it (the author is implied by the path).
const TweetUserSchema = z
  .object({
    screen_name: z.string().optional(),
    name: z.string().optional(),
  })
  .partial();

const TweetSchema = z.object({
  id_str: z.string(),
  full_text: z.string().default(""),
  tweet_created_at: z.string(),
  type: z.enum(["tweet", "retweet", "quote", "reply"]).default("tweet"),
  is_quote_status: z.boolean().default(false),
  is_pinned: z.boolean().default(false),
  in_reply_to_status_id_str: z.string().nullable().default(null),
  lang: z.string().nullable().default(null),
  favorite_count: z.number().default(0),
  retweet_count: z.number().default(0),
  reply_count: z.number().default(0),
  quote_count: z.number().default(0),
  bookmark_count: z.number().default(0),
  views_count: z.number().nullable().default(null),
  user: TweetUserSchema.optional(),
});

const TweetsResponseSchema = z.object({
  tweets: z.array(TweetSchema),
  next_cursor: z.string().nullable().optional(),
});

export type SocialDataProfile = z.infer<typeof ProfileSchema>;
export type SocialDataTweet = z.infer<typeof TweetSchema>;

const BASE = "https://api.socialdata.tools";

const stripAt = (handle: string): string => handle.replace(/^@/, "").trim();

const authHeaders = (apiKey: string): HeadersInit => ({
  Authorization: `Bearer ${apiKey}`,
  Accept: "application/json",
});

export const fetchProfile = async (handle: string, apiKey: string): Promise<SocialDataProfile> => {
  const url = `${BASE}/twitter/user/${encodeURIComponent(stripAt(handle))}`;
  const response = await fetch(url, { headers: authHeaders(apiKey) });
  if (!response.ok) {
    throw new Error(`SocialData profile fetch ${response.status} for ${handle}: ${await response.text()}`);
  }
  const json = (await response.json()) as unknown;
  return ProfileSchema.parse(json);
};

export interface FetchTweetsOptions {
  /** Hard cap on the number of tweets returned across pagination. */
  maxTweets: number;
  /** Soft cap on how many SocialData calls to make for one handle. */
  maxPages?: number;
}

// Shared cursor-pagination loop used by every tweets-returning endpoint.
// SocialData repeats pinned tweets (and occasionally page-boundary tweets)
// across pages, so we dedupe by id_str as we go.
const paginateTweets = async (
  baseUrl: string,
  apiKey: string,
  options: FetchTweetsOptions,
  extraParams: Record<string, string> = {},
): Promise<SocialDataTweet[]> => {
  const out: SocialDataTweet[] = [];
  const seen = new Set<string>();
  let cursor: string | null | undefined;
  const maxPages = options.maxPages ?? 10;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams(extraParams);
    if (cursor) params.set("cursor", cursor);
    const url = params.toString() ? `${baseUrl}?${params.toString()}` : baseUrl;
    const response = await fetch(url, { headers: authHeaders(apiKey) });
    if (!response.ok) {
      throw new Error(
        `SocialData tweets fetch ${response.status} for ${baseUrl}: ${await response.text()}`,
      );
    }
    const json = (await response.json()) as unknown;
    const parsed = TweetsResponseSchema.parse(json);
    for (const t of parsed.tweets) {
      if (seen.has(t.id_str)) continue;
      seen.add(t.id_str);
      out.push(t);
    }
    if (out.length >= options.maxTweets) {
      return out.slice(0, options.maxTweets);
    }
    if (!parsed.next_cursor) break;
    cursor = parsed.next_cursor;
  }
  return out;
};

export const fetchTweets = async (
  userId: string,
  apiKey: string,
  options: FetchTweetsOptions,
): Promise<SocialDataTweet[]> => {
  return paginateTweets(
    `${BASE}/twitter/user/${encodeURIComponent(userId)}/tweets`,
    apiKey,
    options,
  );
};

export const fetchListTweets = async (
  listId: string,
  apiKey: string,
  options: FetchTweetsOptions,
): Promise<SocialDataTweet[]> => {
  return paginateTweets(
    `${BASE}/twitter/list/${encodeURIComponent(listId)}/tweets`,
    apiKey,
    options,
  );
};

export const fetchCommunityTweets = async (
  communityId: string,
  apiKey: string,
  options: FetchTweetsOptions,
  sort: "Latest" | "Top" = "Latest",
): Promise<SocialDataTweet[]> => {
  return paginateTweets(
    `${BASE}/twitter/community/${encodeURIComponent(communityId)}/tweets`,
    apiKey,
    options,
    { type: sort },
  );
};

/** Pull profile and tweets in one call. */
export const fetchHandleTweets = async (
  handle: string,
  apiKey: string,
  options: FetchTweetsOptions,
): Promise<{ profile: SocialDataProfile; tweets: SocialDataTweet[] }> => {
  const profile = await fetchProfile(handle, apiKey);
  const tweets = await fetchTweets(profile.id_str, apiKey, options);
  return { profile, tweets };
};
