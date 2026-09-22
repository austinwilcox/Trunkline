---
id: hooks
title: Hooks
sidebar_position: 5
---

# Hooks

Hooks are shell commands that run at key points in the worktree lifecycle —
automatically during `tl switch` and `tl remove`, or on demand via
[`tl hook`](commands/hook).

## Hook types

| Event | Blocking `pre-` | Background `post-` |
|-------|-----------------|--------------------|
| **switch** | `pre-switch` | `post-switch` |
| **create** | `pre-start` | `post-start` |
| **remove** | `pre-remove` | `post-remove` |

- **`pre-*` hooks block.** They run in the foreground; a non-zero exit aborts
  the operation. The JSON context is provided on the command's stdin.
- **`post-*` hooks run detached** in the background and outlive the CLI process.
  Their output is logged to `<gitCommonDir>/tl/logs/`, and the JSON context is
  written to a sidecar file whose path is exported as `$TL_HOOK_CONTEXT`.

The most common creation hook is `post-start` — use it for dev servers, long
builds, or copying files, without blocking worktree creation.

## Hook forms

A hook takes one of three shapes, determined by its TOML type.

**String** — a single command:

```toml
pre-start = "npm install"
```

**Table** — multiple named commands that run concurrently:

```toml
[post-start]
server = "npm run dev"
watch  = "npm run watch"
```

**Pipeline** — an array of tables run in order; commands within a block run
concurrently, and a failing step aborts the rest:

```toml
[[post-start]]
install = "npm ci"

[[post-start]]
build  = "npm run build"
server = "npm run dev"
```

## Template variables

Hook commands are rendered with the same `{{ var | filter }}` engine as the
path template. Common variables:

| Variable | Meaning |
|----------|---------|
| `{{ branch }}` | Branch the operation acts on |
| `{{ worktree_path }}` | Path of the target worktree |
| `{{ commit }}`, `{{ short_commit }}` | HEAD SHA |
| `{{ base }}` | Source/base branch (switch/create) |
| `{{ repo }}`, `{{ repo_path }}` | Repo name / absolute root |
| `{{ default_branch }}` | Detected main branch |
| `{{ hook_type }}`, `{{ hook_name }}` | e.g. `post-start`, `server` |

## Security

Project hooks (`.config/tl.toml`) run code committed to a repository, so they
require **approval before first run**:

- The exact commands are printed with an `Allow and remember? [y/N]` prompt.
- Approvals are stored per machine in `~/.config/trunkline/approvals.toml`,
  keyed by repo + hook type + name + a SHA-256 hash of the command.
- If a command's text changes, its hash changes and approval is required again.
- Declining skips all project hooks for that operation (user hooks still run).
- `--yes` bypasses prompts (useful for CI); `--no-hooks` skips hooks entirely.

User hooks (`~/.config/trunkline/config.toml`) are trusted — they're your own
machine-level config — and never prompt.

Manage approvals with [`tl config approvals`](commands/config).
