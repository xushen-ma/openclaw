import assert from "node:assert/strict";
import { it } from "vitest";
import {
  normalizeAgentId,
  resolveAgentAndScope,
  resolveStorePath,
  toOpenVikingResult,
} from "./per-agent-ov-http-common.mjs";

it("normalizes per-agent OV HTTP routing helpers", () => {
  assert.equal(normalizeAgentId("ben"), "ben");
  assert.equal(normalizeAgentId("../ben !!"), "ben");
  assert.equal(normalizeAgentId(".."), "main");

  assert.deepEqual(
    resolveAgentAndScope({
      pathname: "/api/v1/search/find",
      query: new URLSearchParams(),
      headers: { "x-openclaw-agent-id": "mini" },
    }),
    { scope: "memory", agentId: "mini" },
  );

  assert.deepEqual(
    resolveAgentAndScope({
      pathname: "/api/v1/search/session-find",
      query: new URLSearchParams("agentId=ben"),
      headers: {},
    }),
    { scope: "sessions", agentId: "ben" },
  );

  assert.deepEqual(
    resolveAgentAndScope({
      pathname: "/agents/pollen/api/v1/search/find",
      query: new URLSearchParams(),
      headers: {},
    }),
    { scope: "memory", agentId: "pollen" },
  );

  assert.equal(
    resolveStorePath({ memoryRoot: "/tmp/ov", agentId: "ben", scope: "memory" }),
    "/tmp/ov/ben",
  );
  assert.equal(
    resolveStorePath({ memoryRoot: "/tmp/ov", agentId: "ben", scope: "sessions" }),
    "/tmp/ov/ben-sessions",
  );

  assert.deepEqual(
    toOpenVikingResult({ total: 2, items: [{ uri: "x", score: 0.5, abstract: "hit" }] }, 1),
    {
      result: {
        total: 2,
        resources: [{ uri: "x", score: 0.5, abstract: "hit" }],
        memories: [],
        skills: [],
        instructions: [],
      },
    },
  );
});
