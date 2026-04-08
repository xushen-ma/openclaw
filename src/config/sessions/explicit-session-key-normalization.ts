import type { MsgContext } from "../../auto-reply/templating.js";
import { normalizeExplicitDiscordSessionKey } from "../../plugin-sdk/discord-session-key.js";

type ExplicitSessionKeyNormalizer = (sessionKey: string, ctx: MsgContext) => string;
type ExplicitSessionKeyNormalizerEntry = {
  provider: string;
  normalize: ExplicitSessionKeyNormalizer;
  preserveCase?: boolean;
  matches: (params: {
    sessionKey: string;
    provider?: string;
    surface?: string;
    from: string;
  }) => boolean;
};

const EXPLICIT_SESSION_KEY_NORMALIZERS: ExplicitSessionKeyNormalizerEntry[] = [
  {
    provider: "discord",
    normalize: normalizeExplicitDiscordSessionKey,
    preserveCase: false,
    matches: ({ sessionKey, provider, surface, from }) =>
      surface === "discord" ||
      provider === "discord" ||
      from.startsWith("discord:") ||
      sessionKey.startsWith("discord:") ||
      sessionKey.includes(":discord:"),
  },
  {
    provider: "matrix",
    normalize: (sessionKey) => sessionKey.trim(),
    preserveCase: true,
    matches: ({ sessionKey, provider, surface, from }) =>
      surface === "matrix" ||
      provider === "matrix" ||
      from.startsWith("matrix:") ||
      sessionKey.startsWith("matrix:") ||
      sessionKey.includes(":matrix:"),
  },
];

function resolveExplicitSessionKeyNormalizer(
  sessionKey: string,
  ctx: Pick<MsgContext, "From" | "Provider" | "Surface">,
): ExplicitSessionKeyNormalizerEntry | undefined {
  const normalizedProvider = ctx.Provider?.trim().toLowerCase();
  const normalizedSurface = ctx.Surface?.trim().toLowerCase();
  const normalizedFrom = (ctx.From ?? "").trim().toLowerCase();
  return EXPLICIT_SESSION_KEY_NORMALIZERS.find((entry) =>
    entry.matches({
      sessionKey,
      provider: normalizedProvider,
      surface: normalizedSurface,
      from: normalizedFrom,
    }),
  );
}

export function normalizeExplicitSessionKey(sessionKey: string, ctx: MsgContext): string {
  const rawSessionKey = sessionKey.trim();
  const normalizedSessionKey = rawSessionKey.toLowerCase();
  const normalizerEntry = resolveExplicitSessionKeyNormalizer(normalizedSessionKey, ctx);
  if (!normalizerEntry) {
    return normalizedSessionKey;
  }
  const input = normalizerEntry.preserveCase ? rawSessionKey : normalizedSessionKey;
  return normalizerEntry.normalize(input, ctx);
}
