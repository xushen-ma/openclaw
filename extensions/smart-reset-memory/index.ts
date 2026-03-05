import fs from "node:fs/promises";
import path from "node:path";
import { resolveOpenClawAgentDir } from "../../src/agents/agent-paths.js";
import { runEmbeddedPiAgent } from "../../src/agents/pi-embedded-runner.js";
import { resolveDefaultModelRef } from "../../src/agents/tools/model-config.helpers.js";
import { resolvePreferredOpenClawTmpDir } from "../../src/infra/tmp-openclaw-dir.js";
import type { OpenClawPluginApi } from "../../src/plugins/types.js";

type HookMessage = {
  role?: unknown;
  content?: unknown;
};

function toText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatMessage(message: unknown, index: number): string {
  const msg = (message ?? {}) as HookMessage;
  const role = typeof msg.role === "string" && msg.role.trim() ? msg.role.trim() : "unknown";
  return `[${index + 1}] ${role}:\n${toText(msg.content)}`;
}

function collectText(payloads: Array<{ text?: string; isError?: boolean }> | undefined): string {
  return (payloads ?? [])
    .filter((entry) => !entry.isError && typeof entry.text === "string" && entry.text.trim())
    .map((entry) => entry.text?.trim() ?? "")
    .join("\n")
    .trim();
}

function localDateString(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localTimeString(now = new Date()): string {
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

async function appendMemoryEntry(params: {
  workspaceDir: string;
  reason?: string;
  review: string;
}): Promise<string> {
  const date = localDateString();
  const memoryDir = path.join(params.workspaceDir, "memory");
  const memoryFile = path.join(memoryDir, `${date}.md`);
  await fs.mkdir(memoryDir, { recursive: true });

  const lines = [
    `## Smart Reset Review (${localTimeString()})`,
    params.reason ? `- Trigger: /${params.reason}` : "- Trigger: smart reset",
    "",
    params.review.trim(),
    "",
  ];

  await fs.appendFile(memoryFile, `${lines.join("\n")}\n`, "utf8");
  return memoryFile;
}

export default function register(api: OpenClawPluginApi) {
  api.on("before_reset", async (event, ctx) => {
    if (!event.reviewPrompt?.trim()) {
      return;
    }
    if (!ctx.workspaceDir?.trim()) {
      api.logger.warn("smart-reset-memory: missing workspaceDir, skipping");
      return;
    }

    try {
      const defaultModel = resolveDefaultModelRef(api.config);
      const transcript = (event.messages ?? [])
        .map((msg, idx) => formatMessage(msg, idx))
        .join("\n\n");
      const prompt = [
        event.reviewPrompt.trim(),
        "",
        "Output requirements:",
        "- Write concise markdown suitable for appending to a daily memory journal.",
        "- Preserve key decisions, TODOs, commitments, preferences, and open questions.",
        "- Avoid fluff. Include concrete details that help future sessions.",
        "",
        "Conversation transcript:",
        transcript || "(no messages captured)",
      ].join("\n");

      const tmpDir = await fs.mkdtemp(
        path.join(resolvePreferredOpenClawTmpDir(), "openclaw-smart-reset-"),
      );
      try {
        const runId = `smart-reset-${Date.now()}`;
        const runResult = await runEmbeddedPiAgent({
          sessionId: runId,
          sessionFile: path.join(tmpDir, "session.json"),
          workspaceDir: ctx.workspaceDir,
          agentDir: resolveOpenClawAgentDir(),
          config: api.config,
          prompt,
          timeoutMs: 60_000,
          runId,
          provider: defaultModel.provider,
          model: defaultModel.model,
          disableTools: true,
        });

        const review = collectText(runResult.payloads);
        if (!review) {
          api.logger.warn("smart-reset-memory: LLM returned empty review, skipping write");
          return;
        }

        const memoryFile = await appendMemoryEntry({
          workspaceDir: ctx.workspaceDir,
          reason: event.reason,
          review,
        });
        api.logger.info(`smart-reset-memory: appended review to ${memoryFile}`);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      }
    } catch (error) {
      api.logger.warn(`smart-reset-memory: before_reset failed (${String(error)})`);
    }
  });
}
