# OpenClaw v2026.7.1-2 Remaining Delta Decision Packet

- Date: 2026-07-24
- Branch: `mini/upgrade-v2026.7.1-fork-integration`
- Current candidate head at packet update: `05c2e4678c6`
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

## Decisions

| Delta                                    | Classification                            | Recommendation                                                                                                                                                                                                                    | Next artifact and required evidence                                                                                                                                                                              |
| ---------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nina `2026.7.1-2` package source mapping | Proven for current Nina package           | Keep the candidate based on `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`; re-check if Nina upgrades again before promotion.                                                                                                         | Promotion packet must include Nina package `dist/build-info.json` evidence and the `git branch --contains` proof for `upstream/release/2026.7.1`.                                                                |
| Quick Memory Search                      | Needs Xushen/Mini decision                | Keep only if the fleet still needs the fast OpenViking/session shortcut. If kept, implement later as an external/pinned local plugin, not core fork code.                                                                         | Plugin BOM + 7.1 plugin design; tests for plugin registration, `quick_memory_search`, `quick_session_search`, per-agent routing/access boundaries, status, sidecar common behavior, and two-agent staging smoke. |
| ZenMux image provider                    | Needs Xushen/Mini decision                | Drop by default because upstream 7.1 already has multiple official image providers. Keep only if ZenMux gives a required model/feature not covered by current providers. If kept, implement later as an external provider plugin. | Provider comparison note; if kept, provider registration tests, auth-resolution tests with redacted config, supported/unsupported model tests, and one redacted staging `image_generate` smoke.                  |
| `tools.fs.extraRoots`                    | Needs Xushen decision; security-sensitive | Keep disabled by default. Reintroduce only if Xushen confirms exact needed roots and `ro`/`rw` modes per agent. Implement last.                                                                                                   | Per-agent allowed-root table + threat model; tests for policy, workspace paths, apply-patch, symlink/canonicalization, read-only denial, and write denial.                                                       |
| Matrix SDK install guard                 | Implemented safe replay                   | Replayed as a startup preflight before Matrix monitor runtime import so missing deps fail with repair guidance instead of import-time failure.                                                                                    | Commit `05c2e4678c6`; tests: `channel.startup.test.ts`, `matrix/deps.test.ts`, `onboarding.test.ts`, `doctor-contract-api.test.ts`, and full Phase 2 focused suite under isolated `node@25.9.0`.                 |

## Recommended Next Sequence

1. Do not implement any remaining optional delta yet.
2. Ask Xushen for product/security decisions on Quick Memory, ZenMux, and `tools.fs.extraRoots`.
3. After decisions, create separate commits for any approved plugin/security work.
4. Only then push and use governed test-lane/staging.

## Non-Actions

- No push, PR, `releasectl`, governed test lane, staging, or production action has been performed.
- No live gateway config, auth profile, secret, or production state was changed.
