# Autonomous Dev Logs

Turn your daily Claude Code sessions into a tweet-ready dev-log post, delivered to Telegram for manual posting.

## What it does

1. Reads your Claude Code transcripts from `~/.claude/projects/` for the last N hours.
2. Condenses them (drops verbose tool payloads, keeps prompts / assistant text / tool names / git branches).
3. Picks **one** tweet-worthy moment from the day — not a summary, a single story (a bug, a deletion, a measurement, a contrarian decision). The other 90% is dropped.
4. Plans a visual: `none`, `chart`, `code_snippet`, or `illustration` — whichever fits.
5. Loads your **voice library** (style examples from accounts you admire) and **personal feed** (your own recent X posts, used as "what followers already know") from disk.
6. Writes an X post in your voice, calibrating depth against your prior coverage.
7. Renders the visual to PNG locally.
8. Sends post + image to your Telegram chat. You read it, tweak if needed, post manually.

It does **not** auto-post to X. The point is a human-in-the-loop draft, not autonomous publishing.

## Why this design

- **Pick one story, not summarize.** Threads that try to recap the whole day read like changelogs. The editor stage is told to pick the single most tweet-worthy moment and drop everything else.
- **Right altitude.** The editor distinguishes *discrete events* (one bug fixed, one deletion) from *broader explorations* (trying a new model, prototyping). For exploration days the headline is the exploration itself, with specific findings as evidence — never the other way round.
- **Single tweet by default.** Length follows substance. The writer only splits into a thread when the natural draft genuinely runs longer than ~20 lines. Most days, that's one tweet.
- **Prior-coverage calibration.** Your own recent X posts are passed as context. Topics covered in depth before → low-key write-up, no introduction. New topics → more context. The reader isn't told what they already know.
- **Voice mimicry, not topic copy.** Tweets from accounts whose style you admire are used purely as *style* examples — tone, line breaks, sentence rhythm. The model is forbidden from copying their topics.
- **The planner picks the visual.** Some days a chart is the move; some days a syntax-highlighted code snippet; some days plain text wins.
- **Two LLM modes.** Use your Claude Code Max subscription via the `claude` CLI (no extra cost, shares your 5-hour rate-limit window) or hit the Anthropic API directly (pay per token, but with prompt caching).
- **Daily runs are offline-from-SocialData.** The voice library and personal feed are built explicitly via separate scripts and saved to `data/`. `npm run send` only reads from disk.
- **No auto-post.** You always review before publishing.

## Requirements

- Node 20+
- Either Claude Code installed (`claude` on `$PATH`) **or** an Anthropic API key
- A Telegram bot token + your chat id
- (Optional) An OpenAI API key if you want to enable the `illustration` format
- (Optional) A SocialData.tools API key if you want voice learning or personal-feed coverage tracking

## Install

```bash
git clone https://github.com/fmlthemissoor/autonomous-dev-logs.git
cd autonomous-dev-logs
npm install
cp .env.example .env
cp config.example.yaml config.yaml
```

Then edit `.env` and `config.yaml` (see comments inside both files).

## Configure your tweet voice

Three signals layer in the writer prompt. Pick whichever you want:

**Manual examples** — open `config.yaml` and put 5-20 of your own tweets in `tweet_examples`. Used as a fallback when voice learning is off or returns nothing.

