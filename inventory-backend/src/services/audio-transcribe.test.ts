import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// Groq's transcription client is stubbed — the suite must never upload audio
// to a real endpoint, and must never depend on a key being present.

let scripted: Array<string | Error> = [];
let calls: Array<{ model: string; language?: string }> = [];

class FakeGroq {
  audio = {
    transcriptions: {
      create: async ({ model, language }: any) => {
        calls.push({ model, language });
        const next = scripted.shift();
        if (next instanceof Error) throw next;
        return next ?? "";
      },
    },
  };
}

// The local seam, not "groq-sdk" itself — mocking the package does not survive
// this project's CJS default-import interop and the real SDK would load.
const fake = new FakeGroq();
mock.module("../utils/groq-audio-client", {
  exports: {
    getGroqAudioClient: () => fake,
    toFile: async (data: Buffer, name: string, opts: any) => ({ data, name, opts }),
  },
});

let transcribeVoiceNote: (audio: Buffer, mime: string) => Promise<string | null>;
let dataUrlToAudio: (dataUrl?: string | null) => { buffer: Buffer; mime: string } | null;

describe("voice note transcription", () => {
  before(async () => {
    process.env.GROQ_API_KEY = "test-key";
    ({ transcribeVoiceNote, dataUrlToAudio } = await import("./audio-transcribe.service"));
  });

  beforeEach(() => {
    scripted = [];
    calls = [];
  });

  it("returns the spoken words, asking for Arabic explicitly", async () => {
    scripted = ["اريد كارتون تكتك"];
    const text = await transcribeVoiceNote(Buffer.from("fake-audio"), "audio/ogg");
    assert.equal(text, "اريد كارتون تكتك");
    assert.equal(calls[0].language, "ar", "short noisy clips transcribe far better when the language is stated");
  });

  it("blank audio transcribes to null rather than an empty message", async () => {
    scripted = ["   "];
    assert.equal(await transcribeVoiceNote(Buffer.from("x"), "audio/ogg"), null);
  });

  it("a transcription failure returns null instead of throwing into the webhook", async () => {
    scripted = [new Error("groq exploded")];
    assert.equal(await transcribeVoiceNote(Buffer.from("x"), "audio/ogg"), null);
  });

  it("empty audio never reaches the API", async () => {
    assert.equal(await transcribeVoiceNote(Buffer.alloc(0), "audio/ogg"), null);
    assert.equal(calls.length, 0);
  });

  it("reads the audio back out of the data URL the webhook stored", () => {
    const bytes = Buffer.from("hello-audio");
    const parsed = dataUrlToAudio(`data:audio/ogg;base64,${bytes.toString("base64")}`);
    assert.equal(parsed?.mime, "audio/ogg");
    assert.equal(parsed?.buffer.toString(), "hello-audio");
    assert.equal(dataUrlToAudio(null), null);
    assert.equal(dataUrlToAudio("not-a-data-url"), null);
  });
});
