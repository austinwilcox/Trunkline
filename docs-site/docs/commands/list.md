---
id: list
title: tl list
sidebar_label: list
---

# `tl list`

List all worktrees with their status relative to the main branch.

```bash
tl list           # human-readable table   (alias: tl ls)
tl list --json    # machine-readable JSON
```

## Output

```
   Branch        Dirty  vs main  Push  Commit   Age  Message
@  main          ·      =        –     4e8e11d  1s   initial commit
   feature-auth  ?      ↑1       –     4ef8439  1s   add authentication module
```

| Column | Meaning |
|--------|---------|
| marker | `@` current worktree, `^` main branch |
| Branch | branch checked out in the worktree |
| Dirty | `+` staged, `*` unstaged, `?` untracked, `·` clean |
| vs main | `↑N` commits ahead of main, `↓N` behind, `=` even |
| Push | `⇡N` commits not yet pushed to the upstream, `–` no upstream |
| Commit | short HEAD SHA |
| Age | relative age of the HEAD commit |
| Message | HEAD commit subject |

## Main-branch detection

The branch that status is compared against is resolved in this order:

1. `main-branch` from [configuration](../configuration), if set.
2. `refs/remotes/origin/HEAD` (the remote's default branch).
3. The first existing branch among `main`, `master`, `trunk`.

## JSON output

`tl list --json` prints an array of worktree records (branch, path, status,
commit metadata) for scripting and integrations.
