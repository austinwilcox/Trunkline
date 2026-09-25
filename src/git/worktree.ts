/**
 * Worktree enumeration via `git worktree list --porcelain`.
 *
 * v1 implements listing; add/remove land in later build steps.
 */

import { basename } from "@std/path";
import { git, gitStdout } from "./exec.ts";

export interface Worktree {
  /** Absolute path to the worktree directory. */
  path: string;
  /** Directory name of the worktree. */
  name: string;
  /** Full HEAD commit SHA. */
  head: string;
  /** Branch name (without refs/heads/), or null if detached. */
  branch: string | null;
  /** True when the worktree is in a detached-HEAD state. */
  detached: boolean;
  /** True when this is a bare repository entry. */
  bare: boolean;
}

/**
 * List all worktrees for the repository containing `cwd`.
 *
 * Parses the stable `--porcelain` format: records separated by blank lines,
 * each line an attribute keyword optionally followed by a value.
 */
export async function listWorktrees(cwd: string): Promise<Worktree[]> {
  const { stdout } = await git(["worktree", "list", "--porcelain"], { cwd });
  const worktrees: Worktree[] = [];
  let current: Partial<Worktree> | null = null;

  const flush = () => {
    if (current?.path) {
      worktrees.push({
        path: current.path,
        name: basename(current.path),
        head: current.head ?? "",
        branch: current.branch ?? null,
        detached: current.detached ?? false,
        bare: current.bare ?? false,
      });
    }
    current = null;
  };

  for (const raw of stdout.split("\n")) {
    const line = raw.trimEnd();
    if (line === "") {
      flush();
      continue;
    }
    current ??= {};
    const sep = line.indexOf(" ");
    const key = sep === -1 ? line : line.slice(0, sep);
    const value = sep === -1 ? "" : line.slice(sep + 1);

    switch (key) {
      case "worktree":
        current.path = value;
        break;
      case "HEAD":
        current.head = value;
        break;
      case "branch":
        // e.g. "refs/heads/feature" -> "feature"
        current.branch = value.replace(/^refs\/heads\//, "");
        break;
      case "detached":
        current.detached = true;
        break;
      case "bare":
        current.bare = true;
        break;
    }
  }
  flush();
  return worktrees;
}

/** Find the worktree checked out for `branch`, or null if none. */
export async function findWorktreeByBranch(
  cwd: string,
  branch: string,
): Promise<Worktree | null> {
  const worktrees = await listWorktrees(cwd);
  return worktrees.find((w) => w.branch === branch) ?? null;
}

/** True if a local branch with this name exists. */
export async function branchExists(
  cwd: string,
  branch: string,
): Promise<boolean> {
  const res = await git(
    ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    { cwd, check: false },
  );
  return res.code === 0;
}

/**
 * Find a remote-tracking branch matching `branch`, e.g. `origin/feat`.
 *
 * Checks `refs/remotes/*` /`branch`. If the primary remote (`origin`) has it,
 * that's preferred; otherwise the first remote that has it is returned. Returns
 * null if no remote has the branch.
 */
export async function findRemoteBranch(
  cwd: string,
  branch: string,
): Promise<string | null> {
  const res = await git(
    [
      "for-each-ref",
      "--format=%(refname:short)",
      `refs/remotes/*/${branch}`,
    ],
    { cwd, check: false },
  );
  if (res.code !== 0) return null;
  const refs = res.stdout.split("\n").map((s) => s.trim()).filter((s) =>
    s.length > 0 && s.endsWith(`/${branch}`)
  );
  if (refs.length === 0) return null;
  // Prefer origin/<branch> when present.
  return refs.find((r) => r === `origin/${branch}`) ?? refs[0];
}

/** Fetch a single branch from its remote so its remote-tracking ref is current. */
export async function fetchRemoteBranch(
  cwd: string,
  remote: string,
  branch: string,
): Promise<void> {
  await git(["fetch", remote, branch], { cwd, check: false });
}

/**
 * Add a worktree for a new local `branch` that tracks `remoteRef`
 * (e.g. `origin/feat`): `git worktree add --track -b <branch> <path> <remoteRef>`.
 */
export async function addTrackingWorktree(
  cwd: string,
  branch: string,
  path: string,
  remoteRef: string,
): Promise<void> {
  await git(
    ["worktree", "add", "--track", "-b", branch, path, remoteRef],
    { cwd },
  );
}

export interface AddWorktreeOptions {
  /** Create a new branch (`git worktree add -b`). */
  create?: boolean;
  /** Base ref to create the new branch from (defaults to current HEAD). */
  base?: string;
}

/**
 * Add a worktree for `branch` at `path`.
 *
 * With `create`, a new branch is created (from `base` if given). Without it,
 * the existing branch is checked out into the new worktree.
 */
export async function addWorktree(
  cwd: string,
  branch: string,
  path: string,
  opts: AddWorktreeOptions = {},
): Promise<void> {
  const args = ["worktree", "add"];
  if (opts.create) {
    args.push("-b", branch, path);
    if (opts.base) args.push(opts.base);
  } else {
    args.push(path, branch);
  }
  await git(args, { cwd });
}

export interface RemoveWorktreeOptions {
  /** Remove even if the worktree has uncommitted changes. */
  force?: boolean;
}

/** Remove the worktree at `path` via `git worktree remove`. */
export async function removeWorktree(
  cwd: string,
  path: string,
  opts: RemoveWorktreeOptions = {},
): Promise<void> {
  const args = ["worktree", "remove"];
  if (opts.force) args.push("--force");
  args.push(path);
  await git(args, { cwd });
}

/**
 * Delete a local branch. Uses `-D` when `force`, else `-d` (safe delete that
 * refuses to drop unmerged branches).
 */
export async function deleteBranch(
  cwd: string,
  branch: string,
  force = false,
): Promise<void> {
  await git(["branch", force ? "-D" : "-d", branch], { cwd });
}

/** The primary (main) worktree — the first entry git reports. */
export async function primaryWorktree(cwd: string): Promise<Worktree> {
  const worktrees = await listWorktrees(cwd);
  const first = worktrees.find((w) => !w.bare);
  if (!first) throw new Error("No worktree found for repository");
  return first;
}

/** Current branch name for the worktree at `cwd`, or null if detached. */
export async function currentBranch(cwd: string): Promise<string | null> {
  const ref = await gitStdout(["symbolic-ref", "--quiet", "HEAD"], {
    cwd,
    check: false,
  });
  if (!ref) return null;
  return ref.replace(/^refs\/heads\//, "");
}

/** All local branch names (for completion candidates). */
export async function listBranches(cwd: string): Promise<string[]> {
  const res = await git(
    ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    { cwd, check: false },
  );
  if (res.code !== 0) return [];
  return res.stdout.split("\n").map((s) => s.trim()).filter((s) =>
    s.length > 0
  );
}

/** True if `ancestor` is an ancestor commit of `descendant` (both refs). */
export async function isAncestor(
  cwd: string,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  const res = await git(
    ["merge-base", "--is-ancestor", ancestor, descendant],
    { cwd, check: false },
  );
  return res.code === 0;
}

/** Number of commits `ref` is ahead of `base` (base..ref). */
export async function commitsAhead(
  cwd: string,
  base: string,
  ref: string,
): Promise<number> {
  const res = await git(["rev-list", "--count", `${base}..${ref}`], {
    cwd,
    check: false,
  });
  const n = Number(res.stdout.trim());
  return Number.isNaN(n) ? 0 : n;
}
