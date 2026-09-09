import Anthropic from "@anthropic-ai/sdk";

// One place that owns Anthropic client construction, for two reasons:
//
// 1. "Is the AI configured at all?" becomes a single question with a single
//    answer (null = not configured), instead of each caller re-deriving it.
// 2. It is a local module, so tests can mock it. Mocking "@anthropic-ai/sdk"
//    itself does not take effect through the CJS default-import interop this
//    project compiles to — the real SDK loads and the suite makes live calls.

let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}
