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

Installs trunkline's shell integration into your shell's rc file (bash
`.bashrc`, zsh `.zshrc`, fish `config.fish`). This sets up **two** things,
each in its own idempotent marker block (re-running updates them in place):

1. A **cd wrapper** so `tl switch` and the stack navigation commands
   (`tl up`/`down`/`trunk`/…) can change your shell's directory.
2. **Tab completion** (see below).

```bash
tl config shell install              # detect your shell, install both
tl config shell install --shell zsh  # target a specific shell
tl config shell install --print      # print the snippets instead of installing
```

After installing, restart your shell or `source` your rc file.

## Tab completion

Once shell integration is installed, `tl` completes subcommands, flags, and
**branch names** as you type:

```bash
tl sw<Tab>            # → switch
tl switch DEV<Tab>    # → DEV-123  DEV-456   (matching local branches)
tl remove <Tab>       # → lists branches to remove
tl switch --cr<Tab>   # → --create
tl stack track <Tab>  # → lists branches
```

Branch matching is **case-insensitive**, so `tl switch dev<Tab>` also finds
`DEV-123`. Completion is powered by a hidden `tl __complete` command that the
generated completion scripts call, so it always reflects the current CLI.

Supported shells: **bash**, **zsh**, **fish**. If you installed integration
before completions existed, just run `tl config shell install` again to add
them.
