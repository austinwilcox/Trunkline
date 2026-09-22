# Trunkline — Design

Trunkline is a CLI for managing Git worktrees, modeled on
[worktrunk](https://github.com/max-sixty/worktrunk). It makes worktrees as easy
to work with as branches: you address everything by branch name, trunkline
computes paths, tracks status relative to the main branch, and runs lifecycle
hooks (install deps, start dev servers, etc.) automatically.

- **Runtime/language:** Deno + TypeScript (single binary via `deno compile`).
- **Binary name:** `tl`.
- **Project config (committed to the repo):** `.config/tl.toml`
- **User config (per machine):** `~/.config/trunkline/config.toml`
- **Approvals (per machine, not committed):**
  `~/.config/trunkline/approvals.toml`
- **Hook logs (transient, not committed):** `.git/tl/logs/`

---

## 1. Goals & Non-Goals

### v1 Goals

1. Create, list, remove, and switch worktrees addressed by branch name.
2. Compute worktree paths from a configurable template.
3. Show each worktree's status relative to the main branch (ahead/behind,
   dirty/clean, remote push state).
4. A hook system with lifecycle events (pre/post create, switch, remove) that
   can run shell commands with templated variables.
5. Shell integration so `tl switch` changes the parent shell's directory.
6. Project-hook approval flow (a project's hooks require explicit approval
   before first execution).

### Non-Goals (deferred to later versions)

- LLM-generated commit messages.
- Interactive TUI picker.
- CI status integration / PR previews.
- Copy-on-write build cache sharing (APFS/btrfs/XFS).
- `merge` workflow (squash/rebase/ff). _(Considered for v1.5 — see §9.)_

---

## 2. Concepts & Vocabulary

| Term               | Meaning                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Repository**     | The Git repo. Has one primary worktree (the original clone).                                                          |
| **Worktree**       | A linked working directory checked out to a branch.                                                                   |
| **Main branch**    | The trunk everything is measured against. Auto-detected (`origin/HEAD`, else `main`/`master`), overridable in config. |
| **Path template**  | A template that maps a branch name to a filesystem path.                                                              |
| **Hook**           | A shell command run at a lifecycle event, with template variables.                                                    |
| **Project config** | `.config/tl.toml` in the repo — shared, requires approval.                                                            |
| **User config**    | `~/.config/trunkline/config.toml` — personal, trusted.                                                                |

---

## 3. Commands (v1)

### `tl switch <branch>` (aliases: `tl sw`, `tl s`)

Switch to a worktree, creating it if needed.

```
tl switch <branch>              # switch to existing worktree
tl switch -c <branch>           # create branch + worktree, then switch
tl switch -c <branch> --base <ref>   # create from a specific base
tl switch -c <branch> -x <cmd> [-- args...]  # create, switch, then run <cmd>
tl switch -                     # switch to previous worktree
```

- Creating triggers `pre-start` (blocking) then `post-start` (background).
- Switching triggers `pre-switch` (blocking, in source) then `post-switch`.
- Emits a directory-change instruction consumed by the shell wrapper (§7).

### `tl list` (alias: `tl ls`)

List all worktrees with status relative to main.

```
tl list
tl list --json          # machine-readable
```

Columns: marker (`@` current, `^` main), branch, dirty (`+` staged / `*`
unstaged / clean), ahead/behind main (`↑N` / `↓N`), remote push (`⇡` unpushed),
short commit, age, subject.

### `tl remove [branch]` (alias: `tl rm`)

Remove a worktree (defaults to current) and optionally its branch.

```
tl remove                # remove current worktree
tl remove <branch>
tl remove <branch> --force        # allow removal with uncommitted changes
tl remove <branch> --keep-branch  # remove worktree, keep branch
```

- Triggers `pre-remove` (blocking, in the target worktree) then `post-remove`
  (background, runs in primary worktree since the target is gone).
- Guards against removing the primary worktree or one with uncommitted changes
  unless `--force`.

### `tl hook <type> [names...]`

Run configured hooks on demand (testing/CI/re-run).

```
tl hook post-start
tl hook pre-remove --dry-run
tl hook post-start --foreground
tl hook <type> user:            # only user hooks
tl hook <type> project:name     # a specific project hook
```

### `tl config ...`

