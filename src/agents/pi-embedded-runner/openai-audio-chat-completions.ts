import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { StreamFn } from "@mariozechner/pi-agent-core";
import { resolveMediaReferenceLocalPath } from "../../media/media-reference.js";
import { getMediaDir } from "../../media/store.js";
import { normalizeLowercaseStringOrEmpty } from "../../shared/string-coerce.js";

const AUDIO_MODEL_RE = /^(?:gpt-audio(?:-.+)?|gpt-4o-audio-preview(?:-.+)?)$/i;
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".ogg", ".opus", ".webm", ".aac"]);
const OPENAI_DIRECT_AUDIO_EXTENSIONS = new Set([".mp3", ".wav"]);
const MEDIA_ATTACHED_PATTERN = /\[media attached(?:\s+\d+\/\d+)?:\s*([^\]]+)\]/gi;

type AudioAttachment = {
  source: string;
  mime?: string;
};

export function isOpenAIAudioChatModel(model: { provider?: unknown; api?: unknown; id?: unknown }) {
  return (
    model.provider === "openai" &&
    model.api === "openai-completions" &&
    typeof model.id === "string" &&
    AUDIO_MODEL_RE.test(model.id)
  );
}

function parseMediaAttachment(raw: string): AudioAttachment | null {
  const beforeUrl = raw.split("|")[0]?.trim() ?? "";
  const mimeMatch = beforeUrl.match(/^(.*?)\s*\((audio\/[^)]+)\)\s*$/i);
  const source = (mimeMatch?.[1] ?? beforeUrl).trim();
  const mime = mimeMatch?.[2]?.trim();
  if (!source) {
    return null;
  }
  const ext = normalizeLowercaseStringOrEmpty(path.extname(source));
  if (!mime?.toLowerCase().startsWith("audio/") && !AUDIO_EXTENSIONS.has(ext)) {
    return null;
  }
  return { source, mime };
}

function collectAudioAttachments(text: string): AudioAttachment[] {
  const attachments: AudioAttachment[] = [];
  MEDIA_ATTACHED_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(MEDIA_ATTACHED_PATTERN)) {
    const attachment = match[1] ? parseMediaAttachment(match[1]) : null;
    if (attachment) {
      attachments.push(attachment);
    }
  }
  return attachments;
}

function stripAudioAttachmentNotes(text: string): string {
  MEDIA_ATTACHED_PATTERN.lastIndex = 0;
  return text
    .replace(MEDIA_ATTACHED_PATTERN, (full, body: string) =>
      parseMediaAttachment(body) ? "" : full,
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function transcodeToMp3(inputPath: string): Promise<string> {
  const stat = await fs.stat(inputPath);
  const cacheKey = createHash("sha256")
    .update(inputPath)
    .update(String(stat.size))
    .update(String(stat.mtimeMs))
    .digest("hex");
  const cacheDir = path.join(getMediaDir(), "audio-cache");
  const outputPath = path.join(cacheDir, `${cacheKey}.mp3`);
  await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 });
  try {
    await fs.access(outputPath);
    return outputPath;
  } catch {
    // Cache miss.
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-acodec",
      "libmp3lame",
      "-ar",
      "24000",
      "-ac",
      "1",
      outputPath,
    ]);
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg failed to prepare audio for OpenAI (${code}): ${stderr.trim()}`));
    });
  });
  return outputPath;
}

async function readOpenAIInputAudio(attachment: AudioAttachment): Promise<{
  type: "input_audio";
  input_audio: { data: string; format: "mp3" | "wav" };
}> {
  const localPath = await resolveMediaReferenceLocalPath(attachment.source);
  const ext = normalizeLowercaseStringOrEmpty(path.extname(localPath));
  const preparedPath = OPENAI_DIRECT_AUDIO_EXTENSIONS.has(ext)
    ? localPath
    : await transcodeToMp3(localPath);
  const preparedExt = normalizeLowercaseStringOrEmpty(path.extname(preparedPath));
  const format = preparedExt === ".wav" ? "wav" : "mp3";
  const data = await fs.readFile(preparedPath);
  return {
    type: "input_audio",
    input_audio: {
      data: data.toString("base64"),
      format,
    },
  };
}

function mostRecentUserMessageWithAudio(messages: unknown[]): Record<string, unknown> | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message || typeof message !== "object") {
      continue;
    }
    const candidate = message as Record<string, unknown>;
    if (candidate.role !== "user") {
      continue;
    }
    const text =
      typeof candidate.content === "string"
        ? candidate.content
        : Array.isArray(candidate.content)
          ? candidate.content
              .map((part) =>
                part &&
                typeof part === "object" &&
                typeof (part as { text?: unknown }).text === "string"
                  ? (part as { text: string }).text
                  : "",
              )
              .filter(Boolean)
              .join("\n")
          : "";
    if (text && collectAudioAttachments(text).length > 0) {
      return candidate;
    }
  }
  return null;
}

export async function patchOpenAIAudioChatCompletionsPayload(
  payload: Record<string, unknown>,
): Promise<void> {
  const messages = payload.messages;
  if (!Array.isArray(messages)) {
    return;
  }
  const userMessage = mostRecentUserMessageWithAudio(messages);
  if (!userMessage) {
    return;
  }
  const contentText =
    typeof userMessage.content === "string"
      ? userMessage.content
      : Array.isArray(userMessage.content)
        ? userMessage.content
            .map((part) =>
              part &&
              typeof part === "object" &&
              typeof (part as { text?: unknown }).text === "string"
                ? (part as { text: string }).text
                : "",
            )
            .filter(Boolean)
            .join("\n")
        : "";
  const attachments = collectAudioAttachments(contentText);
  if (attachments.length === 0) {
    return;
  }
  const audioParts = await Promise.all(
    attachments.map((attachment) => readOpenAIInputAudio(attachment)),
  );
  const text = stripAudioAttachmentNotes(contentText) || "Please respond to this voice message.";
  userMessage.content = [{ type: "text", text }, ...audioParts];
  if (!Array.isArray(payload.modalities)) {
    payload.modalities = ["text"];
  }
}

export function createOpenAIAudioChatCompletionsWrapper(baseStreamFn: StreamFn): StreamFn {
  return (model, context, options) => {
    if (!isOpenAIAudioChatModel(model)) {
      return baseStreamFn(model, context, options);
    }
    const originalOnPayload = options?.onPayload;
    return baseStreamFn(model, context, {
      ...options,
      onPayload: async (payload) => {
        if (payload && typeof payload === "object") {
          await patchOpenAIAudioChatCompletionsPayload(payload as Record<string, unknown>);
        }
        return await originalOnPayload?.(payload, model);
      },
    });
  };
}
