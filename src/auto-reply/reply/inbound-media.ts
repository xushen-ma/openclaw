import { normalizeOptionalString } from "../../shared/string-coerce.js";

const AUDIO_EXTENSION_RE = /\.(?:aac|aif|aiff|flac|m4a|mp3|oga|ogg|opus|wav|webm)(?:[?#].*)?$/i;

export type InboundMediaContext = {
  StickerMediaIncluded?: unknown;
  Sticker?: unknown;
  MediaPath?: unknown;
  MediaUrl?: unknown;
  MediaType?: unknown;
  MediaPaths?: readonly unknown[];
  MediaUrls?: readonly unknown[];
  MediaTypes?: readonly unknown[];
};

function hasNormalizedStringEntry(values: readonly unknown[] | undefined): boolean {
  return Array.isArray(values) && values.some((value) => normalizeOptionalString(value));
}

export function hasInboundMedia(ctx: InboundMediaContext): boolean {
  return Boolean(
    ctx.StickerMediaIncluded ||
    ctx.Sticker ||
    normalizeOptionalString(ctx.MediaPath) ||
    normalizeOptionalString(ctx.MediaUrl) ||
    hasNormalizedStringEntry(ctx.MediaPaths) ||
    hasNormalizedStringEntry(ctx.MediaUrls) ||
    (Array.isArray(ctx.MediaTypes) && ctx.MediaTypes.length > 0),
  );
}

function hasAudioTypeEntry(values: readonly unknown[] | undefined): boolean {
  return Boolean(
    Array.isArray(values) &&
    values.some((value) => normalizeOptionalString(value)?.toLowerCase().startsWith("audio/")),
  );
}

function hasAudioPathEntry(values: readonly unknown[] | undefined): boolean {
  return Boolean(
    Array.isArray(values) &&
    values.some((value) => {
      const normalized = normalizeOptionalString(value);
      return normalized ? AUDIO_EXTENSION_RE.test(normalized) : false;
    }),
  );
}

export function hasInboundAudioMedia(ctx: InboundMediaContext): boolean {
  const mediaType = normalizeOptionalString(ctx.MediaType);
  const mediaPath = normalizeOptionalString(ctx.MediaPath);
  const mediaUrl = normalizeOptionalString(ctx.MediaUrl);
  return Boolean(
    (mediaType && mediaType.toLowerCase().startsWith("audio/")) ||
    hasAudioTypeEntry(ctx.MediaTypes) ||
    (mediaPath && AUDIO_EXTENSION_RE.test(mediaPath)) ||
    (mediaUrl && AUDIO_EXTENSION_RE.test(mediaUrl)) ||
    hasAudioPathEntry(ctx.MediaPaths) ||
    hasAudioPathEntry(ctx.MediaUrls),
  );
}
