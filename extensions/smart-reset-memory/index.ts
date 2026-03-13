import { randomUUID } from "node:crypto";
import {
  INTERNAL_MESSAGE_CHANNEL,
  createReplyDispatcher,
  dispatchInboundMessage,
  resolveSmartResetReviewConfig,
  type MsgContext,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/smart-reset-memory";

function buildReviewContext(params: {
  reviewPrompt: string;
  sessionKey: string;
  runId: string;
}): MsgContext {
  const ownerId = params.sessionKey.split(":").pop() ?? "system";

  return {
    Body: params.reviewPrompt,
    BodyForAgent: params.reviewPrompt,
    BodyForCommands: params.reviewPrompt,
    RawBody: params.reviewPrompt,
    CommandBody: params.reviewPrompt,
    SessionKey: params.sessionKey,
    Provider: INTERNAL_MESSAGE_CHANNEL,
    Surface: INTERNAL_MESSAGE_CHANNEL,
    OriginatingChannel: INTERNAL_MESSAGE_CHANNEL,
    ChatType: "direct",
    CommandAuthorized: true,
    MessageSid: params.runId,
    SenderId: ownerId,
    SenderName: "Session Owner",
    SenderUsername: ownerId,
  };
}

async function runFinalReviewTurn(params: {
  api: OpenClawPluginApi;
  reviewPrompt: string;
  sessionKey: string;
}): Promise<void> {
  const runId = `smart-reset-review-${randomUUID()}`;
  const ctx = buildReviewContext({
    reviewPrompt: params.reviewPrompt,
    sessionKey: params.sessionKey,
    runId,
  });

  const dispatcher = createReplyDispatcher({
    deliver: async () => {
      // Intentionally no-op: this review turn is for autonomous agent/tool actions,
      // not for sending a user-facing reply before reset.
    },
  });

  await dispatchInboundMessage({
    ctx,
    cfg: params.api.config,
    dispatcher,
    replyOptions: {
      runId,
      typingPolicy: "system_event",
      suppressTyping: true,
      suppressToolErrorWarnings: true,
    },
  });
}

export default function register(api: OpenClawPluginApi) {
  api.on("before_reset", async (event, ctx) => {
    const reviewPrompt = event.reviewPrompt?.trim();
    if (!reviewPrompt) {
      return;
    }
    const sessionKey = ctx.sessionKey?.trim();
    if (!sessionKey) {
      api.logger.warn("smart-reset-memory: missing sessionKey, skipping");
      return;
    }

    const smartReset = resolveSmartResetReviewConfig(api.config);
    const run = async () => {
      try {
        await runFinalReviewTurn({
          api,
          reviewPrompt,
          sessionKey,
        });
      } catch (error) {
        api.logger.warn(`smart-reset-memory: before_reset final turn failed (${String(error)})`);
      }
    };

    if (smartReset.wait) {
      await run();
    } else {
      void run();
    }
  });
}
