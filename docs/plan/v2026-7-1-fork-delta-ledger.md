# OpenClaw v2026.7.1 Fork Delta Ledger

- Date: 2026-07-24
- Integration worktree: `/Users/openclaw/.openclaw/workspace/projects/openclaw-2026-6-10-fork-upgrade/worktrees/openclaw-v2026.7.1-fork-integration`
- Branch: `mini/upgrade-v2026.7.1-fork-integration`
- Upstream target: `upstream/release/2026.7.1` (Nina `2026.7.1-2` source)
- Upstream base SHA: `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`
- Upstream tag anchor: `v2026.7.1` / `2d2ddc43d0dcf71f31283d780f9fe9ff4cc04fe4`
- Historical candidate input: `/Users/openclaw/.openclaw/workspace/projects/openclaw-2026-6-10-fork-upgrade/code/openclaw-candidate`
- Historical candidate SHA: `0b1d2b4c2659da9fbeb187c189766e65f944d7fc`
- Fork `origin/main`: `7623a8ffcbbc68124a369e0d730d76b619d91619`
- Fork `origin/production`: `5308741fe4ed7425c7c483468fc726f6dec25a4b`
- Security review: `/Users/openclaw/.openclaw/workspace/projects/openclaw-2026-6-10-fork-upgrade/reviews/security-migration-review-2026-07-23.md`

## Ancestry

- The integration branch is based on Nina's package source commit `0790d9f593a` on `upstream/release/2026.7.1`, which is a descendant of upstream tag `v2026.7.1` / `2d2ddc43d0d`.
- The fork main line is still the prior 2026.6.10 integration merge: `origin/main` is `7623a8ffcbb`, whose replay branch head is `0b1d2b4c265`.
- The historical candidate is an ancestor of fork `origin/main`.
- Current recorded fork production is `5308741fe4e` (`v2026.4.24-x.4`), not the historical 2026.6.10 candidate.
- `v2026.6.10` is not an ancestor of the candidate branch, but the tree diff `git diff v2026.6.10 0b1d2b4c265 -- <scoped local paths>` isolates the intended local replay surface.
- Nina's `2026.7.1-2` package build-info reports commit `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`, matching `upstream/release/2026.7.1`. The integration branch was retargeted from the plain tag to this exact source commit on 2026-07-24.

## Historical Local Delta Surface

The scoped local replay diff from `v2026.6.10` to `0b1d2b4c265` covers 37 files:

- `extensions/quick-memory-search/**`
- `docs/quick-memory-per-agent-http.md`
- `extensions/zenmux/**`
- `extensions/matrix/src/channel.ts`
- `extensions/matrix/src/matrix/account-config.ts`
- `extensions/matrix/src/matrix/accounts.test.ts`
- `extensions/matrix/src/matrix/monitor/handler.ts`
- `extensions/matrix/src/matrix/monitor/handler.body-for-agent.test.ts`
- `src/agents/{agent-tools.read.ts,agent-tools.ts,apply-patch.ts,system-prompt.ts,workspace.ts,tool-fs-policy.ts,tool-fs-policy.types.ts}`
- `src/agents/*workspace*.test.ts`, `src/agents/system-prompt.test.ts`, `src/agents/tool-fs-policy.test.ts`
- `src/config/types.tools.ts`
- `src/config/zod-schema.agent-runtime.ts`
- `scripts/write-build-info.ts`
- `test/scripts/write-build-info.test.ts`
- `pnpm-lock.yaml`

Do not directory-copy these files onto `v2026.7.1`; upstream has large API, plugin, Matrix, auth, and state changes in the same areas.

## Delta Ledger