```
tl config shell install [--shell bash|zsh|fish]   # write shell wrapper
tl config approvals list|add|clear                # manage project-hook approvals
tl config show                                    # merged effective config
tl config path                                    # resolved config file paths
```

### `tl init`

Scaffold a `.config/tl.toml` in the current repo with commented examples.

---

## 4. Configuration Format

### 4.0 Where config lives (matching worktrunk)

Trunkline follows worktrunk's split: the config you want to share lives **in the
repository**, while machine-specific trust and transient state stay out of it.

| File           | Location                             | Committed?           | Purpose                                                                                                                                       |
| -------------- | ------------------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Project config | `.config/tl.toml` (repo root)        | **Yes** — checked in | Worktree path template, hooks, main-branch override. Shared with everyone who clones the repo.                                                |
| User config    | `~/.config/trunkline/config.toml`    | No                   | Personal defaults across all repos. Trusted (your own machine).                                                                               |
| Approvals      | `~/.config/trunkline/approvals.toml` | No                   | Per-machine record of which project hooks you've allowed. A trust decision — must not travel with the repo, or approval would be meaningless. |
| Hook logs      | `.git/tl/logs/`                      | No                   | Background hook output. Transient; lives under `.git`, so Git never tracks it.                                                                |

Rationale: putting `.config/tl.toml` in the repo means a teammate who clones the
project gets the worktree layout and setup hooks for free. But **approvals** are
deliberately kept per-machine — the whole point of the approval prompt is that
_you_ vet code before it runs on _your_ machine, so a committed approval would
defeat it. **Logs** are per-worktree, noisy, and machine-local, so they belong
under `.git` rather than in the tree.

### 4.1 Format

TOML. Project (`.config/tl.toml`) and user (`~/.config/trunkline/config.toml`)
share the same schema; project overrides user for scalar settings, hooks from
both sources run (see §5.3).

```toml
# Branch the status columns compare against. Auto-detected if omitted.
main-branch = "main"

# Template mapping a branch name to a worktree path.
# Available: {{ repo }}, {{ repo_path }}, {{ branch }}, filters below.
worktree-path = "{{ repo_path }}/../{{ repo }}.{{ branch | sanitize }}"

# ---- Hooks ----

# String form: a single command.
pre-start = "deno task setup"

# Table form: named commands run concurrently.
[post-start]
server = "deno task dev --port {{ branch | hash_port }}"
deps   = "deno cache main.ts"

# Pipeline form: sequential [[hook]] blocks; keys within a block run together.
[[pre-remove]]
save = "cp .env.local /tmp/{{ branch | sanitize }}.env"
```

### Hook forms (recap)

1. **String** → one command.
2. **Table** → multiple named commands, run concurrently.
3. **`[[hook]]` array** → ordered pipeline; a failing step aborts the rest.

---

## 5. Hook System

### 5.1 Lifecycle events (v1)

| Event      | Blocking `pre-` | Background `post-` |
| ---------- | --------------- | ------------------ |
| **create** | `pre-start`     | `post-start`       |
| **switch** | `pre-switch`    | `post-switch`      |
| **remove** | `pre-remove`    | `post-remove`      |

_(commit/merge events reserved for v1.5.)_

- `pre-*` run synchronously; a non-zero exit aborts the operation. Within a
  step, named commands run concurrently; steps run in order; the JSON context is
  fed on the command's **stdin**.
- `post-*` are truly detached (spawned via `sh -c`, `unref()`-ed) so they
  outlive the short-lived CLI process. Each command redirects its own
  stdout/stderr to a log file at
  `<gitCommonDir>/tl/logs/<timestamp>-<type>-<source>-<name>.log`, and its JSON
  context is written to a sibling `*.ctx.json` file whose path is exported as
  `$TL_HOOK_CONTEXT`. `--foreground` runs a background hook inline instead.
  Caveat (v1): once detached, ordering across `[[post-start]]` steps within a
  source is not guaranteed — put hard dependency chains in a blocking `pre-*`
  hook. Tracked for refinement.

### 5.2 Template variables

Rendered per command at run time. Provided both as `{{ }}` template substitution
**and** as a JSON object — on stdin for blocking `pre-*` hooks, and via the
`$TL_HOOK_CONTEXT` file for detached `post-*` hooks.

