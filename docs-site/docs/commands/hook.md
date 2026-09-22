---
id: hook
title: tl hook
sidebar_label: hook
---

# `tl hook`

Run configured hooks on demand — useful for testing hooks, running them in CI,
or re-running after a failure.

```bash
tl hook show                  # show configured hooks
tl hook post-start            # run all post-start hooks
tl hook pre-start a b         # run only hooks named "a" and "b"
tl hook pre-start user:       # run all user hooks
tl hook pre-start project:x   # run the project hook named "x"
tl hook post-start --foreground   # run a background hook inline
tl hook pre-start --dry-run   # preview the commands without running them
tl hook pre-start --yes       # skip approval prompts
```

## Hook types

`pre-switch`, `post-switch`, `pre-start`, `post-start`, `pre-remove`,
`post-remove`. See [Hooks](../hooks) for what each one does and when it fires.

## Name and source filters

Positional arguments after the hook type filter which commands run:

- **bare name** (`test`) — commands named `test` from any source.
- **`user:` / `project:`** — all commands from that source.
- **`user:name` / `project:name`** — a specific command from one source.

## Options

| Flag | Meaning |
|------|---------|
| `--foreground` | Run a background (`post-*`) hook inline so its output is shown |
| `--dry-run` | Render and print the commands without executing |
| `-y`, `--yes` | Bypass the project-hook approval prompt |
