---
id: stack
title: tl stack
sidebar_label: stack
---

# `tl stack`

Manage and view [stacked branches](../stacks). The stack graph is stored
per-repo at `<gitCommonDir>/tl/stack.json` (shared across worktrees, never
committed).

```bash
tl stack                       # show the current stack as a tree
tl stack track [--base <b>]    # track the current branch (guess base if omitted)
tl stack untrack [branch]      # forget a branch (keeps the git branch/worktree)
```

## `tl stack` (show)

Renders the stack as an indented tree, rooted at the trunk:

```
^ main (trunk)
  @ feat-api
      feat-tests
      feat-ui
```

`@` marks the current branch and `^` the trunk. Each branch shows its commits
ahead of its base and its dirty status. A branch that was tracked onto a base
that isn't itself tracked appears under that base, labeled `(untracked base)`.

## `tl stack track`

Track the current branch so trunkline knows its place in the stack.

| Flag | Meaning |
|------|---------|
| `--base <branch>` | Set the base explicitly |

When `--base` is omitted, the base is auto-detected: among the trunk and all
tracked branches that are ancestors of the current branch, the **nearest** one
(fewest commits away) is chosen.

```bash
tl stack track                 # base auto-detected from ancestry
tl stack track --base feat-api # base set explicitly
```

## `tl stack untrack`

Remove a branch from the stack graph without deleting the git branch or its
worktree. Children of the removed branch are **retargeted onto its base**, so
the tree stays connected.

```bash
tl stack untrack            # untrack the current branch
tl stack untrack feat-tests # untrack a specific branch
```

## See also

- [Stacked branches](../stacks) — the full guide (concepts, building,
  navigating).
- [`tl up` / `down` / `top` / `bottom` / `trunk`](navigate) — move between
  stacked worktrees.
- [`tl switch -c --stack`](switch) — create a branch on top of the current one
  and track it in one step.
