// Modified by OpenFilm contributors on 2026-10-19. See LICENSE and NOTICE.
import type { AudioGenerationProvider } from "@openfilm/plugin-sdk";
/** A protocol/workflow mock. This deliberately produces a tone, never claimed speech. */
export const localAudioMock: AudioGenerationProvider = {
  id: "local-audio-mock",
  name: "Local tone mock (not speech)",
  kind: "audio-generation",
  execution: "local",
  dataKinds: ["text"],
  async generateAudio(_text, options) {
    if (options?.signal?.aborted)
      throw new DOMException("Cancelled", "AbortError");
    const rate = 24000,
      samples = rate * 2;
    const bytes = new Uint8Array(44 + samples * 2);
    const view = new DataView(bytes.buffer);
    const ascii = (at: number, text: string) =>
      [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    ascii(0, "RIFF");
    view.setUint32(4, bytes.length - 8, true);
    ascii(8, "WAVEfmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, "data");
    view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++)
      view.setInt16(
        44 + i * 2,
        Math.round(
          3000 *
            Math.sin((i * 2 * Math.PI * 440) / rate) *
            Math.min(1, i / 240, (samples - i) / 240),
        ),
        true,
      );
    return { bytes, model: "deterministic-tone-v1", mock: true };
  },
};
/** Fixed destination, entered text only. Key is server-owned and never serialized. */
export function openAiTtsProvider(
  key: string,
  fetcher: typeof fetch = fetch,
): AudioGenerationProvider {
  return {
    id: "openai-tts",
    name: "OpenAI TTS (BYOK)",
    kind: "audio-generation",
    execution: "remote",
    endpoint: "https://api.openai.com/v1/audio/speech",
    dataKinds: ["text"],
    async generateAudio(text, options) {
      try {
        const response = await fetcher(
          "https://api.openai.com/v1/audio/speech",
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.any([
              options?.signal ?? new AbortController().signal,
              AbortSignal.timeout(60000),
            ]),
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-4o-mini-tts",
              voice: "alloy",
              input: text,
              response_format: "wav",
            }),
          },
        );
        if (!response.ok || !response.body)
          throw new Error("Provider request failed.");
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            size += next.value.byteLength;
            if (size > 8 * 1024 * 1024)
              throw new Error("Provider audio exceeds limit.");
            chunks.push(next.value);
          }
        } finally {
          await reader.cancel().catch(() => undefined);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return { bytes, model: "gpt-4o-mini-tts", mock: false };
      } catch {
        if (options?.signal?.aborted)
          throw new DOMException("Cancelled", "AbortError");
        // Never expose upstream bodies, URLs, headers or credentials.
        throw new Error(
          "TTS provider failed or timed out. Retry after checking configuration.",
        );
      }
    },
  };
}
