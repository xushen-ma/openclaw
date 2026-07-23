import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type QuickMemoryStat = {
  layer: "fast-pass" | "fast-pass-shared" | "session-fast-pass" | "session-local";
  routing: "per-agent" | "legacy" | "local";
  agentId: string;
  query: string;
  maxResults: number;
  totalHits: number;
  resultCount: number;
};

export async function appendQuickMemoryStat(path: string | undefined, entry: QuickMemoryStat) {
  if (!path) {
    return;
  }
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
  } catch {
    // Stats logging is best-effort and must never fail the model-facing tool call.
  }
}