| Delta                                                                         | Classification                                      | Replay contract                                                                                                                                                                                                                                                 | Notes                                                                                                                                                                             |
| ----------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quick Memory Search extension (`quick_memory_search`, `quick_session_search`) | Keep, but replay as external/local plugin candidate | Recreate as a 7.1-compatible plugin package, preferably external/pinned rather than bundled into core. Preserve per-agent OV HTTP routing, legacy fallback only if explicitly configured, status method, and stats logging.                                     | Upstream 7.1 has `memory-core`, `active-memory`, and `memory-wiki`, but no `quick-memory-search` plugin. Security review requires plugin BOM, pinning, and access-boundary tests. |
| Per-agent OV HTTP sidecar docs/server                                         | Keep, but treat sidecar as runtime/plugin support   | Port `per-agent-ov-http-common.mjs` and server behavior only if the fleet still uses OpenViking sidecar stores. Keep agent ID normalization and local-only host defaults; remove hardcoded migration-project venv path or make it explicit config.              | Current candidate code embeds `/Users/openclaw/.../openviking-venv/bin/python`; this must not become an implicit production dependency.                                           |
| ZenMux image generation provider                                              | Drop by decision                                    | Do not replay ZenMux into this upgrade.                                                                                                                                                                                                                         | Xushen approved dropping ZenMux on 2026-07-24. Upstream 7.1 has official image providers (`openai`, `google`, `openrouter`, `fal`, `deepinfra`, `comfy`, `vydra`, `minimax`).     |
| Matrix named account inheritance from `accounts.default`                      | Keep                                                | Replay semantically into current `extensions/matrix/src/matrix/account-config.ts`: named accounts should inherit account-scoped default `groups`, `rooms`, `dm.allowFrom`, and `groupAllowFrom`, while explicit account maps still override/clear.              | Upstream 7.1 still only merges base/channel maps plus the selected account. Existing old test can be adapted.                                                                     |
| Matrix room-scoped DM last-route guard                                        | Keep                                                | Replay semantically into current Matrix monitor: update last route only when the inbound DM route is the main session key. Room-scoped DM sessions must not overwrite the main session's last route.                                                            | Upstream 7.1 currently still updates last route for every direct message. Keep the pinned-owner guard for main-session DMs.                                                       |
| Matrix SDK install guard before account startup                               | Keep                                                | Replayed as a startup preflight before Matrix monitor runtime import so missing deps fail with repair guidance instead of import-time failure.                                                                                                                  | Covered by focused Matrix/startup tests under isolated `node@25.9.0`.                                                                                                             |
| Agent `TEAM.md` bootstrap injection/order                                     | Keep                                                | Replay by adding `TEAM.md` as a recognized workspace bootstrap file, allowed for cron/subagent where appropriate, ordered after `TOOLS.md` and before `BOOTSTRAP.md`/`MEMORY.md`.                                                                               | Fleet workspace contract requires `TEAM.md`; upstream 7.1 does not include this local fleet-specific context file.                                                                |
| `tools.fs.extraRoots` for workspace-only tools                                | Keep by updated decision                            | Restore the fork's explicit extra-root support for workspace-only tools. Preserve mode-aware semantics: read-only roots are readable but not writable/editable/patchable; read-write roots allow write/edit/apply_patch.                                        | Xushen corrected the decision on 2026-07-24: Uri and Cici need the Backtrader root available.                                                                                     |
| Governed/fork release build-info version identity                             | Keep, rewrite for 7.1 release model                 | Preserve the goal: runtime `/status` and build-info should prefer exact fork tag `vYYYY.M.D-x.N` at HEAD over package version/stable tag. Reimplement against current `scripts/write-build-info.ts` and current version APIs; do not copy old script wholesale. | Upstream 7.1 still writes package version only. Tests should cover exact fork tags and stable fallback.                                                                           |
| `pnpm-lock.yaml` historical changes                                           | Reject as direct replay                             | Regenerate through `pnpm install --lockfile-only` or normal package workflow after chosen plugins/versions are replayed.                                                                                                                                        | Upstream dependency graph changed heavily between 6.10 and 7.1.                                                                                                                   |
| Historical docs `docs/quick-memory-per-agent-http.md`                         | Keep as migration note, update before landing       | Move/update under the final plugin/runtime docs location. Remove stale "done" wording unless evidence is freshly reproduced on 7.1.                                                                                                                             | Useful as contract, not sufficient as current evidence.                                                                                                                           |

## Replay Order

1. Baseline guard: keep branch rooted at Nina's proven `2026.7.1-2` source commit `0790d9f593a` on `upstream/release/2026.7.1`, verify `git status --short --branch` is clean before each replay cluster.
2. Matrix replay first:
   - named account default inheritance;
   - room-scoped DM last-route guard;
   - SDK install guard only after cold-start evidence says it is still needed.
3. Fleet bootstrap replay:
   - `TEAM.md` loading/filtering/order;
   - prompt snapshot and bootstrap-file tests.
4. Build identity replay:
   - exact HEAD fork-tag preference;
   - tests around stable tag fallback and multiple `-x.N` tags.
5. Plugin replay:
   - create/update Quick Memory as a pinned plugin artifact compatible with 7.1;
   - do not replay ZenMux;
   - regenerate lockfile only through package tooling.
6. Filesystem extra roots:
   - replay the fork patch deliberately;
   - keep default disabled unless explicit `tools.fs.extraRoots` config is present;
   - require focused read-only/read-write security tests.
7. Run the test matrix below locally before any push/test-lane handoff.

## Test Expectations

Minimum local checks before handoff:

- `pnpm test -- extensions/matrix/src/matrix/accounts.test.ts extensions/matrix/src/matrix/monitor/handler.body-for-agent.test.ts`
- `pnpm test -- src/agents/workspace.test.ts src/agents/system-prompt.test.ts test/scripts/write-build-info.test.ts`
- `tools.fs.extraRoots` schema/runtime support is intentionally replayed, covered by focused read-only/read-write tests.
- If Quick Memory is replayed: plugin registration tests, per-agent routing tests, status method test, sidecar common tests, and a two-agent staging smoke for `quick_memory_search` and `quick_session_search`.
- ZenMux is intentionally not replayed.
- Broad package checks after replay clusters: `pnpm build` and the repo's relevant `pnpm test` shard(s), with any resource-limit substitution documented.

Staging/test-lane expectations from security review before production consideration:

- Full state/config/plugin snapshot into a staging-only root before any `doctor --fix`.
- `openclaw doctor --dry-run` then controlled staging `doctor --fix`, with redacted output.
- Redacted pre/post model inventory, auth-profile inventory, plugin BOM, and secrets audit.
- Matrix account/crypto migration snapshot, room smoke, media/voice smoke, and route smoke.
- Interactive, heartbeat, cron, and native Codex child-task model resolution proof with no unintended fallback.
- Governed test-lane sanity 5/5 and released lock.

## Decision Needed

- Nina's `2026.7.1-2` package source mapping is proven locally as `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c` on `upstream/release/2026.7.1`; retain this evidence in the promotion packet and re-check if Nina is upgraded again.
- Confirm whether Quick Memory should be bundled in the fork or external/pinned as a local plugin. Security review favors pinned external/plugin BOM evidence.
- ZenMux is no longer required for this upgrade.
- `tools.fs.extraRoots` is required for this upgrade so Uri and Cici can access the Backtrader root.
- Matrix SDK install guard is implemented and covered by focused tests.

## Explicit Non-Actions

- No production, staging, governed test-lane, `releasectl`, PR, push, or deploy action has been performed by this artifact.
- No old fork history should be merged wholesale.
- No files under `/Users/openclaw/workspace/openclaw-release`, staging, production, test-lane, or release repos should be edited for this phase.
