---
id: configuration
title: Configuration
sidebar_position: 4
---

# Configuration

Trunkline reads TOML config from two places that share the same schema:

| File | Location | Committed? | Purpose |
|------|----------|-----------|---------|
| Project config | `<repo>/.config/tl.toml` | **Yes** | Worktree path template, hooks, main-branch override — shared with your team |
| User config | `~/.config/trunkline/config.toml` | No | Personal defaults across all repos |

Scalar settings: the project config overrides the user config. Hooks from **both**
sources run (see [Hooks](hooks)).

Two more locations hold per-machine state and are **never** committed:

- **Approvals** — `~/.config/trunkline/approvals.toml` (a per-machine trust
  decision; see [Hooks → Security](hooks#security)).
- **Hook logs** — `<gitCommonDir>/tl/logs/` (transient background-hook output).

Run [`tl init`](commands/init) to scaffold a commented `.config/tl.toml`.

## Settings

```toml
# Branch that status columns compare against. Auto-detected if omitted.
main-branch = "main"

# Template mapping a branch name to a worktree path.
worktree-path = "{{ repo_path }}/../{{ repo }}.{{ branch | sanitize }}"
```

### Path template variables

| Variable | Meaning |
|----------|---------|
| `{{ repo }}` | Repository directory name |
| `{{ repo_path }}` | Absolute path to the repository root |
| `{{ branch }}` | The branch being placed |

### Filters

Templates support Jinja-style filters:

| Filter | Example | Result |
|--------|---------|--------|
| `sanitize` | `{{ branch \| sanitize }}` | replaces `/` and `\` with `-` |
| `hash` | `{{ branch \| hash }}` | 3-char base36 digest |
| `hash_port` | `{{ branch \| hash_port }}` | deterministic port in 10000–19999 |
| `dirname` | `{{ repo_path \| dirname }}` | strip the last path component |
| `basename` | `{{ repo_path \| basename }}` | keep only the last path component |

## Hooks

Hooks are also top-level keys in `.config/tl.toml`. See the dedicated
[Hooks](hooks) page for forms, template variables, and security.

```toml
pre-start = "npm install"

[post-start]
server = "npm run dev -- --port {{ branch | hash_port }}"
```
