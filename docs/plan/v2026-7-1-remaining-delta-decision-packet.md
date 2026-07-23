# OpenClaw v2026.7.1-2 Remaining Delta Decision Packet

- Date: 2026-07-24
- Branch: `mini/upgrade-v2026.7.1-fork-integration`
- Current candidate head at packet update: `e934de63792`
- Base: `upstream/release/2026.7.1` / `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`
- Tag anchor: `v2026.7.1` / `2d2ddc43d0dcf71f31283d780f9fe9ff4cc04fe4`

## Current Safe-Replay State

- Retargeted from the plain `v2026.7.1` tag to Nina's proven `2026.7.1-2` source commit.
- Safe fork deltas are replayed:
  - Matrix named-account allowlist/room-map inheritance from `accounts.default`;
  - Matrix main-DM last-route guard;
  - `TEAM.md` workspace bootstrap recognition/order;
  - exact fork tag build-info preference;
  - Matrix SDK dependency guard before startup monitor import.
- Focused proof under isolated `node@25.9.0` passes: 5 Vitest shards, 13 files, 385 tests.
- Quick Memory approved local-plugin replay is implemented and hermetically validated after
  the tool-plugin authoring metadata fix.

## Decisions

| Delta                                    | Classification                  | Recommendation                                                                                                                                 | Next artifact and required evidence                                                                                                                                                                                             |
| ---------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nina `2026.7.1-2` package source mapping | Proven for current Nina package | Keep the candidate based on `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`; re-check if Nina upgrades again before promotion.                      | Promotion packet must include Nina package `dist/build-info.json` evidence and the `git branch --contains` proof for `upstream/release/2026.7.1`.                                                                               |
| Quick Memory Search                      | Approved: keep as plugin        | Keep the fleet fast OpenViking/session shortcut as an external/pinned local plugin, not core fork code.                                        | Plugin BOM + 7.1 plugin implementation/design; tests for plugin registration, `quick_memory_search`, `quick_session_search`, per-agent routing/access boundaries, status, sidecar common behavior, and two-agent staging smoke. |
| ZenMux image provider                    | Approved: drop                  | Do not replay ZenMux into this upgrade. Rely on upstream 7.1 official image providers unless a future explicit requirement appears.            | No code artifact. Ensure old ZenMux bundled files/dependencies are absent from the candidate and no model/image route depends on `zenmux`.                                                                                      |
| `tools.fs.extraRoots`                    | Approved: keep disabled         | Do not replay `tools.fs.extraRoots`. Keep the narrower 7.1 filesystem boundary.                                                                | No code artifact. Confirm candidate has no `extraRoots` schema/runtime expansion and staging config does not rely on it.                                                                                                        |
| Matrix SDK install guard                 | Implemented safe replay         | Replayed as a startup preflight before Matrix monitor runtime import so missing deps fail with repair guidance instead of import-time failure. | Commit `05c2e4678c6`; tests: `channel.startup.test.ts`, `matrix/deps.test.ts`, `onboarding.test.ts`, `doctor-contract-api.test.ts`, and full Phase 2 focused suite under isolated `node@25.9.0`.                                |

## Recommended Next Sequence

1. Verify ZenMux and `tools.fs.extraRoots` are absent from the candidate.
2. Take/record a live-state snapshot immediately before any governed test lane or staging run.
3. Use governed test-lane/staging only after route-matrix health checks pass.
4. Keep production blocked pending explicit Mini/Xushen approval.

## Non-Actions

- No push, PR, `releasectl`, governed test lane, staging, or production action has been performed.
- No live gateway config, auth profile, secret, plugin install, staging state, or production deploy was intentionally changed.

## Live-State Validation Incident

During Quick Memory plugin validation, an OpenClaw plugin validation command was
mistakenly run without an isolated `OPENCLAW_HOME`/state root. It failed before
installing the plugin, but it did run migration/update-check startup paths
against the live OpenClaw home.

Observed live-state touch evidence on 2026-07-24:

- `~/.openclaw/state/openclaw.sqlite` and WAL were modified.
- Per-agent `agent/codex-home/{goals_1,logs_2,state_5}.sqlite` files were modified for fleet agents.
- Several session `*.codex-app-server.json.migrated` marker files were created or touched.

Required gate before any push, PR, governed test lane, staging, or production:

- live-state restore is not recommended based on Janko review; treat the
  startup migration/cache/index side effects as accepted forward state unless
  later health checks show damage;
- inspect live gateway health and current route matrix before staging;
- run future plugin validation only with an isolated OpenClaw home/state root.

Follow-up evidence:

- Janko gave conditional go to continue candidate work without restoring live
  state after read-only checks found no gateway config, secret, plugin install,
  staging, or production mutation.
- Isolated Quick Memory plugin validation passed with explicit isolated
  `OPENCLAW_HOME`, `OPENCLAW_STATE_DIR`, `OPENCLAW_CONFIG_PATH`, `HOME`,
  `XDG_CACHE_HOME`, and `TMPDIR`; live `~/.openclaw/state` and
  `~/.openclaw/plugins` fingerprints were unchanged before/after validation.
