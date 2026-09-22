# Trunkline

A CLI for managing Git worktrees, built with Deno + TypeScript. Trunkline makes
worktrees as easy to work with as branches: you address everything by branch
name, it computes paths for you, shows each worktree's status relative to the
main branch, and runs lifecycle hooks (install deps, start dev servers, etc.)
automatically.

Binary name: **`tl`**. Modeled on
[worktrunk](https://github.com/max-sixty/worktrunk).

## Features (v1)

- **Worktrees by branch name** — `tl switch`, `tl list`, `tl remove`; paths are
  computed from a configurable template.
- **Status relative to main** — dirty state, ahead/behind the main branch, and
  unpushed-to-remote state, in one table.
- **Lifecycle hooks** — `pre-start`/`post-start` (on create),
  `pre-switch`/`post-switch`, `pre-remove`/`post-remove`. `pre-*` block on
  failure; `post-*` run detached in the background with logs.
- **Approval-gated project hooks** — hooks committed in a repo require a
  one-time `Allow and remember?` before they run on your machine.
- **Shell integration** — `tl config shell install` lets `tl switch` change your
  shell's directory (bash/zsh/fish).

## Requirements

- [Deno](https://deno.com/) 2.x
- Git 2.x

## Install / run

From source:

```bash
# Run directly
deno task dev list

# Compile a standalone binary to dist/tl
deno task compile
./dist/tl --help

# Put it on PATH, then enable shell integration
tl config shell install        # writes a wrapper into your shell rc file
```

## Usage

```bash
tl switch -c feature-auth          # create branch + worktree, switch to it
tl switch -c feature-x --base main # create from a specific base
tl switch -c feat -x claude        # create, switch, then run a command in it
tl list                            # show all worktrees with status vs main
tl list --json                     # machine-readable
tl remove feature-auth             # remove worktree + branch
tl remove --keep-branch            # remove current worktree, keep the branch

tl init                            # scaffold .config/tl.toml
tl hook show                       # show configured hooks
tl hook post-start --dry-run       # preview a hook without running it
tl config show                     # merged effective config
tl config approvals list           # saved project-hook approvals
```

### `tl list` at a glance

```
   Branch        Dirty  vs main  Push  Commit   Age  Message
@  main          ·      =        –     4e8e11d  1s   initial commit
   feature-auth  ?      ↑1       –     4ef8439  1s   add authentication module
```

`@` marks the current worktree, `^` marks main. `↑N`/`↓N` are commits
ahead/behind main; `⇡N` is unpushed commits; dirty glyphs are `+` staged, `*`
unstaged, `?` untracked.

## Configuration

Config lives in the repo at `.config/tl.toml` (committed, shared with your
team). Personal defaults go in `~/.config/trunkline/config.toml`. Per-machine
trust state (approvals) and transient hook logs are never committed.

```toml
# Branch that status columns compare against (auto-detected if omitted).
# main-branch = "main"

# Template mapping a branch name to a worktree path.
worktree-path = "{{ repo_path }}/../{{ repo }}.{{ branch | sanitize }}"

# Blocking hook: runs on create, before post-start / -x.
pre-start = "npm install"

# Background hook: runs on create, detached, logs to .git/tl/logs/.
[post-start]
server = "npm run dev -- --port {{ branch | hash_port }}"
```

Hook templates support `{{ var }}` substitution with filters (`sanitize`,
`hash`, `hash_port`, `dirname`, `basename`). See `DESIGN.md` §5 for the full
variable list and hook semantics.

## Development

```bash
deno task check   # type-check + lint + fmt --check
deno task test    # run the test suite
deno task fmt     # format
deno task compile # build dist/tl
```

## Roadmap

- **v1.5** — `tl merge` (squash → rebase → ff-merge → cleanup) with commit/merge
  hooks; per-branch `vars` state.
- **v2** — interactive picker, CI status in `list --full`, PR checkout
  (`tl switch pr:123`), copy-on-write build-cache sharing, LLM commit messages.

See [`DESIGN.md`](./DESIGN.md) for the full design.

## License

MIT
