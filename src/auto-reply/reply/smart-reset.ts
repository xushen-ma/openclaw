export const DEFAULT_SMART_RESET_REVIEW_PROMPT =
  "Review this conversation and save any important information before starting a fresh session.";

export function resolveSmartResetReviewConfig(cfg: unknown): {
  enabled: boolean;
  prompt: string;
  wait: boolean;
} {
  const smartReset = (cfg as { session?: { smartReset?: unknown } } | undefined)?.session
    ?.smartReset as
    | {
        enabled?: unknown;
        prompt?: unknown;
        wait?: unknown;
      }
    | undefined;
  const enabled = smartReset?.enabled === true;
  const prompt =
    typeof smartReset?.prompt === "string" && smartReset.prompt.trim().length > 0
      ? smartReset.prompt.trim()
      : DEFAULT_SMART_RESET_REVIEW_PROMPT;
  const wait = smartReset?.wait === true;
  return { enabled, prompt, wait };
}
