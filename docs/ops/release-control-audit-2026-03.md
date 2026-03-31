---
summary: "Control-plane audit memo for source→controlled→installed governance hardening (2026-03)"
---

# OpenClaw release-control audit memo (2026-03)

## Scope

Control plane only:

- source of truth (`/Users/openclaw/workspace/openclaw/scripts/fleet`)
- controlled repo (`/Users/openclaw/workspace/openclaw-fleet-mgmt`)
- installed bundle (`/usr/local/lib/openclaw-fleet`)

Out of scope: runtime quick-memory service behavior.

## Incident mismatch classes observed

1. `bundle-sync --sync` reported success without proving post-sync convergence.
2. Drift visibility required manual spot-checking instead of one-pass fingerprinted output.
3. Manual `cp/chmod` repair steps leaked into normal operator behavior.

## Invariants (target state)

1. **Source owns content**: all governed script content changes originate in source repo PRs.
2. **Controlled sync is explicit**: `bundle-sync --sync` fast-forwards controlled repo before installed reconciliation.
3. **Installed sync is verifiable**: all tracked governed files show `OK` with matching SHA-256.
4. **Fail closed**: any residual diff/missing state after sync exits non-zero.
5. **Break-glass is explicit**: manual file-copy/chmod is incident-only and must be reconciled back through governed flow.

## Ownership boundaries

- Source changes: engineering via PR to `openclaw`.
- Controlled repo branch sync: governed `oc-release` lane.
- Installed bundle writes: governed `releasectl bundle-sync --sync` only.

## Operator check (single pass)

```bash
releasectl bundle-sync --check
```

Expected clean signals:

- `controlled_repo=ok ...`
- per-file `OK ... sha=<hash>`
- `SUMMARY ok=<n> diff=0 missing=0`

Any `DIFF`/`MISSING`/`SOURCE-MISSING` is drift and blocks release completion.
