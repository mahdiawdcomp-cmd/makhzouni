import { getGroqAudioClient, toFile } from "../utils/groq-audio-client";
import { logger } from "../utils/logger";

// Voice notes are how a lot of customers actually write. The webhook already
// downloads the audio and stores it for the chat screen, but nothing ever read
// it — a customer who spoke instead of typing got total silence from the shop.
//
// Whisper on Groq, not Claude: the Messages API takes no audio, Groq's key is
// already configured for the storefront assistant, and whisper-large-v3
// handles Iraqi Arabic well at a fraction of a cent per note.

const MODEL = "whisper-large-v3";
const MAX_AUDIO_BYTES = 20 * 1024 * 1024; // WhatsApp voice notes are far below this

function extensionFor(mime: string): string {
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("m4a") || mime.includes("mp4")) return "m4a";
  if (mime.includes("webm")) return "webm";
  return "ogg"; // WhatsApp's own default
}

/**
 * Returns the spoken text, or null when transcription isn't possible. Never
 * throws: a failed transcription must degrade to "we couldn't hear it", not
 * take down the webhook.
 */
export async function transcribeVoiceNote(audio: Buffer, mimeType: string): Promise<string | null> {
  const groq = getGroqAudioClient();
  if (!groq) return null;
  if (!audio.length || audio.length > MAX_AUDIO_BYTES) return null;

  try {
    const file = await toFile(audio, `voice.${extensionFor(mimeType)}`, { type: mimeType || "audio/ogg" });
    const result = await groq.audio.transcriptions.create({
      file,
      model: MODEL,
      // Telling it the language beats letting it guess on short, noisy clips.
      language: "ar",
      response_format: "text",
    });
    const text = typeof result === "string" ? result : (result as { text?: string }).text ?? "";
    const trimmed = text.trim();
    return trimmed || null;
  } catch (error) {
    logger.warn(`[transcribe] voice note failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** Pulls the bytes back out of the data URL the webhook already stored. */
export function dataUrlToAudio(dataUrl?: string | null): { buffer: Buffer; mime: string } | null {
  if (!dataUrl) return null;
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}