| Var                      | Meaning                                   |
| ------------------------ | ----------------------------------------- |
| `branch`                 | Branch the op acts on (unset if detached) |
| `worktree_path`          | Target worktree path                      |
| `worktree_name`          | Target worktree dir name                  |
| `commit`, `short_commit` | HEAD SHA (full/abbrev)                    |
| `upstream`               | Tracking remote branch, if any            |
| `base`                   | Source/base branch (switch/create)        |
| `repo`, `repo_path`      | Repo dir name / absolute root             |
| `default_branch`         | Detected main branch                      |
| `cwd`                    | Directory the command runs in             |
| `hook_type`, `hook_name` | e.g. `post-start`, `server`               |
| `args`                   | Tokens forwarded from CLI after `--`      |
| `vars.<key>`             | Per-branch user state (v1.5)              |

### 5.3 Template filters

`sanitize`, `sanitize_hash`, `hash`, `hash_port` (10000–19999), `dirname`,
`basename`. (`sanitize_db`, `codename(n)` deferred.)

We will **not** depend on a full Jinja2 engine. A small purpose-built renderer
supporting `{{ var }}`, dotted access, `| filter`, and `| filter(arg)` is enough
for v1 and keeps the binary lean.

### 5.4 Security / approval

Project hooks (`.config/tl.toml`) execute code committed to a repo, so they
require approval before first run:

- On first execution, print the exact commands and prompt
  `Allow and remember? [y/N]` (read directly from stdin so it also works with
  piped input; `prompt()` would return null on a non-TTY).
- Approvals stored in `~/.config/trunkline/approvals.toml`, keyed by repo path +
  hook type + name + a **SHA-256** hash of the command _template_ (the text
  committed in `.config/tl.toml`, before rendering).
- Re-approving a changed command replaces the stale entry for that (type, name)
  rather than accumulating.
- If the command text changes, the hash changes → re-approval required.
- Declining drops _all_ project hooks for that operation (user hooks still run)
  and leaves saved approvals untouched.
