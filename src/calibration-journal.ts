// Durable operator-side request journal. Never replay an uncertain network attempt.
import { appendFileSync, closeSync, existsSync, fsyncSync, openSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { normalizeBiasAnswer } from "./sub-model-bias-probes.js";

type Entry = { type: "begin" | "result"; slot: string; requestHash: string; at: string; data?: any; status?: number; source?: string };
export class CalibrationJournal {
  private entries = new Map<string, Entry>();
  private fd: number;
  constructor(readonly file: string, readonly maximumAttempts: number) {
    if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1) throw new Error("Invalid journal budget");
    if (existsSync(file)) {
      const text = readFileSync(file, "utf8");
      if (text && !text.endsWith("\n")) throw new Error("Journal has an incomplete write; manual review required");
      for (const line of text.split("\n").filter(Boolean)) {
        const entry = JSON.parse(line) as Entry;
        if (!["begin", "result"].includes(entry.type) || !entry.slot || !entry.requestHash) throw new Error("Invalid journal entry");
        const old = this.entries.get(entry.slot);
        if (entry.type === "begin" && old) throw new Error("Duplicate journal attempt");
        if (entry.type === "result" && (!old || old.type !== "begin" || old.requestHash !== entry.requestHash)) throw new Error("Result without matching attempt");
        this.entries.set(entry.slot, entry);
      }
    }
    if (this.entries.size > maximumAttempts) throw new Error("Journal exceeds budget");
    this.fd = openSync(file, "a", 0o600);
  }
  private record(entry: Entry) {
    appendFileSync(this.fd, JSON.stringify(entry) + "\n");
    fsyncSync(this.fd);
    this.entries.set(entry.slot, entry);
  }
  get attempts() { return this.entries.size; }
  get uncertain() { return [...this.entries.values()].filter(e => e.type === "begin").map(e => e.slot); }
  get results() { return [...this.entries.values()].filter(e => e.type === "result"); }
  close() { closeSync(this.fd); }
  acknowledgeUncertain(slot: string) {
    const old = this.entries.get(slot);
    if (!old || old.type !== "begin") throw new Error("No uncertain attempt at this slot");
    this.record({ type: "result", slot, requestHash: old.requestHash, at: new Date().toISOString(),
      status: 599, source: "operator-authorized-replacement-outcome-remains-unknown",
      data: { error: { message: "Outcome unknown; operator authorized a separate replacement attempt" } } });
  }
  static requestHash(body: string) { return createHash("sha256").update(body).digest("hex"); }
  seed(slot: string, body: string, data: any) {
    if (this.entries.has(slot)) return;
    const requestHash = CalibrationJournal.requestHash(body);
    this.record({ type: "begin", slot, requestHash, at: new Date().toISOString(), source: "prior-authorized-compatibility-call" });
    this.record({ type: "result", slot, requestHash, at: new Date().toISOString(), data, status: 200, source: "prior-authorized-compatibility-call" });
  }
  async request(slot: string, body: string, call: () => Promise<Response>, secret: string): Promise<Response> {
    const requestHash = CalibrationJournal.requestHash(body);
    const old = this.entries.get(slot);
    if (old) {
      if (old.requestHash !== requestHash) throw new Error("Sampling protocol changed");
      if (old.type !== "result") throw new Error("Uncertain attempt requires manual review; refusing to resend");
      return Response.json(old.data, { status: old.status });
    }
    if (this.attempts >= this.maximumAttempts) throw new Error("Session request budget exhausted");
    this.record({ type: "begin", slot, requestHash, at: new Date().toISOString() });
    // If transport, parsing, or persistence fails, leave BEGIN unresolved. Never guess it was unbilled.
    const response = await call();
    const reader = response.body?.getReader();
    let text = "", size = 0;
    const decoder = new TextDecoder();
    try {
      if (reader) while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 65536) throw new Error("Response too large");
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally { if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); } }
    let data: any;
    if (!response.ok) {
      // Persist retry timing, never upstream error bodies or arbitrary headers.
      const rawRetry = response.headers.get("retry-after");
      const seconds = rawRetry && /^\d+$/.test(rawRetry) ? Number(rawRetry) : NaN;
      const dateMs = rawRetry ? Date.parse(rawRetry) : NaN;
      const retryAfterMs = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : null;
      data = { error: { message: "Provider error body suppressed" }, retryAfterMs: retryAfterMs === null ? null : Math.min(retryAfterMs, 3600000) };
    }
    else {
      const d = JSON.parse(text);
      const c = d?.choices?.[0], content = c?.message?.content;
      if (typeof content !== "string" || content.includes(secret) || c?.message?.tool_calls?.length) throw new Error("Invalid or sensitive answer");
      data = {
        choices: [{ finish_reason: c.finish_reason, message: { content: normalizeBiasAnswer(content) || "" } }],
        usage: Object.fromEntries(["prompt_tokens", "completion_tokens", "total_tokens"].filter(k => Number.isSafeInteger(d?.usage?.[k]) && d.usage[k] >= 0).map(k => [k, d.usage[k]])),
      };
    }
    this.record({ type: "result", slot, requestHash, at: new Date().toISOString(), data, status: response.status });
    return Response.json(data, { status: response.status });
  }
}
