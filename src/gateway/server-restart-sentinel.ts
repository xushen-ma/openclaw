import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { extractToolCallsFromAssistant, extractToolResultId } from "../agents/tool-call-id.js";
import { resolveAnnounceTargetFromKey } from "../agents/tools/sessions-send-helpers.js";
import { normalizeChannelId } from "../channels/plugins/index.js";
import type { CliDeps } from "../cli/deps.js";
import { agentCommandFromIngress } from "../commands/agent.js";
import { resolveMainSessionKeyFromConfig } from "../config/sessions.js";
import { parseSessionThreadInfo } from "../config/sessions/delivery-info.js";
import { deliverOutboundPayloads } from "../infra/outbound/deliver.js";
import { buildOutboundSessionContext } from "../infra/outbound/session-context.js";
import { resolveOutboundTarget } from "../infra/outbound/targets.js";
import {
  consumeRestartSentinel,
  formatRestartSentinelMessage,
  summarizeRestartSentinel,
} from "../infra/restart-sentinel.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import { deliveryContextFromSession, mergeDeliveryContext } from "../utils/delivery-context.js";
import { loadSessionEntry, readSessionMessages } from "./session-utils.js";

const SYNTHETIC_RECOVERY_WAKE_MESSAGE = [
  "System: resume after gateway restart.",
  "The last assistant turn ended with tool calls whose results are still missing from the transcript.",
  "Review the latest tool error in session history and continue naturally for the user.",
  "If no user-visible reply is needed, reply ONLY: NO_REPLY.",
].join("\n");

function isAssistantMessage(
  message: unknown,
): message is Extract<AgentMessage, { role: "assistant" }> {
  if (!message || typeof message !== "object") {
    return false;
  }
  return (message as { role?: unknown }).role === "assistant";
}

function isToolResultMessage(
  message: unknown,
): message is Extract<AgentMessage, { role: "toolResult" }> {
  if (!message || typeof message !== "object") {
    return false;
  }
  return (message as { role?: unknown }).role === "toolResult";
}

function hasInterruptedTailToolCall(messages: unknown[]): boolean {
  let lastAssistantIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isAssistantMessage(messages[i])) {
      lastAssistantIndex = i;
      break;
    }
  }
  if (lastAssistantIndex < 0) {
    return false;
  }

  const lastAssistant = messages[lastAssistantIndex] as Extract<
    AgentMessage,
    { role: "assistant" }
  >;
  const stopReason = (lastAssistant as { stopReason?: unknown }).stopReason;
  if (stopReason === "error" || stopReason === "aborted") {
    return false;
  }

  const toolCallIds = extractToolCallsFromAssistant(lastAssistant)
    .map((entry) => entry.id)
    .filter((toolCallId) => !!toolCallId);
  if (toolCallIds.length === 0) {
    return false;
  }

  const pendingToolCalls = new Set(toolCallIds);
  for (let i = lastAssistantIndex + 1; i < messages.length; i++) {
    const message = messages[i];
    if (!isToolResultMessage(message)) {
      continue;
    }
    const toolCallId = extractToolResultId(message);
    if (toolCallId) {
      pendingToolCalls.delete(toolCallId);
      if (pendingToolCalls.size === 0) {
        return false;
      }
    }
  }
  return pendingToolCalls.size > 0;
}

function hasInterruptedRecoveryTail(
  entry: { sessionId: string; sessionFile?: string } | undefined,
  storePath: string | undefined,
) {
  if (!entry?.sessionId) {
    return false;
  }
  const messages = readSessionMessages(entry.sessionId, storePath, entry.sessionFile);
  return hasInterruptedTailToolCall(messages);
}

export async function scheduleRestartSentinelWake(_params: { deps: CliDeps }) {
  const sentinel = await consumeRestartSentinel();
  if (!sentinel) {
    return;
  }
  const payload = sentinel.payload;
  const sessionKey = payload.sessionKey?.trim();
  const message = formatRestartSentinelMessage(payload);
  const summary = summarizeRestartSentinel(payload);

  if (!sessionKey) {
    const mainSessionKey = resolveMainSessionKeyFromConfig();
    enqueueSystemEvent(message, { sessionKey: mainSessionKey });
    return;
  }

  const { baseSessionKey, threadId: sessionThreadId } = parseSessionThreadInfo(sessionKey);

  const { cfg, storePath, entry } = loadSessionEntry(sessionKey);
  if (hasInterruptedRecoveryTail(entry, storePath)) {
    try {
      await agentCommandFromIngress(
        {
          message: SYNTHETIC_RECOVERY_WAKE_MESSAGE,
          sessionKey,
          sessionId: entry?.sessionId,
          deliver: true,
          senderIsOwner: true,
        },
        undefined,
        _params.deps,
      );
      return;
    } catch {
      // Best-effort auto-resume: if the synthetic recovery turn fails, still
      // deliver the normal restart sentinel instead of dropping the wake-up.
    }
  }
  const parsedTarget = resolveAnnounceTargetFromKey(baseSessionKey ?? sessionKey);

  // Prefer delivery context from sentinel (captured at restart) over session store
  // Handles race condition where store wasn't flushed before restart
  const sentinelContext = payload.deliveryContext;
  let sessionDeliveryContext = deliveryContextFromSession(entry);
  if (!sessionDeliveryContext && baseSessionKey && baseSessionKey !== sessionKey) {
    const { entry: baseEntry } = loadSessionEntry(baseSessionKey);
    sessionDeliveryContext = deliveryContextFromSession(baseEntry);
  }

  const origin = mergeDeliveryContext(
    sentinelContext,
    mergeDeliveryContext(sessionDeliveryContext, parsedTarget ?? undefined),
  );

  const channelRaw = origin?.channel;
  const channel = channelRaw ? normalizeChannelId(channelRaw) : null;
  const to = origin?.to;
  if (!channel || !to) {
    enqueueSystemEvent(message, { sessionKey });
    return;
  }

  const resolved = resolveOutboundTarget({
    channel,
    to,
    cfg,
    accountId: origin?.accountId,
    mode: "implicit",
  });
  if (!resolved.ok) {
    enqueueSystemEvent(message, { sessionKey });
    return;
  }

  const threadId =
    payload.threadId ??
    parsedTarget?.threadId ?? // From resolveAnnounceTargetFromKey (extracts :topic:N)
    sessionThreadId ??
    (origin?.threadId != null ? String(origin.threadId) : undefined);

  // Slack uses replyToId (thread_ts) for threading, not threadId.
  // The reply path does this mapping but deliverOutboundPayloads does not,
  // so we must convert here to ensure post-restart notifications land in
  // the originating Slack thread. See #17716.
  const isSlack = channel === "slack";
  const replyToId = isSlack && threadId != null && threadId !== "" ? String(threadId) : undefined;
  const resolvedThreadId = isSlack ? undefined : threadId;
  const outboundSession = buildOutboundSessionContext({
    cfg,
    sessionKey,
  });

  try {
    await deliverOutboundPayloads({
      cfg,
      channel,
      to: resolved.to,
      accountId: origin?.accountId,
      replyToId,
      threadId: resolvedThreadId,
      payloads: [{ text: message }],
      session: outboundSession,
      bestEffort: true,
    });
  } catch (err) {
    enqueueSystemEvent(`${summary}\n${String(err)}`, { sessionKey });
  }
}

export function shouldWakeFromRestartSentinel() {
  return !process.env.VITEST && process.env.NODE_ENV !== "test";
}