- `--yes` bypasses prompts (CI). `--no-hooks` skips hooks entirely.
- User hooks are trusted (they're your own machine-level config) and need no
  approval — they never consult the store.

Execution order when both sources define a hook:

- `pre-*`: user commands first, then project (as one pipeline; user failure
  skips project).
- `post-*`: user and project run as independent detached pipelines.

---

## 6. Status Relative to Main

For each worktree, compute and display:

- **Dirty state:** `git status --porcelain` → staged / unstaged / untracked.
- **Ahead/behind main:** `git rev-list --left-right --count <main>...<branch>`.
- **Remote push state:** compare local branch to its upstream (`@{upstream}`) →
  unpushed commits.
- **Commit metadata:** short SHA, committer age, subject line.

The main branch is resolved once per invocation:

1. `main-branch` config value, else
2. `git symbolic-ref refs/remotes/origin/HEAD`, else
3. first of `main`, `master`, `trunk` that exists.

---

## 7. Shell Integration

A compiled binary cannot change its parent shell's working directory, so
`tl switch` cooperates with a shell function installed by
`tl config shell install`.

Mechanism: the binary performs all git work, then writes a directive to a side
channel the wrapper reads — either a well-known temp file (`$TL_CD_FILE`) or a
special stdout protocol line. The wrapper `cd`s there.

```bash
# installed into ~/.bashrc / ~/.zshrc
tl() {
  local out; out="$(command tl --cd-file "${TMPDIR:-/tmp}/tl-cd.$$" "$@")"
  local rc=$?
  printf '%s\n' "$out"
  if [ -f "${TMPDIR:-/tmp}/tl-cd.$$" ]; then
    cd "$(cat "${TMPDIR:-/tmp}/tl-cd.$$")" && rm -f "${TMPDIR:-/tmp}/tl-cd.$$"
  fi
  return $rc
}
```

Fish and PowerShell get their own generated wrapper. The `--cd-file` flag makes
this testable without a live shell.

---

## 8. Architecture & Project Layout

```
trunkline/
├── deno.json                 # tasks, imports, compile config
├── deno.lock
├── DESIGN.md
├── src/
│   ├── main.ts               # entrypoint: arg parse → dispatch
│   ├── cli/
│   │   ├── parse.ts          # argument parsing (std/cli or cliffy)
│   │   └── commands/
│   │       ├── switch.ts
│   │       ├── list.ts
│   │       ├── remove.ts
│   │       ├── hook.ts
│   │       ├── config.ts
│   │       └── init.ts
│   ├── git/
│   │   ├── exec.ts           # spawn git, capture stdout/stderr/code
│   │   ├── worktree.ts       # add / list / remove worktrees
│   │   ├── status.ts         # dirty + ahead/behind + push state
│   │   └── repo.ts           # repo root, main-branch detection
│   ├── config/
│   │   ├── load.ts           # find + parse project/user TOML, merge
│   │   ├── schema.ts         # types + validation
│   │   └── approvals.ts      # approval store read/write + hashing
│   ├── hooks/
│   │   ├── model.ts          # normalize the 3 hook forms into a pipeline
│   │   ├── run.ts            # blocking vs background execution + logging
│   │   └── template.ts       # {{ var | filter }} renderer + filters
│   ├── shell/
│   │   └── integration.ts    # generate/install wrappers, --cd-file handling
│   └── util/
│       ├── log.ts            # styled terminal output
│       └── paths.ts          # config dirs, log dirs
└── tests/
    ├── git_test.ts
    ├── template_test.ts
    ├── config_test.ts
    ├── hooks_test.ts
    └── integration_test.ts   # end-to-end in a temp git repo
```

### Key dependencies (Deno)

- **TOML:** `@std/toml` (parse) — write via a small serializer or `@std/toml`.
- **CLI parsing:** `@std/cli` for v1 (keep deps minimal); revisit `cliffy` if we
  add a rich TUI later.
- **Testing:** built-in `Deno.test` + `@std/assert` + `@std/testing`.
- **Git:** shell out via `Deno.Command` (no native bindings needed).

### `deno.json` (sketch)

```jsonc
{
  "tasks": {
    "dev": "deno run -A src/main.ts",
    "test": "deno test -A",
    "check": "deno check src/main.ts && deno lint && deno fmt --check",
    "compile": "deno compile -A -o dist/tl src/main.ts"
  },
  "imports": {
    "@std/toml": "jsr:@std/toml@^1",
    "@std/cli": "jsr:@std/cli@^1",
    "@std/assert": "jsr:@std/assert@^1",
    "@std/fmt": "jsr:@std/fmt@^1"
  },
  "fmt": { "lineWidth": 80 },
  "lint": { "rules": { "tags": ["recommended"] } }
}
```

### Permissions

Trunkline needs `--allow-run` (git + hook commands), `--allow-read`,
`--allow-write` (config, logs, cd-file), `--allow-env`. The compiled binary
bakes these in.

---

## 9. Roadmap Beyond v1

- **v1.5:** `tl merge` (squash → rebase → ff-merge → cleanup) with
  `pre-commit`/`post-commit`/`pre-merge`/`post-merge` hooks; per-branch `vars`
  state.
- **v2:** interactive picker, CI status in `list --full`, PR checkout
  (`tl switch pr:123`), CoW cache sharing, LLM commit messages.

---

## 10. Build Order — v1 status

All v1 steps below are **implemented and verified** (57 passing tests;
`deno check`/`lint`/`fmt` clean; `deno task compile` produces `dist/tl`).

1. ✅ **Scaffolding:** `deno.json`, `main.ts`, arg parsing, `git/exec.ts`.
2. ✅ **Repo + status:** `repo.ts`, `status.ts` → `tl list` (`--json`).
3. ✅ **Worktree ops:** `worktree.ts` → `tl switch -c` / `tl remove`.
4. ✅ **Config:** `load.ts`, `schema.ts` → parse/merge project/user TOML.
5. ✅ **Hooks:** `template.ts` → `model.ts` → `run.ts`; wired into switch/remove
   (`pre-*` blocking, `post-*` detached background).
6. ✅ **Approvals:** `approvals.ts` + stdin prompt flow, `--yes` bypass.
7. ✅ **Shell integration:** `shell/integration.ts` + `--cd-file`;
   `tl config shell install` (bash/zsh/fish).
8. ✅ **Polish:** `tl init`, `tl hook`, `tl config` (show/path/approvals),
   `deno task compile` release task.

Each step is independently testable and leaves a working binary.

```
```
