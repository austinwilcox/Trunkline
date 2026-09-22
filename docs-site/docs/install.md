---
id: install
title: Installation
sidebar_position: 2
---

# Installation

## Requirements

- [Deno](https://deno.com/) 2.x
- Git 2.x

## Run from source

Clone the repository and use the Deno tasks defined in `deno.json`:

```bash
git clone https://github.com/austinwilcox/Trunkline.git
cd Trunkline

# Run directly without compiling
deno task dev list
```

## Compile a standalone binary

```bash
deno task compile      # produces dist/tl
./dist/tl --help
```

Put `dist/tl` somewhere on your `PATH` (e.g. `~/.local/bin/tl`) to use it as
`tl` everywhere.

## Enable shell integration

`tl switch` needs to change your shell's working directory, which a binary
cannot do on its own. Install the shell wrapper once:

```bash
tl config shell install         # detects your shell (bash/zsh/fish)
tl config shell install --shell zsh
tl config shell install --print # print the wrapper without installing
```

Then restart your shell (or `source` your rc file). See
[`tl config`](commands/config) for details.

## Development tasks

```bash
deno task check    # type-check + lint + fmt --check
deno task test     # run the test suite
deno task fmt      # format
deno task compile  # build dist/tl
```
