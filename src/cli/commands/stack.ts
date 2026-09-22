/**
 * `tl stack` — manage and view stacked branches.
 *
 *   tl stack                     Show the current stack as a tree
 *   tl stack track [--base <b>]  Track the current branch (guess base if omitted)
 *   tl stack untrack [branch]    Forget a branch (keeps the git branch/worktree)
 *
 * See docs/STACKS.md.
 */

import {
  detectMainBranch,
  getRepoInfo,
  type RepoInfo,
} from "../../git/repo.ts";
import {
  branchExists,
  commitsAhead,
  currentBranch,
  isAncestor,
} from "../../git/worktree.ts";
import {
  isTracked,
  loadStackState,
  saveStackState,
  type StackState,
  track,
  untrack,
} from "../../stack/store.ts";
import { renderStackTree } from "./stack_view.ts";
import { error, success, warn } from "../../util/log.ts";

export interface StackOptions {
  args: string[];
  base?: string;
  cwd?: string;
}

export interface StackContext {
  repo: RepoInfo;
  trunk: string;
  state: StackState;
  branch: string | null;
}

/** Shared setup used by stack + navigation commands. */
export async function resolveStackContext(
  cwd: string,
  baseOverride?: string,
): Promise<StackContext> {
  const repo = await getRepoInfo(cwd);
  const trunk = await detectMainBranch(repo.root, baseOverride);
  const state = await loadStackState(repo.gitCommonDir);
  const branch = await currentBranch(cwd);
  return { repo, trunk, state, branch };
}

export async function runStack(opts: StackOptions): Promise<number> {
  const cwd = opts.cwd ?? Deno.cwd();
  const [sub, ...rest] = opts.args;

  switch (sub) {
    case undefined:
    case "show":
      return await stackShow(cwd);
    case "track":
      return await stackTrack(cwd, opts.base);
    case "untrack":
      return await stackUntrack(cwd, rest[0]);
    default:
      error("Usage: tl stack [show|track|untrack] ...");
      return 2;
  }
}

async function stackShow(cwd: string): Promise<number> {
  const ctx = await resolveStackContext(cwd);
  const tree = await renderStackTree(ctx, cwd);
  console.log(tree);
  return 0;
}

async function stackTrack(cwd: string, baseOverride?: string): Promise<number> {
  const ctx = await resolveStackContext(cwd);
  if (!ctx.branch) {
    error("Cannot track a detached HEAD. Check out a branch first.");
    return 1;
  }
  if (ctx.branch === ctx.trunk) {
    error(
      `'${ctx.trunk}' is the trunk and cannot be tracked as a stack branch.`,
    );
    return 1;
  }

  let base = baseOverride;
  if (base) {
    if (
      base !== ctx.trunk && !isTracked(ctx.state, base) &&
      !(await branchExists(ctx.repo.root, base))
    ) {
      error(`Base '${base}' is not a known branch.`);
      return 1;
    }
  } else {
    const guessed = await guessBase(ctx, cwd);
    if (!guessed) {
      error(
        `Could not determine a base for '${ctx.branch}'. Pass --base <branch>.`,
      );
      return 1;
    }
    base = guessed;
  }

  track(ctx.state, ctx.branch, base);
  await saveStackState(ctx.repo.gitCommonDir, ctx.state);
  success(`Tracking ${ctx.branch} with base ${base}`);
  return 0;
}

async function stackUntrack(cwd: string, branchArg?: string): Promise<number> {
  const ctx = await resolveStackContext(cwd);
  const branch = branchArg ?? ctx.branch;
  if (!branch) {
    error("No branch to untrack (detached HEAD). Pass a branch name.");
    return 1;
  }
  if (!isTracked(ctx.state, branch)) {
    warn(`'${branch}' is not tracked.`);
    return 0;
  }
  const retargeted = untrack(ctx.state, branch);
  await saveStackState(ctx.repo.gitCommonDir, ctx.state);
  success(`Untracked ${branch}`);
  if (retargeted.length > 0) {
    warn(`Retargeted onto its base: ${retargeted.join(", ")}`);
  }
  return 0;
}

/**
 * Guess a base for the current branch: among the trunk and all tracked
 * branches that are ancestors of the current branch, pick the *nearest* one
 * (fewest commits between it and the branch tip).
 */
async function guessBase(
  ctx: StackContext,
  cwd: string,
): Promise<string | null> {
  const branch = ctx.branch!;
  const candidates = [ctx.trunk, ...Object.keys(ctx.state.branches)]
    .filter((b) => b !== branch);

  let best: { name: string; ahead: number } | null = null;
  for (const cand of candidates) {
    if (!(await isAncestor(cwd, cand, branch))) continue;
    const ahead = await commitsAhead(cwd, cand, branch);
    if (best === null || ahead < best.ahead) {
      best = { name: cand, ahead };
    }
  }
  return best?.name ?? null;
}
