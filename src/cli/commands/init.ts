/**
 * `tl init` — scaffold a commented `.config/tl.toml` in the current repo.
 *
 * Refuses to overwrite an existing file unless `--force`.
 */

import { getRepoInfo } from "../../git/repo.ts";
import { projectConfigPath } from "../../util/paths.ts";
import { error, success } from "../../util/log.ts";

export interface InitOptions {
  force?: boolean;
  cwd?: string;
}

const TEMPLATE = `# Trunkline project config (committed to the repo).
# Docs: hook types are top-level keys; see DESIGN.md §5.

# Branch that status columns compare against. Auto-detected if omitted.
# main-branch = "main"

# Template mapping a branch name to a worktree path.
# Available vars: {{ repo }}, {{ repo_path }}, {{ branch }}
# Filters: sanitize, hash, hash_port, dirname, basename
# worktree-path = "{{ repo_path }}/../{{ repo }}.{{ branch | sanitize }}"

# ---- Hooks ----
# pre-*  run in the foreground and block the operation on failure.
# post-* run detached in the background; output goes to .git/tl/logs/.

# Run once when a worktree is created, before post-start/-x (blocking):
# pre-start = "npm install"

# Run once when a worktree is created, in the background:
# [post-start]
# server = "npm run dev -- --port {{ branch | hash_port }}"

# Cleanup before a worktree is removed:
# pre-remove = "echo removing {{ branch }}"
`;

export async function runInit(opts: InitOptions = {}): Promise<number> {
  const cwd = opts.cwd ?? Deno.cwd();
  const repo = await getRepoInfo(cwd);
  const path = projectConfigPath(repo.root);

  const exists = await fileExists(path);
  if (exists && !opts.force) {
    error(`${path} already exists. Use --force to overwrite.`);
    return 1;
  }

  const dir = path.slice(0, path.lastIndexOf("/"));
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(path, TEMPLATE);
  success(`${exists ? "Overwrote" : "Created"} ${path}`);
  return 0;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}
