---
id: intro
slug: /
title: Introduction
sidebar_position: 1
---

# Trunkline

**Trunkline** is a CLI for managing Git worktrees, built with Deno + TypeScript.
It makes worktrees as easy to work with as branches: you address everything by
branch name, it computes paths for you, shows each worktree's status relative to
the main branch, and runs lifecycle hooks (install deps, start dev servers, etc.)
automatically.

The binary is named **`tl`**. Trunkline is modeled on
[worktrunk](https://github.com/max-sixty/worktrunk), with stacked-branch support
inspired by [git-spice](https://abhinav.github.io/git-spice/).

## Why worktrees?

Git worktrees give each branch its own working directory, so you can have
multiple branches checked out at once — no stashing, no context-switching in a
single directory. This is ideal for running several tasks (or AI agents) in
parallel. But the native `git worktree` UX is clunky. Trunkline smooths it over.

## What you get

- **Worktrees by branch name** — [`tl switch`](commands/switch),
  [`tl list`](commands/list), [`tl remove`](commands/remove). Paths are computed
  from a configurable template.
- **Status relative to main** — dirty state, commits ahead/behind the main
  branch, and unpushed-to-remote state, all in one table.
- **Lifecycle hooks** — run commands on create / switch / remove.
  `pre-*` hooks block on failure; `post-*` hooks run detached in the background
  with logs. See [Hooks](hooks).
- **Approval-gated project hooks** — hooks committed in a repo require a
  one-time approval before they run on your machine.
- **Shell integration** — [`tl config shell install`](commands/config) lets
  `tl switch` change your shell's directory (bash/zsh/fish).
- **Stacked branches** — build a chain of dependent branches, navigate between
  them, and keep them tracked. See [Stacks](stacks).

## A quick look

```bash
tl switch -c feature-auth     # create branch + worktree, switch to it
tl list                       # all worktrees with status vs main
tl remove feature-auth        # remove worktree + branch
```

```
   Branch        Dirty  vs main  Push  Commit   Age  Message
@  main          ·      =        –     4e8e11d  1s   initial commit
   feature-auth  ?      ↑1       –     4ef8439  1s   add authentication module
```

`@` marks the current worktree, `^` marks main. `↑N`/`↓N` are commits
ahead/behind main; `⇡N` is unpushed commits; dirty glyphs are `+` staged,
`*` unstaged, `?` untracked.

Ready? Head to [Installation](install).
