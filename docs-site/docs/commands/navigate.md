---
id: navigate
title: tl up / down / top / bottom / trunk
sidebar_label: up / down / trunk
---

# Stack navigation

These commands move you between the worktrees of a [stack](../stacks). Each
resolves a target branch from the stack graph relative to your current branch,
then switches to that branch's worktree — creating it lazily if it doesn't exist
yet, and moving your shell via [shell integration](config).

```bash
tl up          # move to an upstack branch (toward the leaves)
tl down        # move downstack (toward the trunk)
tl up 2        # climb two levels at once
tl down 2      # descend two levels
tl top         # topmost branch in the current stack
tl bottom      # bottommost non-trunk branch
tl trunk       # the trunk worktree
```

## How targets are resolved

| Command | Target |
|---------|--------|
| `tl up [n]` | The branch `n` levels above the current one (default 1). From the trunk, moves into a stack. |
| `tl down [n]` | The branch `n` levels toward the trunk. Errors if already at the trunk. |
| `tl top` | The single leaf above the current branch. |
| `tl bottom` | The branch nearest the trunk in the current stack. |
| `tl trunk` | The trunk branch's worktree. |

## Ambiguous forks

A branch can have more than one child. When `tl up` (or `tl top`) can't pick a
single destination, it lists the candidates instead of guessing:

```
✗ Multiple branches above feat-api: feat-tests, feat-ui.
  Switch explicitly with 'tl switch <branch>'.
```

Use [`tl switch <branch>`](switch) to go to a specific one.

## Lazy worktrees

If the target branch is tracked in the stack but doesn't have a worktree yet,
navigation creates it on demand (using the
[`worktree-path`](../configuration) template and the create hooks), so a stack
can be materialized as you move through it.

## See also

- [Stacked branches](../stacks) — the full guide.
- [`tl stack`](stack) — track, untrack, and view the stack.
