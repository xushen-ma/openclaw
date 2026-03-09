// Narrow plugin-sdk surface for the bundled smart-reset-memory plugin.
// Keep this list additive and scoped to symbols used under extensions/smart-reset-memory.

export { dispatchInboundMessage } from "../auto-reply/dispatch.js";
export { createReplyDispatcher } from "../auto-reply/reply/reply-dispatcher.js";
export { resolveSmartResetReviewConfig } from "../auto-reply/reply/smart-reset.js";
export type { MsgContext } from "../auto-reply/templating.js";
export type { OpenClawPluginApi } from "../plugins/types.js";
export { INTERNAL_MESSAGE_CHANNEL } from "../utils/message-channel.js";