**Voice learning (recommended)** — set `voice_learning.enabled: true` and list 2-5 accounts in `voice_accounts`. The writer uses their tweets as style examples (tone, structure, line breaks) but is told not to copy their topics. Add `SOCIALDATA_API_KEY` to `.env` (sign up at https://socialdata.tools — pay-as-you-go, fractions of a cent per call).

Build the library once, then re-run weekly when you want fresher examples:
```bash
npm run refresh-voice
```
Saves to `data/voice-library.json`. The daily pipeline only reads from this file — it never calls SocialData on `npm run send`.

Knobs in `config.yaml`:
- `examples_per_voice_account` — how many tweets per handle to surface to the writer.
- `min_tweet_chars` — drop one-liners. Higher = paragraph-style examples only. 120 is a good default; 440+ is aggressive.
- `exclude_replies` — usually true.

**Personal feed (PRIOR COVERAGE)** — set `personal_feed.enabled: true` to pull your own recent X posts. The writer is told these are "what followers already know" and adjusts depth accordingly: deep-covered topics get low-key updates; new topics get more introduction. Build the file once, refresh weekly:
```bash
npm run refresh-personal-feed
```
Saves to `data/personal-feed.json`. Read-only on daily runs.

To debug what SocialData returns for any handle:
```bash
npm run inspect -- @your_handle 50
```

## Configure Telegram

1. Open Telegram, talk to [@BotFather](https://t.me/BotFather), run `/newbot`. Save the token.
2. Send any message to your new bot.
3. Visit `https://api.telegram.org/bot<token>/getUpdates` and look for `"chat":{"id":<NUMBER>}`. That's your `TELEGRAM_CHAT_ID`.

## Use

Dry run (writes thread + image to `./out/`, no Telegram):
```bash
npm run generate
```

Full run (renders + delivers to Telegram):
```bash
npm run send
```

Widen the lookback window when needed (default is `LOOKBACK_HOURS=24` from `.env`):
```bash
LOOKBACK_HOURS=48 npm run send
```

### Optional: shell alias

Add a one-word shortcut so you can run from any directory:
```bash
printf '\ndevlog() {\n  (cd /Users/you/path/to/autonomous-dev-logs && npm run send "$@")\n}\n' >> ~/.zshrc
source ~/.zshrc
```
Then `devlog`, `devlog --dry-run`, or `LOOKBACK_HOURS=48 devlog` from anywhere.

## Filtering transcripts

Three knobs under `transcripts:` in `config.yaml`:

- **`include_cwd_substrings`** — only include sessions whose working directory contains one of these substrings. Empty = include everything. Use this to scope the digest to a specific project.
- **`exclude_cwd_substrings`** — drop sessions whose cwd contains one of these. Useful for excluding `secrets`, this meta-project, etc.
- **`exclude_text_substrings`** — drop individual *turns* whose text or tool calls contain any of these substrings. Catches sessions that have the right cwd but the conversation references files from another project (e.g. you asked Claude to look at a file outside the project).

## Schedule it (macOS)

A sample `launchd` plist is in `scripts/launchd.plist.example` — runs once a day at 18:00. Edit the paths, copy to `~/Library/LaunchAgents/com.autonomous-dev-logs.plist`, then:
```bash
launchctl load ~/Library/LaunchAgents/com.autonomous-dev-logs.plist
```

On Linux, drop a line in `crontab -e` like:
```
0 18 * * * cd /path/to/autonomous-dev-logs && /usr/local/bin/npm run send >> ~/autonomous-dev-logs.log 2>&1
```

## Architecture

```
~/.claude/projects/*/*.jsonl   →   transcripts.ts        (read + filter + condense)
                                          ↓
                                   summarize.ts          (LLM: pick ONE story + evidence)
                                          ↓
                                  plan-visual.ts         (LLM: story → visual spec)
                                          ↓
data/voice-library.json         →  learn-voice.ts        (read style examples)
data/personal-feed.json         →  personal-feed.ts      (read prior coverage)
                                          ↓
                                  write-thread.ts        (LLM: story + style + coverage → post)
                                          ↓
                                renderers/*.ts           (chart | code_snippet | illustration | none)
                                          ↓
                                   telegram.ts           (sendPhoto + sendMessage)

(Separate, manual)
SocialData → refresh-voice.ts          → data/voice-library.json
SocialData → refresh-personal-feed.ts  → data/personal-feed.json
```

The LLM provider lives behind a small interface in `src/llm/types.ts` with two implementations (`subscription.ts`, `api.ts`). Switch via `LLM_PROVIDER` in `.env`.

## Privacy

- All transcript reading is local. Nothing leaves your machine until the LLM call.
- The `out/`, `data/`, and `config.yaml` paths are `.gitignored`. Generated posts, images, fetched tweets, and your config never get committed.
- The condenser drops tool result payloads larger than `transcripts.max_tool_result_chars` (default 800) before sending anything to the LLM, so source code dumps and command output don't get shipped wholesale.
- `exclude_cwd_substrings` and `exclude_text_substrings` give you cwd- and content-level filtering for sensitive projects.
- SocialData calls only read **public** tweet metadata. No OAuth, no auth on your account, no posting permissions.

## License

MIT
