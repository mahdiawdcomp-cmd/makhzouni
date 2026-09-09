import Groq, { toFile } from "groq-sdk";

// Local seam for the Groq client used by voice-note transcription — same
// reason as utils/anthropic-client.ts: mocking "groq-sdk" itself does not
// survive this project's CJS default-import interop, so a test would load the
// real SDK and try to upload audio to a live endpoint.

let client: Groq | null = null;

export function getGroqAudioClient(): Groq | null {
  if (!process.env.GROQ_API_KEY) return null;
  if (!client) client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return client;
}

export { toFile };
