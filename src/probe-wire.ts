// Bounded OpenAI SSE reader; handles CRLF, optional data spacing and EOF tails.
export async function readProbeStream(response: Response, signal?: AbortSignal, onFirstChunk?: () => void) {
  if (!response.body) throw new Error("Upstream returned no stream body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const payloads: string[] = [];
  let buffer = "", bytes = 0;
  const accept = (line: string) => {
    if (line.startsWith("data:")) payloads.push(line.slice(5).trim());
  };
  try {
    while (true) {
      if (signal?.aborted) throw new Error("Probe canceled");
      const { done, value } = await reader.read();
      if (done) break;
      if (bytes === 0) onFirstChunk?.();
      bytes += value.byteLength;
      if (bytes > 1024 * 1024) throw new Error("Probe response stream too large");
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      lines.forEach(accept);
    }
    buffer += decoder.decode();
    if (buffer) accept(buffer);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  return payloads;
}

// A text-only missing-attachment answer does not test PDF reading. This is
// unconfirmed delivery, NOT proof that the model lacks document capability.
export function reportsMissingPdfAttachment(text: string): boolean {
  return /\b(?:pdf|file|document|attachment)\b/i.test(text) && (
    /\b(?:no|without)\s+(?:pdf|file|document|attachment)\b/i.test(text) ||
    /\b(?:pdf|file|document|attachment)\b[^.!?\n]{0,100}\b(?:was(?:n['’]t| not)|is(?:n['’]t| not)|not)\s+(?:included|attached|provided|uploaded|available)\b/i.test(text) ||
    /\b(?:did(?:n['’]t| not)|have(?:n['’]t| not))\s+(?:receive|received)\b[^.!?\n]{0,80}\b(?:pdf|file|document|attachment)\b/i.test(text)
  );
}

export function expectedEcho(prompt: string): string {
  return prompt.split("---BEGIN---\n")[1]?.split("\n---END---")[0] ?? "";
}
