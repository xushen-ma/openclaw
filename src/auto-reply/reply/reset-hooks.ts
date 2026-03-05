import fs from "node:fs/promises";
import type { OpenClawConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import { logVerbose } from "../../globals.js";
import { getGlobalHookRunner } from "../../plugins/hook-runner-global.js";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import { resolveSmartResetReviewConfig } from "./smart-reset.js";

export async function runBeforeResetPluginHook(params: {
  cfg: OpenClawConfig;
  reason: "new" | "reset" | "stale" | "expiry" | "thread-archived" | (string & {});
  sessionKey: string;
  sessionEntry?: SessionEntry;
  previousSessionEntry?: SessionEntry;
  workspaceDir: string;
}): Promise<void> {
  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks("before_reset")) {
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
