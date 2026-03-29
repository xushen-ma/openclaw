import crypto from "node:crypto";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { emitResetCommandHooks } from "../auto-reply/reply/commands-core.js";
import type { OpenClawConfig } from "../config/config.js";
import { resolveStorePath } from "../config/sessions/paths.js";
import {
  loadSessionStore,
  resolveSessionStoreEntry,
  updateSessionStore,
} from "../config/sessions/store.js";
import { appendUserMessageToSessionTranscript } from "../config/sessions/transcript.js";
import type { SessionEntry } from "../config/sessions/types.js";
import { archiveSessionTranscripts } from "../gateway/session-utils.fs.js";
import { resolveAgentIdFromSessionKey } from "../routing/session-key.js";

export type TargetedResetFailureCode =
  | "unauthorized"
  | "target_not_found"
  | "ambiguous_target"
  | "requester_target_conflict"
  | "rebrief_injection_failed";

export type TargetedResetResult =
  | {
      ok: true;
      targetSessionKey: string;
      previousSessionId: string;
      newSessionId: string;
      targetAgentId: string;
      rebriefDisposition: "injected" | "none";
      rebrief?: string;
    }
  | {
      ok: false;
      code: TargetedResetFailureCode;
      message: string;
      targetSessionKey?: string;
      targetAgentId?: string;
    };

export async function performTargetedReset(params: {
  cfg: OpenClawConfig;
  requesterSessionKey: string;
  targetSessionKey: string;
  requesterAuthorized: boolean;
  rebrief?: string;
}): Promise<TargetedResetResult> {
  const requesterSessionKey = params.requesterSessionKey.trim();
  const targetSessionKey = params.targetSessionKey.trim();
  const targetAgentId = resolveAgentIdFromSessionKey(targetSessionKey);
  if (!params.requesterAuthorized) {
    return {
      ok: false,
      code: "unauthorized",
      message: "Requester is not authorized to reset the target session.",
      targetSessionKey,
      targetAgentId,
    };
  }
  if (!targetSessionKey) {
    return {
      ok: false,
      code: "ambiguous_target",
      message: "Target session must resolve to a single exact session key.",
      targetAgentId,
    };
  }
  if (requesterSessionKey && requesterSessionKey === targetSessionKey) {
    return {
      ok: false,
      code: "requester_target_conflict",
      message: "Targeted reset must not silently target the requester session.",
      targetSessionKey,
      targetAgentId,
    };
  }

  const storePath = resolveStorePath(params.cfg.session?.store, { agentId: targetAgentId });
  const existingStore = loadSessionStore(storePath, { skipCache: true });
  const resolved = resolveSessionStoreEntry({ store: existingStore, sessionKey: targetSessionKey });
  const existing = resolved.existing;
  if (!existing) {
    return {
      ok: false,
      code: "target_not_found",
      message: "Target session not found.",
      targetSessionKey,
      targetAgentId,
    };
  }

  const previousSessionId = existing.sessionId;
  const previousSessionFile = existing.sessionFile;
  const now = Date.now();
  const newSessionId = crypto.randomUUID();
  const next: SessionEntry = {
    ...existing,
    sessionId: newSessionId,
    sessionFile: undefined,
    updatedAt: now,
    systemSent: false,
    abortedLastRun: false,
    compactionCount: 0,
    memoryFlushCompactionCount: undefined,
    memoryFlushAt: undefined,
    totalTokens: undefined,
    inputTokens: undefined,
    outputTokens: undefined,
    contextTokens: undefined,
  };

  await emitResetCommandHooks({
    action: "new",
    ctx: {} as never,
    cfg: params.cfg,
    command: {
      surface: "tool",
      senderId: resolveAgentIdFromSessionKey(requesterSessionKey),
      channel: "tool",
      from: requesterSessionKey,
      to: targetSessionKey,
      resetHookTriggered: false,
    },
    sessionKey: targetSessionKey,
    sessionEntry: existing,
    previousSessionEntry: existing,
    workspaceDir: resolveAgentWorkspaceDir(params.cfg, targetAgentId),
  });

  await updateSessionStore(
    storePath,
    (store) => {
      const nextResolved = resolveSessionStoreEntry({ store, sessionKey: targetSessionKey });
      if (!nextResolved.existing) {
        return null;
      }
      store[nextResolved.normalizedKey] = next;
      for (const legacyKey of nextResolved.legacyKeys) {
        delete store[legacyKey];
      }
      return next;
    },
    { activeSessionKey: resolved.normalizedKey },
  );

  archiveSessionTranscripts({
    sessionId: previousSessionId,
    storePath,
    sessionFile: previousSessionFile,
    agentId: targetAgentId,
    reason: "reset",
  });

  const rebrief = params.rebrief?.trim();
  if (rebrief) {
    const appended = await appendUserMessageToSessionTranscript({
      agentId: targetAgentId,
      sessionKey: resolved.normalizedKey,
      text: rebrief,
      storePath,
    });
    if (!appended.ok) {
      return {
        ok: false,
        code: "rebrief_injection_failed",
        message: appended.reason,
        targetSessionKey: resolved.normalizedKey,
        targetAgentId,
      };
    }
  }

  return {
    ok: true,
    targetSessionKey: resolved.normalizedKey,
    previousSessionId,
    newSessionId,
    targetAgentId,
    rebriefDisposition: rebrief ? "injected" : "none",
    ...(rebrief ? { rebrief } : {}),
  };
}
