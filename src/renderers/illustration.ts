import type { IllustrationSpec } from "../stages/plan-visual.js";

/**
 * Renders an illustration via OpenAI's gpt-image-1 endpoint.
 * Returns a PNG buffer. Requires OPENAI_API_KEY in the environment.
 */
export const renderIllustration = async (
  spec: IllustrationSpec,
  apiKey: string,
): Promise<Buffer> => {
  const prompt = spec.style ? `${spec.prompt}. Style: ${spec.style}.` : spec.prompt;

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt,
      size: "1536x1024",
      n: 1,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI image API returned ${response.status}: ${await response.text()}`);
  }

  const json = (await response.json()) as { data: Array<{ b64_json?: string; url?: string }> };
  const first = json.data[0];
  if (!first) throw new Error("OpenAI image API returned no images");

  if (first.b64_json) {
    return Buffer.from(first.b64_json, "base64");
  }
  if (first.url) {
    const imgResponse = await fetch(first.url);
    if (!imgResponse.ok) throw new Error(`failed to fetch image url: ${imgResponse.status}`);
    return Buffer.from(await imgResponse.arrayBuffer());
  }
  throw new Error("OpenAI image API returned neither b64_json nor url");
};
