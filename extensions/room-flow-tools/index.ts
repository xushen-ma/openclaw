import { Type } from "@sinclair/typebox";
import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { jsonResult, readStringParam } from "openclaw/plugin-sdk";
import type { TargetedResetResult } from "../../src/agents/targeted-reset.js";
import type { SessionListRow } from "../../src/agents/tools/sessions-helpers.js";

type SessionsListTool = {
  execute: (toolCallId: string, args: Record<string, unknown>) => Promise<{ details?: unknown }>;
};

type SessionStatusTool = {
  execute: (toolCallId: string, args: Record<string, unknown>) => Promise<{ details?: unknown }>;
};

type PerformTargetedReset = (params: {
  cfg: unknown;
  requesterSessionKey: string;
  targetSessionKey: string;
  requesterAuthorized: boolean;
  rebrief?: string;
}) => Promise<TargetedResetResult>;

type ActiveSessionContext = {
  agentId: string;
  contextPct: number | null;
  tokensUsed: number | null;
  tokensMax: number | null;
  model: string | null;
  sessionKey: string;
};

type SessionStatusDetails = {
  ok?: boolean;
  sessionKey?: string;
  statusText?: string;
};

const GetAgentContextSchema = Type.Object(
  {
    agentId: Type.String({ description: "Agent id to inspect, for example main, ben, or coco." }),
  },
  { additionalProperties: false },
);

const ResetAgentSchema = Type.Object(
  {
    agentId: Type.String({ description: "Agent id to reset, for example ben or kiki." }),
    rebrief: Type.Optional(
      Type.String({
        description: "Optional handover text to inject as the first message in the new session.",
      }),
    ),
  },
  { additionalProperties: false },
);

