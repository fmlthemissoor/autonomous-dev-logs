import { z } from "zod";
import type { LlmProvider } from "../llm/types.js";
import type { DayDigest } from "../transcripts.js";
import { digestToPromptText } from "../transcripts.js";

export const DaySummarySchema = z.object({
  /**
   * The single most tweet-worthy thing from the day. Not "everything that
   * happened" — the one moment a reader would actually find interesting.
   */
  story: z.object({
    /** A short headline for the story. Internal — not the tweet itself. */
    title: z.string().min(1),
    /** What actually happened, in 2-4 sentences of substance. */
    what: z.string().min(1),
    /**
     * Why this is the *interesting* angle — the surprise, the contrarian
     * choice, the lesson, the bug nobody would have predicted. Forces the
     * model to commit to an angle instead of staying neutral.
     */
    why_interesting: z.string().min(1),
    /**
     * Concrete identifiers pulled from the transcripts: file paths, error
     * messages, function names, exact numbers, before/after measurements.
     * The thread writer is required to surface at least one of these.
     */
    evidence: z.array(z.string().min(1)).min(1),
    kind: z.enum(["feature", "bug", "refactor", "investigation", "discovery", "infra", "other"]),
  }),
  /** 1-2 sentence overall vibe for the day. Used by the visual planner. */
  mood: z.string().min(1),
});

export type DaySummary = z.infer<typeof DaySummarySchema>;

const SYSTEM = `You are an editor. Read a developer's raw Claude Code transcripts and pick THE SINGLE most tweet-worthy thing they did.

This is not a summary. You are choosing one moment. The other 90% of the day is irrelevant — drop it.

What makes something tweet-worthy:
- A specific bug with a non-obvious root cause
- A deletion that improved things (lines removed, abstractions collapsed)
- A measured change (latency, allocations, build time, step count)
- A contrarian decision and the reason behind it
- A surprising thing the developer learned about a tool, library, or system
- A failed approach abandoned for a better one — with the why

What is NOT tweet-worthy (do not pick these):
- "Shipped feature X." Without a story behind it, it's just a release note.
- Routine work: writing tests, fixing typos, refactoring something nobody will care about.
- Vague progress: "made improvements to the pipeline."

Pick the moment with the most signal-per-character. If two things compete, prefer the one with concrete evidence (a file path, a number, an error message) over the one without.

PICK THE RIGHT ALTITUDE (read carefully — easy to get wrong):
Before locking in a story, decide what KIND of day this is:

(a) DISCRETE EVENT day — one self-contained finding: a specific bug fixed, a deletion, a single measured change in an otherwise stable system. Headline = the event itself.

(b) BROADER EXPLORATION day — the developer is trying out a new tool / model / library / framework / approach in their existing system. There may be several findings within that exploration (what worked, what didn't, surprising costs, edge cases).

For exploration days, the headline MUST be the exploration itself, framed as ongoing work:
   ✓ "Testing Haiku in our verification pipeline"
   ✗ "Extended thinking on Haiku saved $0.08/run"  (this is a finding INSIDE the exploration, not the story)

The specific finding becomes the most interesting *evidence* inside \`what\` and \`why_interesting\`, not the title.

Why this matters: a reader landing on a narrow finding has no idea what the developer is actually doing. A reader landing on the framed exploration learns the project context AND the finding.

Heuristics for spotting an exploration day:
- Multiple sub-experiments or A/B tests in the transcripts
- Phrases like "tried X", "switching to Y", "experimenting with Z", "what if we used"
- The developer's existing system is referenced as the baseline (not the subject)
- Tool calls touch the same files repeatedly with different configurations

When unsure, prefer the broader frame.

Output strictly this JSON shape:
{
  "story": {
    "title": "string — short internal headline",
    "what": "string — 2-4 sentences of what happened",
    "why_interesting": "string — the angle, the surprise, the lesson",
    "evidence": ["string", ...] — concrete identifiers from the transcript: file paths, errors, function names, numbers. At least one. The writer is required to surface one of these in the thread.,
    "kind": "feature" | "bug" | "refactor" | "investigation" | "discovery" | "infra" | "other"
  },
  "mood": "string — 1-2 sentences"
}`;

export const summarizeDay = async (digest: DayDigest, llm: LlmProvider): Promise<DaySummary> => {
  const transcript = digestToPromptText(digest);
  const user = `Here are the developer's Claude Code transcripts for the window:

${transcript}

Pick the single most tweet-worthy moment per the JSON schema in the SYSTEM section. Do not summarize the day.`;

  return llm.call({
    system: SYSTEM,
    fewShot: [],
    user,
    schema: DaySummarySchema,
    label: "summarize-day",
    maxOutputTokens: 2048,
  });
};
