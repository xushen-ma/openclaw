# Quick Memory Local Plugin for v2026.7.1-2

This note records the approved remaining delta for the fork upgrade: Quick
Memory stays as a pinned local plugin, not as bundled core fork code. ZenMux and
`tools.fs.extraRoots` remain unreplayed.

## Plugin BOM

| Field | Value |
| --- | --- |
| Plugin id | `quick-memory-search` |
| Local source | `local-plugins/quick-memory-search` |
| Package | `@xushen/openclaw-quick-memory-search` |
| Version | `2026.7.1-2-local.0` |
| OpenClaw API floor | `openclaw >=2026.7.1` |
| Runtime entry | `src/index.ts` local source entry |
| Declared tools | `quick_memory_search`, `quick_session_search` |
| Gateway method | `quick-memory-search.status` (`operator.read`) |

## Runtime Shape

The plugin registers two agent tool factories so each tool instance captures
the current OpenClaw `agentId` from the tool context. Memory search tries the
per-agent OpenViking HTTP endpoint first and uses the legacy shared endpoint
only when `legacyOvBaseUrl` is explicitly configured. Session search uses
per-agent OpenViking HTTP first and only runs the local OpenViking Python
fallback when `sessionFallback.enabled`, `sessionFallback.memoryRoot`, and
`sessionFallback.pythonBin` are configured.

The default routing mode is header routing with `x-openclaw-agent-id`, and the
same implementation also supports query and path routing. Agent IDs are
normalized to simple `a-zA-Z0-9._-` values before routing or store-path
construction.

The sidecar support files under `local-plugins/quick-memory-search` keep the
historical per-agent HTTP contract with loopback defaults and no hardcoded
fleet-specific Python path. Operators must pass `OV_PYTHON_BIN` when mock mode
is off.

## Access Boundary

- Per-agent HTTP requests carry only the normalized current agent id.
- Session local fallback maps `<memoryRoot>/<agentId>-sessions`.
- Legacy shared OpenViking routing is disabled unless configured.
- The status method reports configured booleans and routing mode, not endpoint
  values or secret-bearing config.
- Stats logging is best-effort JSONL and must be explicitly configured with
  `statsLogPath`.

## Verification Notes

Focused local tests cover plugin registration/tool schema, per-agent routing,
status output, sidecar common behavior, and explicit session fallback behavior.
Staging still needs a two-agent live smoke against the real OpenViking sidecar
before production consideration.
