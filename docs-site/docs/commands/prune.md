---
id: prune
title: tl prune
sidebar_label: prune
---

# `tl prune`

Clean up worktrees whose work has already landed. `tl prune` removes every
worktree whose branch is **fully merged into main** and whose working tree is
**clean** — the "this branch is done, I don't need it anymore" case.

```bash
tl prune             # preview candidates, then confirm
tl prune --dry-run   # list what would be pruned; remove nothing
tl prune --yes       # skip the confirmation prompt
tl prune --keep-branch   # remove the worktrees but keep the branches
```

## What counts as prunable

A worktree is pruned only when **all** of these hold:

- it is **not** the primary worktree, and its branch is **not** the main branch;
- it has a branch (detached worktrees are skipped);
- its branch has **0 commits ahead of main** (everything it added is already in
  main); and
- its working tree is **clean** (no staged, unstaged, or untracked changes).

Worktrees that are ahead of main or have uncommitted changes are left alone, and
prune reports how many it skipped and why.

## Safety

Because prune deletes worktrees and branches, it **previews the candidates and
asks for confirmation** by default. Use `--dry-run` to inspect without touching
anything, or `--yes` to skip the prompt (e.g. in scripts).

Prune uses git's safe branch delete, so a branch that somehow still has unmerged
commits is kept even if its worktree is removed. If you pruned the worktree you
were standing in, your shell is moved back to the primary worktree (with
[shell integration](config) installed).

## Hooks

Each pruned worktree fires the same `pre-remove` / `post-remove` hooks as
[`tl remove`](remove). Pass `--no-hooks` to skip them.

## See also

- [`tl remove`](remove) — remove a single worktree.
- [`tl list`](list) — see each worktree's status vs main before pruning.
