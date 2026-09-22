---
id: stacks
title: Stacked branches
sidebar_position: 6
---

# Stacked branches

Trunkline can manage **stacks** — chains of dependent branches, each based on
the one below it, all rooted at the trunk. This is inspired by
[git-spice](https://abhinav.github.io/git-spice/), adapted to trunkline's
worktree-centric model: a stack is a set of worktrees, and navigating the stack
means switching between them.

## Concepts

| Term | Meaning |
|------|---------|
| **Trunk** | The main branch — the implicit root of every stack |
| **Base** | The parent branch a given branch is stacked on |
| **Upstack** | Branches above the current one (its descendants) |
| **Downstack** | Branches below, toward the trunk (its ancestors) |
| **Track / untrack** | Add / remove a branch from the stack graph |

The stack graph is stored per-repo at `<gitCommonDir>/tl/stack.json`. It is
shared across worktrees and never committed.

## Building a stack

The ergonomic path is `--stack` on `tl switch -c`, which creates a new branch on
top of the branch you're currently on and tracks it:

```bash
# on main
tl switch -c feat-api --stack     # feat-api based on main
# now in the feat-api worktree
tl switch -c feat-ui --stack      # feat-ui based on feat-api
```

You can also track branches you created by hand:

```bash
tl stack track                    # track current branch (base auto-detected)
tl stack track --base feat-api    # set the base explicitly
tl stack untrack feat-tests       # forget a branch (keeps the git branch/worktree)
```

`untrack` retargets any children of the removed branch onto its base, so the
tree stays connected.

## Viewing the stack

```bash
tl stack
```

```
^ main (trunk)
  @ feat-api
      feat-tests
      feat-ui
```

`@` marks the current branch, `^` the trunk. Each branch shows its commits ahead
of its base and dirty status.

## Navigating the stack

Navigation switches you to the target branch's worktree (creating it lazily if
it doesn't exist yet, and moving your shell via
[shell integration](commands/config)):

```bash
tl up          # move to an upstack branch
tl down        # move toward the trunk
tl up 2        # climb two levels
tl top         # topmost branch in the stack
tl bottom      # bottommost non-trunk branch
tl trunk       # the trunk worktree
```

When a branch has more than one child, `tl up` (or `tl top`) can't pick for you
and will list the candidates — switch explicitly with `tl switch <branch>`.

## Roadmap

The current release covers building, tracking, viewing, and navigating stacks.
Planned follow-ups:

- `tl restack [--upstack|--downstack|--stack]` — rebase branches onto updated
  bases, bottom-up, with conflict `--continue` / `--abort`.
- `tl stack onto` — reparent a branch (and its upstack) onto a new base.
- `tl list --stack` — stack-grouped listing.
