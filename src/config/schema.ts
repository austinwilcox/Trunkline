/**
 * Config schema types shared by project (`.config/tl.toml`) and user
 * (`~/.config/trunkline/config.toml`) configs.
 *
 * Hook types are top-level keys in the TOML (matching worktrunk), e.g.
 * `pre-start = "npm install"` or `[post-start]`. Non-hook settings use
 * dedicated keys.
 */

/**
 * A single hook definition, in one of three TOML shapes:
 *   - string: one command
 *   - table: named commands run concurrently
 *   - array of tables: a pipeline of sequential steps
 */
export type HookForm =
  | string
  | Record<string, string>
  | Array<Record<string, string>>;

export const HOOK_TYPES = [
  "pre-switch",
  "post-switch",
  "pre-start",
  "post-start",
  "pre-remove",
  "post-remove",
] as const;

export type HookType = typeof HOOK_TYPES[number];

export function isHookType(key: string): key is HookType {
  return (HOOK_TYPES as readonly string[]).includes(key);
}

/** True for lifecycle events that block the operation on failure. */
export function isBlocking(type: HookType): boolean {
  return type.startsWith("pre-");
}

/** Non-hook configuration keys. */
export interface Settings {
  /** Override for the detected main branch. */
  "main-branch"?: string;
  /** Template mapping a branch name to a worktree path. */
  "worktree-path"?: string;
}

/** Fully parsed config from a single file. */
export interface TrunklineConfig extends Settings {
  hooks: Partial<Record<HookType, HookForm>>;
}

export const SETTING_KEYS = ["main-branch", "worktree-path"] as const;

export const DEFAULT_WORKTREE_PATH =
  "{{ repo_path }}/../{{ repo }}.{{ branch | sanitize }}";
