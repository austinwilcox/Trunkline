/**
 * Per-worktree status: dirty state, ahead/behind the main branch, and
 * unpushed-to-remote state, plus HEAD commit metadata.
 */

import { git, gitStdout } from "./exec.ts";

export interface DirtyState {
  staged: number;
  unstaged: number;
  untracked: number;
  clean: boolean;
}

export interface AheadBehind {
  ahead: number;
  behind: number;
}

export interface CommitMeta {
  shortSha: string;
  /** Relative age, e.g. "2h", "3d" (git's short relative format). */
  age: string;
  subject: string;
}

export interface WorktreeStatus {
  dirty: DirtyState;
  /** Ahead/behind the main branch. null if not computable (e.g. detached). */
  vsMain: AheadBehind | null;
  /** Commits ahead of the tracked upstream (unpushed). null if no upstream. */
  unpushed: number | null;
  commit: CommitMeta;
}

/** Parse `git status --porcelain=v1` into staged/unstaged/untracked counts. */
export async function getDirtyState(cwd: string): Promise<DirtyState> {
  const { stdout } = await git(["status", "--porcelain=v1"], { cwd });
  let staged = 0, unstaged = 0, untracked = 0;

  for (const line of stdout.split("\n")) {
    if (line === "") continue;
    const x = line[0]; // staged/index column
    const y = line[1]; // worktree column
    if (x === "?" && y === "?") {
      untracked++;
      continue;
    }
    if (x !== " " && x !== "?") staged++;
    if (y !== " " && y !== "?") unstaged++;
  }

  return {
    staged,
    unstaged,
    untracked,
    clean: staged === 0 && unstaged === 0 && untracked === 0,
  };
}

/**
 * Count commits `branch` is ahead/behind `mainBranch` using the symmetric
 * `--left-right` form: left = behind (in main, not branch),
 * right = ahead (in branch, not main).
 */
export async function getAheadBehind(
  cwd: string,
  branch: string,
  mainBranch: string,
): Promise<AheadBehind | null> {
  const res = await git(
    ["rev-list", "--left-right", "--count", `${mainBranch}...${branch}`],
    { cwd, check: false },
  );
  if (res.code !== 0) return null;
  const [behind, ahead] = res.stdout.trim().split(/\s+/).map(Number);
  if (Number.isNaN(behind) || Number.isNaN(ahead)) return null;
  return { ahead, behind };
}

/** Commits ahead of the branch's upstream (unpushed). null if no upstream. */
export async function getUnpushed(
  cwd: string,
  branch: string,
): Promise<number | null> {
  const upstream = await git(
    [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      `${branch}@{upstream}`,
    ],
    { cwd, check: false },
  );
  if (upstream.code !== 0) return null;

  const res = await git(
    ["rev-list", "--count", `${upstream.stdout.trim()}..${branch}`],
    { cwd, check: false },
  );
  if (res.code !== 0) return null;
  const n = Number(res.stdout.trim());
  return Number.isNaN(n) ? null : n;
}

/** HEAD commit metadata for display. */
export async function getCommitMeta(cwd: string): Promise<CommitMeta> {
  // %h short sha, %cr committer date relative, %s subject — NUL-separated.
  const out = await gitStdout(
    ["log", "-1", "--format=%h%x00%cr%x00%s"],
    { cwd },
  );
  const [shortSha = "", age = "", subject = ""] = out.split("\0");
  return { shortSha, age: shortenAge(age), subject };
}

/** Compress git's "2 hours ago" into a compact "2h". */
function shortenAge(relative: string): string {
  const m = relative.match(/(\d+)\s+(second|minute|hour|day|week|month|year)/);
  if (!m) return relative;
  const n = m[1];
  const unit = m[2][0]; // s/m/h/d/w/m/y — month collides with minute
  const compact = m[2] === "month" ? "mo" : unit;
  return `${n}${compact}`;
}

/** Gather full status for a single worktree. */
export async function getWorktreeStatus(
  cwd: string,
  branch: string | null,
  mainBranch: string,
): Promise<WorktreeStatus> {
  const [dirty, commit] = await Promise.all([
    getDirtyState(cwd),
    getCommitMeta(cwd),
  ]);

  let vsMain: AheadBehind | null = null;
  let unpushed: number | null = null;
  if (branch) {
    [vsMain, unpushed] = await Promise.all([
      branch === mainBranch
        ? Promise.resolve<AheadBehind | null>({ ahead: 0, behind: 0 })
        : getAheadBehind(cwd, branch, mainBranch),
      getUnpushed(cwd, branch),
    ]);
  }

  return { dirty, vsMain, unpushed, commit };
}

/**
 * Detect a branch that landed in `target` as a squash (or rebase) merge, where
 * ancestry checks fail because main holds a *new* commit with the same change.
 *
 * Builds a throwaway commit whose tree is the branch tip and whose parent is
 * the merge-base, i.e. the branch's whole change as one patch, then asks
 * `git cherry` whether `target` already has a commit with the same patch-id.
 * Nothing is written to any ref; the dangling commit is left for git's gc.
 */
export async function isSquashMerged(
  cwd: string,
  branch: string,
  target: string,
): Promise<boolean> {
  const base = await git(["merge-base", target, branch], {
    cwd,
    check: false,
  });
  if (base.code !== 0) return false;

  const squashed = await git(
    [
      "commit-tree",
      `${branch}^{tree}`,
      "-p",
      base.stdout.trim(),
      "-m",
      "tl: squash probe",
    ],
    { cwd, check: false },
  );
  if (squashed.code !== 0) return false;

  const cherry = await git(["cherry", target, squashed.stdout.trim()], {
    cwd,
    check: false,
  });
  // "-" marks a commit whose equivalent change already exists in `target`.
  return cherry.code === 0 && cherry.stdout.trim().startsWith("-");
}
