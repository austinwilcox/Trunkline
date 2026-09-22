---
id: config
title: tl config
sidebar_label: config
---

# `tl config`

Inspect configuration, manage project-hook approvals, and install shell
integration.

```bash
tl config show                       # merged effective config (settings + hooks)
tl config path                       # resolved config / approvals / log paths
tl config approvals list             # saved project-hook approvals
tl config approvals clear            # remove all approvals
tl config approvals clear --repo     # remove approvals for the current repo
tl config shell install              # install the cd-changing shell wrapper
tl config shell install --shell zsh  # target a specific shell
tl config shell install --print      # print the wrapper snippet instead
```

## `show`

Prints the effective configuration after merging the project config
(`.config/tl.toml`) and user config (`~/.config/trunkline/config.toml`), plus
which source each hook came from.

## `path`

Shows where trunkline reads and writes:

- **project config** — `<repo>/.config/tl.toml`
- **user config** — `~/.config/trunkline/config.toml`
- **approvals** — `~/.config/trunkline/approvals.toml`
- **logs** — `<gitCommonDir>/tl/logs`

## `approvals`

Project hooks require a one-time approval before they run on your machine. This
subcommand lists what's approved and lets you clear it (all, or scoped to the
current repo with `--repo`). See [Hooks → Security](../hooks#security).

## `shell install`

Installs a small wrapper function into your shell's rc file (bash `.bashrc`,
zsh `.zshrc`, fish `config.fish`) so `tl switch` and the stack navigation
commands can change your shell's directory. The install is idempotent — running
it again updates the existing block.
