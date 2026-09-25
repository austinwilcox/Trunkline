---
id: switch
title: tl switch
sidebar_label: switch
---

# `tl switch`

Switch to a worktree, creating it if requested. Aliases: `tl sw`, `tl s`.

```bash
tl switch <branch>                 # switch to an existing worktree
tl switch <remote-branch>          # fetch a remote-only branch + make a worktree
tl switch -c <branch>              # create branch + worktree, then switch
tl switch -c <branch> --base main  # create from a specific base ref
tl switch -c feat -x claude        # create, switch, then run a command in it
tl switch -c feat --stack          # create on top of the current branch (stacked)
```

## Remote branches

If `<branch>` doesn't exist locally but a matching branch exists on a remote
(e.g. `origin/<branch>`), `tl switch <branch>` **fetches it and creates a
worktree that tracks the remote branch** — no `-c` needed. This is the common
"check out a teammate's branch" case:

```bash
tl switch feature-from-a-colleague   # fetches origin/feature-from-a-colleague
```

`origin` is preferred when multiple remotes have the branch. If the branch
exists neither locally nor on any remote, `tl switch` errors and suggests `-c`.

## Options

| Flag | Meaning |
|------|---------|
| `-c`, `--create` | Create the branch + worktree if it doesn't exist |
| `--base <ref>` | Base ref for the new branch (implies `--create`) |
| `-x`, `--execute <cmd>` | Run `<cmd>` inside the worktree after switching |
| `--stack` | Track the new branch on top of the current one (see [Stacks](../stacks)) |
| `--no-hooks` | Skip lifecycle hooks |
| `-y`, `--yes` | Approve project hooks without prompting |

Arguments after `--` are forwarded to the `-x` command.

## What happens on create

1. `pre-switch` hook (blocking, in the source worktree).
2. The worktree is created at the path from the
   [`worktree-path`](../configuration) template.
3. `pre-start` hook (blocking, in the new worktree) — e.g. install deps.
4. `post-start` hook (background, in the new worktree) — e.g. start a dev server.
5. Your shell is moved into the new worktree (with
   [shell integration](config) installed).
6. `post-switch` hook (background).
7. If `-x` was given, the command runs in the worktree.

See [Hooks](../hooks) for the full lifecycle.

## Directory changing

A compiled binary can't change its parent shell's directory. `tl switch` writes
the destination to a temp file that the installed shell wrapper reads and
`cd`s to. Run [`tl config shell install`](config) once to enable this; without
it, `tl switch` prints the path for you to `cd` manually.
