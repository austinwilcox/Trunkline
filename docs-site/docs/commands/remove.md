---
id: remove
title: tl remove
sidebar_label: remove
---

# `tl remove`

Remove a worktree (defaults to the current one) and, unless told otherwise, its
branch. Alias: `tl rm`.

```bash
tl remove                    # remove the current worktree + branch
tl remove <branch>           # remove a specific worktree
tl remove <branch> --force   # allow removal with uncommitted changes
tl remove <branch> --keep-branch  # remove worktree, keep the branch
```

## Options

| Flag | Meaning |
|------|---------|
| `--force` | Remove despite uncommitted changes / an unmerged branch |
| `--keep-branch` | Remove the worktree but keep the git branch |
| `--no-hooks` | Skip lifecycle hooks |
| `-y`, `--yes` | Approve project hooks without prompting |

## Safety

- Trunkline **refuses to remove the primary worktree** (the original clone).
- If the target worktree has uncommitted changes, removal is refused unless you
  pass `--force`.
- If you remove the worktree you're currently in, your shell is moved back to
  the primary worktree.

## Lifecycle

1. `pre-remove` hook (blocking, in the worktree being removed) — e.g. back up
   artifacts.
2. The worktree is removed, and the branch deleted (unless `--keep-branch`).
3. `post-remove` hook (background, in the primary worktree) — e.g. stop a dev
   server or tear down a container.

See [Hooks](../hooks).
