import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, randomBytes } from "node:crypto";
import { getAsyncWorkSignal } from "../shared/async-work-scope.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";

type Phase =
  | "direct-entry"
  | "session-read"
  | "model-selection"
  | "directive-levels"
  | "thinking-catalog"
  | "render"
  | "harness"
  | "owner"
  | "model"
  | "usage"
  | "cost"
  | "queue"
  | "subagents"
  | "plugins"
  | "context-window"
  | "thinking"
  | "presentation";
type Context = {
  phase: Phase;
  entrySignal: ReturnType<typeof signalFact>;
  correlation?: string;
  owner?: { isCurrent: () => boolean };
  ownerObserved?: boolean;
};
const state = resolveGlobalSingleton(Symbol.for("openclaw.statusDiagnostics"), () => ({
  context: new AsyncLocalStorage<Context>(),
  key: randomBytes(32),
}));

function errorClass(error: unknown): string {
  try {
    if (!(error instanceof Error)) return "non-error";
    const name = error.name;
    return ["AbortError", "TimeoutError", "TypeError", "RangeError", "Error"].includes(name)
      ? name
      : "other-error";
  } catch {
    return "other-error";
  }
}
function signalFact() {
  const signal = getAsyncWorkSignal();
  return signal
    ? { aborted: signal.aborted, reason: signal.aborted ? errorClass(signal.reason) : undefined }
    : null;
}

/** Opt-in observation only: never changes work ownership, cancellation, or authorization. */
export function withStatusDiagnostics<T>(run: () => T, phase: Phase = "direct-entry"): T {
  if (process.env.OPENCLAW_STATUS_DIAGNOSTICS !== "1" || state.context.getStore()) return run();
  return state.context.run({ phase, entrySignal: signalFact() }, run);
}

export function markStatusPhase(phase: Phase): void {
  const context = state.context.getStore();
  if (context) context.phase = phase;
}
export function observeStatusSession(sessionKey: string): void {
  const context = state.context.getStore();
  if (context)
    context.correlation = createHmac("sha256", state.key)
      .update(sessionKey)
      .digest("hex")
      .slice(0, 16);
}
export function observeStatusOwner(owner: Context["owner"]): void {
  const context = state.context.getStore();
  if (context) {
    context.ownerObserved = true;
    context.owner = owner ? { isCurrent: () => owner.isCurrent() } : undefined;
  }
}

/** No messages, arbitrary object serialization, absolute paths, or auth/config values. */
export function formatStatusDiagnostic(error: unknown): string {
  if (!state.context.getStore()) return "";
  try {
    return formatDiagnostic(error);
  } catch {
    return ' statusDiagnostic={"observation":"unavailable"}';
  }
}

function formatDiagnostic(error: unknown): string {
  const context = state.context.getStore();
  if (!context) return "";
  let owner: "not-observed" | "absent" | "current" | "replaced" | "unavailable" =
    context.ownerObserved ? "absent" : "not-observed";
  try {
    if (context.owner) owner = context.owner.isCurrent() ? "current" : "replaced";
  } catch {
    owner = "unavailable";
  }
  const errors: { kind: string; frames: string[] }[] = [];
  const seen = new Set<unknown>();
  for (
    let cause = error;
    cause instanceof Error && !seen.has(cause) && errors.length < 3;
    cause = cause.cause
  ) {
    seen.add(cause);
    // Only source locations from stack frame lines; omit the message and function text.
    const header = `${cause.name}: ${cause.message}`;
    const stack = cause.stack ?? "";
    // V8 includes the complete (possibly multiline) message before its frames.
    // Unknown/custom stack formats provide no trustworthy header boundary.
    const frameText = stack.startsWith(header)
      ? stack.slice(header.length, header.length + 8192)
      : "";
    const frames = frameText
      .split("\n")
      .slice(1, 13)
      .flatMap((line) => {
        if (!/^\s+at (?:async )?/.test(line)) return [];
        const match =
          /(?:[/\\])([a-zA-Z0-9_.-]{1,100}\.(?:[cm]?js|tsx?)):(\d{1,7}):(\d{1,7})\)?$/.exec(line);
        return match ? [match.slice(1).join(":")] : [];
      })
      .slice(0, 6);
    errors.push({ kind: errorClass(cause), frames });
  }
  return (
    " statusDiagnostic=" +
    JSON.stringify({
      phase: context.phase,
      correlation: context.correlation,
      entrySignal: context.entrySignal,
      signal: signalFact(),
      owner,
      errors,
    })
  );
}
