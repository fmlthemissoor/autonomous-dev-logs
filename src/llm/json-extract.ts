/**
 * Pulls the first JSON object or array out of a model response.
 * Models sometimes wrap JSON in ```json fences or chatty preambles; this
 * is more forgiving than `JSON.parse` on the raw text.
 */
export const extractJson = (raw: string): unknown => {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced && fenced[1]) {
    return JSON.parse(fenced[1].trim());
  }
  const firstBrace = raw.search(/[\[{]/);
  if (firstBrace >= 0) {
    // Walk from the first brace and try progressively shorter slices until JSON.parse succeeds.
    // This handles trailing text after the JSON.
    const opening = raw[firstBrace] === "[" ? "[" : "{";
    const closing = opening === "[" ? "]" : "}";
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = firstBrace; i < raw.length; i++) {
      const ch = raw[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === opening) depth++;
      else if (ch === closing) {
        depth--;
        if (depth === 0) {
          return JSON.parse(raw.slice(firstBrace, i + 1));
        }
      }
    }
  }
  return JSON.parse(raw);
};
