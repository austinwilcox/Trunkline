---
id: skill
title: tl skill
sidebar_label: skill
---

# `tl skill`

Print the bundled **AI agent skill** — a `SKILL.md` describing Trunkline's
commands, config, and hooks in a form an AI coding agent can pull into context.

```bash
tl skill                 # print the skill to stdout
tl skill > SKILL.md      # save it for an agent to load
```

The skill is **embedded in the `tl` binary** at build time, so it always
matches the version you have installed — no separate file to keep in sync. It's
the same content published at
[`skills/trunkline/SKILL.md`](https://github.com/austinwilcox/Trunkline/blob/main/skills/trunkline/SKILL.md)
in the repository.

## Using it with an agent

Point your agent at the output, for example:

```bash
tl skill > .agent/skills/trunkline/SKILL.md
```

The skill covers when to use Trunkline, the core commands (switch/list/remove/
prune/stack/hook/config/update), the config and hook model, and agent-specific
notes (e.g. prefer branch names, use `tl list --json`, `--dry-run` before
`prune`).
