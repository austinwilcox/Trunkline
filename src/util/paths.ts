/**
 * Resolve the on-disk locations trunkline reads and writes.
 *
 * Matches the worktrunk-style split documented in DESIGN.md §4.0:
 *   - project config lives in the repo (`.config/tl.toml`)
 *   - user config + approvals live per-machine under `~/.config/trunkline/`
 *   - hook logs live under `.git/tl/logs/` (never committed)
 */

import { join } from "@std/path";

/** Project config path for a repo root: `<root>/.config/tl.toml`. */
export function projectConfigPath(repoRoot: string): string {
  return join(repoRoot, ".config", "tl.toml");
}

/** User config directory: `~/.config/trunkline` (respects XDG_CONFIG_HOME). */
export function userConfigDir(): string {
  const xdg = Deno.env.get("XDG_CONFIG_HOME");
  if (xdg && xdg.length > 0) return join(xdg, "trunkline");
  const home = homeDir();
  return join(home, ".config", "trunkline");
}

/** User config file: `~/.config/trunkline/config.toml`. */
export function userConfigPath(): string {
  return join(userConfigDir(), "config.toml");
}

/** Approvals store: `~/.config/trunkline/approvals.toml`. */
export function approvalsPath(): string {
  return join(userConfigDir(), "approvals.toml");
}

/**
 * Directory for background hook logs, under the git common dir so it is shared
 * across worktrees and never tracked: `<gitCommonDir>/tl/logs`.
 */
export function logDir(gitCommonDir: string): string {
  return join(gitCommonDir, "tl", "logs");
}

/**
 * Per-repo stacked-branch graph, under the git common dir so it is shared
 * across worktrees and never committed: `<gitCommonDir>/tl/stack.json`.
 */
export function stackStatePath(gitCommonDir: string): string {
  return join(gitCommonDir, "tl", "stack.json");
}

export function homeDir(): string {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  if (!home) throw new Error("Cannot resolve home directory (HOME unset)");
  return home;
}
