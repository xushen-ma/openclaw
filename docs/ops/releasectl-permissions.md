---
summary: "Repairing governed-repo permission drift after guarded release writes"
---

# releasectl permission repair

Guarded release writes can occasionally leave file mode drift (for example `0600`
files or `0700` directories) that blocks read access for non-writer users.

The governed policy stays the same:

- `oc-release` remains the write authority.
- normal runtime users keep read/execute access only.
- no ad-hoc direct writes in protected repos.

## Command

`releasectl` also runs the same normalization after `deploy`, `staging-deploy`,
and `rollback` flows so guarded writes do not leave permission drift behind.

```bash
scripts/fleet/releasectl repair-perms --repo /Users/openclaw/workspace/openclaw
```

Dry-run preview:

```bash
scripts/fleet/releasectl repair-perms --repo /Users/openclaw/workspace/openclaw --dry-run
```

## What it enforces

- directories: `0755`
- regular files: `0644`
- git-tracked executable files: `0755`

The repair command does **not** modify ownership and does not grant broad write
permissions.