async function loadRuntimeHelpers(): Promise<{
  createSessionsListTool: (opts?: { agentSessionKey?: string }) => SessionsListTool;
  createSessionStatusTool: (opts?: {
    agentSessionKey?: string;
    config?: unknown;
  }) => SessionStatusTool;
  performTargetedReset: PerformTargetedReset;
}> {
  try {
    const sessionsListModule = await import("../../src/agents/tools/sessions-list-tool.js");
    const sessionStatusModule = await import("../../src/agents/tools/session-status-tool.js");
    const targetedResetModule = await import("../../src/agents/targeted-reset.js");
    return {
      createSessionsListTool: sessionsListModule.createSessionsListTool,
      createSessionStatusTool: sessionStatusModule.createSessionStatusTool,
      performTargetedReset: targetedResetModule.performTargetedReset,
    };
  } catch {
    const sessionsListModule = await import("../../dist/agents/tools/sessions-list-tool.js");
    const sessionStatusModule = await import("../../dist/agents/tools/session-status-tool.js");
    const targetedResetModule = await import("../../dist/agents/targeted-reset.js");
    return {
      createSessionsListTool: sessionsListModule.createSessionsListTool,
      createSessionStatusTool: sessionStatusModule.createSessionStatusTool,
      performTargetedReset: targetedResetModule.performTargetedReset,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toSessionRows(details: unknown): SessionListRow[] {
  if (!isRecord(details) || !Array.isArray(details.sessions)) {
    return [];
  }
  return details.sessions.filter(
    (row): row is SessionListRow => isRecord(row) && typeof row.key === "string",
  );
}

function pickBestSessionForAgent(rows: SessionListRow[], agentId: string): SessionListRow | null {
  const prefix = `agent:${agentId}:`;
  const candidates = rows.filter(
    (row) => row.key === prefix + "main" || row.key.startsWith(prefix),
  );
  if (candidates.length === 0) {
    return null;
  }
  return (
    candidates.sort((a, b) => {
      const aMain = a.key === `${prefix}main` ? 1 : 0;
      const bMain = b.key === `${prefix}main` ? 1 : 0;
      if (aMain !== bMain) return bMain - aMain;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    })[0] ?? null
  );
}

function resolveResetTargetSession(
  rows: SessionListRow[],
  agentId: string,
):
  | { kind: "ok"; row: SessionListRow }
  | { kind: "no-active-session" }
  | { kind: "ambiguous-target"; matches: string[] } {
  const prefix = `agent:${agentId}:`;
  const matches = rows.filter((row) => row.key === `${prefix}main` || row.key.startsWith(prefix));
  if (matches.length === 0) {
    return { kind: "no-active-session" };
  }
  const exactMain = matches.find((row) => row.key === `${prefix}main`);
  if (exactMain) {
    return { kind: "ok", row: exactMain };
  }
  if (matches.length > 1) {
    return { kind: "ambiguous-target", matches: matches.map((row) => row.key) };
  }
  return { kind: "ok", row: matches[0] as SessionListRow };
}

export function mapSessionRowToContext(params: {
  agentId: string;
  row: SessionListRow;
}): ActiveSessionContext {
  const tokensUsed = normalizeNumber(params.row.contextTokens);
  const tokensMax = normalizeNumber(params.row.totalTokens);
  const contextPct =
    tokensUsed !== null && tokensMax !== null && tokensMax > 0
      ? Number(((tokensUsed / tokensMax) * 100).toFixed(1))
      : null;

  return {
    agentId: params.agentId,
    contextPct,
    tokensUsed,
    tokensMax,
    model: normalizeString(params.row.model),
    sessionKey: params.row.key,
  };
}

function maybeAttachStatusText<T extends Record<string, unknown>>(
  payload: T,
  statusDetails: unknown,
): T & { statusText?: string } {
  if (!isRecord(statusDetails)) {
    return payload;
  }
  const statusText = normalizeString((statusDetails as SessionStatusDetails).statusText);
  return statusText ? { ...payload, statusText } : payload;
}

function createGetAgentContextTool(api: OpenClawPluginApi, sessionKey?: string): AnyAgentTool {
  return {
    name: "get_agent_context",
    label: "Get Agent Context",
    description:
      "Resolve the active session for a named agent and return current context usage for room-project-flow fatigue checks.",
    parameters: GetAgentContextSchema,
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as Record<string, unknown>;
      const agentId = readStringParam(params, "agentId", { required: true });
      const { createSessionsListTool, createSessionStatusTool } = await loadRuntimeHelpers();
      const sessionsListTool = createSessionsListTool({ agentSessionKey: sessionKey });
      const listResult = await sessionsListTool.execute(`room-flow-list-${Date.now()}`, {
        kinds: ["main", "group", "other", "cron", "hook", "node"],
        limit: 200,
      });
      const rows = toSessionRows(listResult?.details);
      const selected = pickBestSessionForAgent(rows, agentId);
      if (!selected) {
        return jsonResult({
          agentId,
          status: "no-active-session",
        });
      }

      const statusTool = createSessionStatusTool({
        agentSessionKey: sessionKey,
        config: api.config,
      });
      const statusResult = await statusTool.execute(`room-flow-status-${Date.now()}`, {
        sessionKey: selected.key,
      });

      const payload = mapSessionRowToContext({ agentId, row: selected });
      return jsonResult(maybeAttachStatusText(payload, statusResult?.details));
    },
  };
}

function createResetAgentTool(api: OpenClawPluginApi, sessionKey?: string): AnyAgentTool {
  return {
    name: "reset_agent",
    label: "Reset Agent",
    description:
      "Reset a named agent session from room-project-flow and optionally inject a re-brief into the new target session.",
    parameters: ResetAgentSchema,
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as Record<string, unknown>;
      const agentId = readStringParam(params, "agentId", { required: true });
      const rebrief = readStringParam(params, "rebrief", { required: false }) ?? undefined;
      const { createSessionsListTool, performTargetedReset } = await loadRuntimeHelpers();
      const sessionsListTool = createSessionsListTool({ agentSessionKey: sessionKey });
      const listResult = await sessionsListTool.execute(`room-flow-reset-list-${Date.now()}`, {
        kinds: ["main", "group", "other", "cron", "hook", "node"],
        limit: 200,
      });
      const rows = toSessionRows(listResult?.details);
      const target = resolveResetTargetSession(rows, agentId);
      if (target.kind === "no-active-session") {
        return jsonResult({ agentId, status: "no-active-session" });
      }
      if (target.kind === "ambiguous-target") {
        return jsonResult({ agentId, status: "ambiguous-target", matches: target.matches });
      }
      const result = await performTargetedReset({
        cfg: api.config,
        requesterSessionKey: sessionKey ?? "",
        targetSessionKey: target.row.key,
        requesterAuthorized: true,
        rebrief,
      });
      if (!result.ok) {
        return jsonResult({
          agentId,
          status: result.code,
          message: result.message,
          targetSessionKey: result.targetSessionKey,
        });
      }
      return jsonResult({
        agentId,
        status: "reset",
        targetSessionKey: result.targetSessionKey,
        previousSessionId: result.previousSessionId,
        newSessionId: result.newSessionId,
        targetAgentId: result.targetAgentId,
        rebriefDisposition: result.rebriefDisposition,
      });
    },
  };
}

export default function register(api: OpenClawPluginApi) {
  api.registerTool((ctx) => createGetAgentContextTool(api, ctx.sessionKey));
  api.registerTool((ctx) => createResetAgentTool(api, ctx.sessionKey));
}
