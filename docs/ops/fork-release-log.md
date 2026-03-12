# Fork Release Log

This log tracks **our fork releases** on top of upstream OpenClaw.

Use it to answer:

- what we shipped
- which upstream version it was based on
- which fork patches were included
- what was validated in staging
- how to roll back safely

## Version Scheme

Fork releases use:

- `v<upstream-base>-x.<increment>`
- Example: `v2026.3.11-x.1`

Notes:

- `<upstream-base>` is the upstream release tag we rebased onto.
- `-x.` marks the release as fork-specific and avoids collisions with upstream tags.
- The increment increases within the same upstream base.

## Release Entry Template

```md
## vYYYY.M.D-x.N

- Date:
- Status: draft | staged | released | rolled back
- Upstream base:
- Fork head SHA:
- Previous fork release:
- Rollback target:

### Included fork changes

- PR #...
- PR #...

### Validation

- Rebase status:
- Build/tests:
- Staging validation:
- Production deploy:

### Notes

- Known issues:
- Follow-ups:
```

---

## v2026.3.11-x.1

- Date: 2026-03-12
- Status: draft
- Upstream base: `v2026.3.11`
- Fork head SHA: `788ae6cae` _(local rebase test branch head; not yet promoted)_
- Previous fork release: `v2026.3.8-x.5`
- Rollback target: `v2026.3.8-x.5`

### Included fork changes

- `feat: add /save command and remove smart-reset feature`
- `feat(workspace): restore TEAM.md bootstrap injection`
- `fix(reset-hooks): restore legacy reset context fields`
- `feat(update): add fork-aware reset mode for managed release workspaces`
- `feat(browser): bundle full playwright runtime dependency (#2) (#13)`
- `fix(plugin-sdk): restore AIRI invokeAgent/invokeAgentStream surface (#14)`
- `feat(releasectl): add governed repo permission normalization and repair command (#17)`
- `feat(commands): make /save prompt configurable (#18)`

### Validation

- Rebase status: local throwaway rebase from current fork production onto `upstream/main` completed cleanly with **no conflicts**.
- Build/tests: not yet run on the rebased branch.
- Staging validation: pending.
- Production deploy: not started.

### Notes

- This entry marks the start of Mini-managed fork release logging.
- This is a planning/draft entry, not evidence of a completed release.
- The release should only be promoted after build/test pass and staging validation through the governed release lane.
- If released, this would become the first fork release on top of upstream `v2026.3.11`.
