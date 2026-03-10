import fs from "node:fs/promises";
import type { OpenClawConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import { logVerbose } from "../../globals.js";
import { getGlobalHookRunner } from "../../plugins/hook-runner-global.js";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import { resolveSmartResetReviewConfig } from "./smart-reset.js";

const BEFORE_RESET_DEDUP_WINDOW_MS = 30_000;
const beforeResetRunAtByKey = new Map<string, number>();

const shouldSkipBeforeResetHook = (dedupeKey: string): boolean => {
  const now = Date.now();
  for (const [key, ts] of beforeResetRunAtByKey.entries()) {
    if (now - ts > BEFORE_RESET_DEDUP_WINDOW_MS) {
      beforeResetRunAtByKey.delete(key);
    }
  }
  const lastRunAt = beforeResetRunAtByKey.get(dedupeKey);
  if (typeof lastRunAt === "number" && now - lastRunAt <= BEFORE_RESET_DEDUP_WINDOW_MS) {
    return true;
  }
  beforeResetRunAtByKey.set(dedupeKey, now);
  return false;
};

export async function runBeforeResetPluginHook(params: {
  cfg: OpenClawConfig;
  reason: "new" | "reset" | "stale" | "expiry" | "thread-archived" | (string & {});
  sessionKey: string | undefined;
  sessionEntry?: SessionEntry;
  previousSessionEntry?: SessionEntry;
  workspaceDir: string;
  dedupeKey?: string;
}): Promise<void> {
  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks("before_reset")) {
    return;
  }

  if (params.dedupeKey && shouldSkipBeforeResetHook(params.dedupeKey)) {
    logVerbose(`before_reset: dedup skip (session=${params.sessionKey}, reason=${params.reason})`);
    return;
  }

  const entry = params.previousSessionEntry ?? params.sessionEntry;
  const smartReset = resolveSmartResetReviewConfig(params.cfg);

  const run = async () => {
    const runMode = smartReset.enabled && smartReset.wait ? "sync" : "async";
    logVerbose(`before_reset: enter (${runMode})`);
    try {
      const sessionFile = entry?.sessionFile;
      const messages: unknown[] = [];
      if (sessionFile) {
        try {
          const content = await fs.readFile(sessionFile, "utf-8");
          for (const line of content.split("\n")) {
            if (!line.trim()) {
              continue;
            }
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === "message" && parsed.message) {
                messages.push(parsed.message);
              }
            } catch {
              // skip malformed lines
            }
          }
        } catch (err) {
          logVerbose(`before_reset: failed to read session file: ${String(err)}`);
        }
      } else {
        logVerbose("before_reset: no session file available, firing hook with empty messages");
      }

      await hookRunner.runBeforeReset(
        {
          sessionFile,
          messages,
          reason: params.reason,
          reviewPrompt: smartReset.enabled ? smartReset.prompt : undefined,
        },
        {
          agentId: resolveAgentIdFromSessionKey(params.sessionKey),
          sessionKey: params.sessionKey,
          sessionId: entry?.sessionId,
          workspaceDir: params.workspaceDir,
        },
      );
      logVerbose("before_reset: complete");
    } catch (err: unknown) {
      logVerbose(`before_reset hook failed: ${String(err)}`);
    }
  };

  if (smartReset.enabled && smartReset.wait) {
    await run();
  } else {
    void run();
  }
}
