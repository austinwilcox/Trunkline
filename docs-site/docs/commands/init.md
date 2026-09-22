---
id: init
title: tl init
sidebar_label: init
---

# `tl init`

Scaffold a commented `.config/tl.toml` in the current repository.

```bash
tl init            # create .config/tl.toml
tl init --force    # overwrite an existing file
```

The generated file documents the available settings and hook types with
commented-out examples, so you can uncomment and adjust what you need. Trunkline
refuses to overwrite an existing config unless you pass `--force`.

See [Configuration](../configuration) for the full schema.
