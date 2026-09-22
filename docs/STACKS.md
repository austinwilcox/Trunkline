# Trunkline — Stack Support (design proposal)

Status: **proposal / exploration**. Target: v1.5–v2. Reference:
[git-spice](https://abhinav.github.io/git-spice/).

This explores adding _stacked branches_ to trunkline — the ability to build a
chain of dependent branches (each based on the one below it, all rooted at the
trunk), navigate between them, and keep them rebased ("restacked") as lower
branches change.

---

## 1. Why this fits trunkline

git-spice is **checkout-centric**: `gs up`/`gs down` check out a different
branch _in the same working directory_. Trunkline is **worktree-centric**: every
branch already has its own directory.

That's a natural synergy, not a conflict:

- A **stack** becomes a set of worktrees whose branches have a parent/child
  relationship.
- **Navigation** (`tl up`/`tl down`/`tl top`/`tl bottom`) becomes _switching
  worktrees_ — which trunkline already does via `tl switch` + the shell `cd`
  wrapper. No checkout churn; each branch keeps its own dirty state, dev server,
  and hook logs.
- **Restack** (rebase upstack branches after a lower one changes) is the one
  genuinely new capability; it operates across worktrees.

The cost: trunkline must persist the branch-graph (who is based on whom), which
git also doesn't track natively. git-spice keeps this in an internal data store;
we'll do the same.

---

## 2. Core concepts (borrowed from git-spice)

| Term                | Meaning                                                                                |
| ------------------- | -------------------------------------------------------------------------------------- |
| **Trunk**           | The main branch (already detected by trunkline). Root of all stacks.                   |
| **Base**            | The parent branch a given branch is stacked on.                                        |
| **Stack**           | A branch plus everything transitively based on it, down to trunk and up to the leaves. |
| **Upstack**         | Branches _above_ the current one (its descendants).                                    |
| **Downstack**       | Branches _below_ the current one, toward trunk (its ancestors).                        |
| **Track / untrack** | Add / remove a branch from the graph without touching git.                             |
| **Restack**         | Rebase a branch onto its (possibly updated) base to keep history linear.               |

The graph is a **tree** rooted at trunk: each tracked branch has exactly one
base; a branch may have multiple children.

---

## 3. State model

A new per-repo state store records the parent of each tracked branch. It must be
shared across worktrees and not committed, so it lives under the git common dir:

```
<gitCommonDir>/tl/stack.json
```

```jsonc
{
  "version": 1,
  "branches": {
    "feat-api": { "base": "main" },
    "feat-ui": { "base": "feat-api" },
    "feat-tests": { "base": "feat-api" }
  }
}
```

- Trunk itself is implicit (never stored; it's the root).
- `base` is always another tracked branch or the trunk.
- Deriving upstack/downstack is a tree traversal over `branches`.
- Store is small, human-readable, and easy to repair by hand.

Why here and not `.config/tl.toml`? The stack is _local, per-machine work state_
(like git's own branch refs), not shared project config. It sits beside the hook
logs under `<gitCommonDir>/tl/`, consistent with §4.0 of the main design.

New module: `src/stack/store.ts` (load/save/validate), `src/stack/graph.ts`
(traversal: base, children, upstack, downstack, ordering).

---

## 4. Commands

Grouped to mirror git-spice, but worktree-aware. Names use trunkline's existing
verb style.

### Building the stack

```
tl switch -c feat-ui --stack        # create feat-ui based on the CURRENT branch,
                                     # track it, and make a worktree (as today)
tl stack track [--base <branch>]    # track the current branch (guess base, or set it)
tl stack untrack [branch]           # forget a branch (keep the git branch + worktree)
```

`--stack` on `switch -c` is the ergonomic path: "make a new branch on top of
where I am." Without it, `switch -c` behaves exactly as it does today (based on
trunk or `--base`, untracked).

### Navigating (switches worktrees)

```
tl up [n]        # switch to the worktree of an upstack branch (prompt if branching)
tl down [n]      # switch toward trunk
tl top           # topmost branch in this stack
tl bottom        # bottommost non-trunk branch
tl trunk         # switch to the trunk worktree
```

Each of these resolves a target branch from the graph, then reuses the existing
`runSwitch` (creating the worktree on demand if it doesn't exist yet, and using
the `cd` wrapper to move the shell).

### Viewing

```
tl stack         # show the current stack as a tree, marking @ current / ^ trunk,
                 # with the same status columns as `tl list` (dirty, ahead/behind)
tl log           # alias-ish: linear downstack view for the current branch
```

`tl list` gains an optional `--stack` grouping that indents by depth.

### Restacking (the real work)

```
tl restack               # rebase the current branch onto its base
tl restack --upstack     # current branch + everything above it
tl restack --downstack   # current branch + everything below it
tl restack --stack       # the whole stack
```

Algorithm for a single branch B with base P:

1. In B's worktree, `git rebase --onto P <old-base-sha> B`. (We track the base's
   tip we last rebased onto, or compute the merge-base.)
2. On conflict, pause and print `tl restack --continue` / `--abort` (wrapping
   `git rebase --continue/--abort`), like git-spice's `gs rebase`. Restacking a
   set processes branches **bottom-up** (base before dependents) so each rebases
   onto an already-updated parent.

### Reparenting / cleanup

```
tl stack onto <new-base>     # move current branch (and its upstack) onto a new base
tl remove <branch>           # (existing) — must retarget children onto the removed
                             #   branch's base in the stack store
```

Deferred to later: `tl stack split`, `tl stack insert`, submitting stacks as
chained PRs (that's the CR/forge integration, a bigger piece).

---

## 5. Interaction with existing features

- **`tl remove`** must update the stack store: children of the removed branch
  are retargeted onto its base (git-spice's default), optionally `--restack` to
  rebase them immediately. This is the one change to an existing command.
- **Hooks**: restack can fire a new pair — `pre-restack` / `post-restack` — per
  branch, reusing the hook engine. Optional for a first cut.
- **Status (`tl list`/`tl stack`)**: add a "base" column and compute
  ahead/behind against the _base_ (not just trunk) so you can see each layer's
  own delta.
- **Worktree creation on navigation**: `tl up` to a branch with no worktree yet
  should create it (respecting the path template + create hooks), so a stack can
  be materialized lazily.

---

## 6. Suggested build order

1. **State store + graph** (`stack/store.ts`, `stack/graph.ts`) with tests —
   pure logic, no git. Traversals: base, children, upstack, downstack, topo
   order.
2. **Track/untrack** (`tl stack track|untrack`) + `--stack` on `switch -c`.
3. **Read-only views**: `tl stack` tree renderer; `tl list --stack`.
4. **Navigation**: `tl up|down|top|bottom|trunk` on top of `runSwitch`.
5. **Restack** single-branch, then set variants, then `--continue/--abort`.
6. **Reparent + remove integration** (`tl stack onto`, retarget on `tl remove`).

Steps 1–4 deliver most of the day-to-day value (build a stack, see it, move
around it) with low risk. Step 5 (restack) is where the careful git work is.

---

## 7. Open questions

- **Multi-worktree rebase safety.** Restacking B rebases the branch checked out
  in B's worktree. If that worktree is dirty, we must refuse (or stash) — same
  guard as `tl remove`. Worth deciding: refuse vs. auto-stash.
- **Lazy vs. eager worktrees.** Does tracking a branch require a worktree, or
  can the graph include branches with no worktree yet (materialized on
  navigate)? Proposal: allow graph-only branches; create the worktree on first
  `tl up` to it.
- **Detecting an existing stack.** git-spice has `downstack track` to adopt a
  hand-made chain. A `tl stack track --recursive` could walk merge-bases to
  adopt an existing set of branches.
- **Conflict UX across worktrees.** A paused rebase lives in one worktree; the
  `--continue` must run there. We either cd the user there or run it in that
  worktree's path.
- **Trunk updates.** After `main` moves, `tl restack --stack` from the bottom
  rebases the whole chain forward. Should `tl switch` to trunk + pull offer to
  restack dependents?

---

## 8. What I'd build first (recommendation)

A thin, safe vertical slice:

1. `stack/store.ts` + `stack/graph.ts` (+ tests).
2. `tl stack track` / `tl stack untrack`.
3. `tl switch -c --stack` (create-on-current + track).
4. `tl stack` (tree view) and `tl up`/`tl down`/`tl trunk`.

That gives a usable stack workflow — create, track, visualize, navigate — before
taking on the trickier restack/rebase machinery. Restack (§4) lands next as its
own focused step with `--continue/--abort` conflict handling.
