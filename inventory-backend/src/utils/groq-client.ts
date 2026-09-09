import Groq from "groq-sdk";

// One place that owns Groq client construction, for two reasons:
//
// 1. "Is the AI configured at all?" becomes a single question with a single
//    answer (null = not configured), instead of each caller re-deriving it.
// 2. It is a local module, so tests can mock it. Mocking "groq-sdk" itself
//    does not take effect through the CJS default-import interop this project
//    compiles to — the real SDK loads and the suite makes live API calls.

let client: Groq | null = null;

export function getGroqClient(): Groq | null {
  if (!process.env.GROQ_API_KEY) return null;
  if (!client) client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return client;
}
