/**
 * Repository-level queries: locating the repo root and resolving the main
 * (trunk) branch that status comparisons are measured against.
 */

import { basename } from "@std/path";
import { git, gitStdout } from "./exec.ts";

export interface RepoInfo {
  /** Absolute path to the primary worktree root. */
  root: string;
  /** Directory name of the repo root (used in path templates). */
  name: string;
  /** The `.git` common directory shared across worktrees. */
  gitCommonDir: string;
}

/**
 * Resolve the repository containing `cwd`.
 *
 * @throws if `cwd` is not inside a git repository.
 */
export async function getRepoInfo(cwd?: string): Promise<RepoInfo> {
  const root = await gitStdout(["rev-parse", "--show-toplevel"], { cwd });
  const gitCommonDir = await resolveCommonDir(root);
  return { root, name: basename(root), gitCommonDir };
}

async function resolveCommonDir(cwd: string): Promise<string> {
  const dir = await gitStdout(["rev-parse", "--git-common-dir"], { cwd });
  // git may return a relative path (".git"); resolve against the repo root.
  return dir.startsWith("/") ? dir : `${cwd}/${dir}`;
}

/** Candidate trunk branch names, tried in order when nothing else resolves. */
const FALLBACK_BRANCHES = ["main", "master", "trunk"] as const;

/**
 * Determine the main branch used for ahead/behind comparisons.
 *
 * Resolution order:
 *   1. `override` (from config), if the ref exists.
 *   2. `refs/remotes/origin/HEAD` symbolic ref.
 *   3. First existing branch among {@link FALLBACK_BRANCHES}.
 */
export async function detectMainBranch(
  cwd: string,
  override?: string,
): Promise<string> {
  if (override && await refExists(cwd, override)) {
    return override;
  }

  const originHead = await originHeadBranch(cwd);
  if (originHead) return originHead;

  for (const candidate of FALLBACK_BRANCHES) {
    if (await refExists(cwd, candidate)) return candidate;
  }

  // Last resort: current branch, so callers always get something usable.
  return await gitStdout(["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
}

async function originHeadBranch(cwd: string): Promise<string | null> {
  const res = await git(
    ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    { cwd, check: false },
  );
  if (res.code !== 0) return null;
  // Returns e.g. "origin/main"; strip the remote prefix.
  const ref = res.stdout.trim();
  return ref.startsWith("origin/") ? ref.slice("origin/".length) : ref;
}

async function refExists(cwd: string, ref: string): Promise<boolean> {
  const res = await git(
    ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    { cwd, check: false },
  );
  return res.code === 0;
}
