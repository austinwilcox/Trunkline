---
id: update
title: tl update
sidebar_label: update
---

# `tl update`

Update `tl` to the latest GitHub release, in place — no manual download needed.

```bash
tl update            # check, confirm, then download + replace this binary
tl update --check    # only report whether an update is available
tl update --yes      # skip the confirmation prompt
tl update --force    # reinstall even if already on the latest version
```

## How it works

1. Queries the latest release and compares it to your installed version.
2. Picks the asset for your platform
   (`tl-<version>-<os>-<arch>.tar.gz` / `.zip`).
3. Downloads it, **verifies its SHA-256** against the published checksum, and
   extracts the binary.
4. Atomically replaces the currently running executable.

## Permissions & sudo

Replacing the binary requires write access to the directory it lives in. If
`tl` is installed somewhere root-owned (e.g. `/usr/local/bin`), the update will
fail with a permission error and tell you to re-run with elevated privileges:

```bash
sudo tl update
```

If it's installed under your home directory (e.g. `~/.local/bin/tl`), no sudo is
needed.

## Notes

- On Windows, a running `.exe` can't be overwritten directly, so `tl update`
  moves the old binary aside (`tl.exe.old`) and installs the new one.
- Trunkline also shows a passive "a new release is available" notice
  (at most once per day) when you run any command; `tl update` is the active
  counterpart.
