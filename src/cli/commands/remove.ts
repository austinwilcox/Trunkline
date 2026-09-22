/**
 * `tl remove [branch]` — remove a worktree (defaults to the current one) and,
 * unless told otherwise, its branch.
 *
 * Flags:
 *       --force         remove even with uncommitted changes / unmerged branch
 *       --keep-branch   remove the worktree but keep the branch
 *       --no-hooks      skip lifecycle hooks
 *
 * Lifecycle hooks:
 *   - pre-remove  (blocking, in the worktree being removed) before deletion
 *   - post-remove (background, in the primary worktree) after deletion
 *
 * Refuses to remove the primary worktree.
 */

import { detectMainBranch, getRepoInfo } from "../../git/repo.ts";
import {
  currentBranch,
  deleteBranch,
  findWorktreeByBranch,
  primaryWorktree,
  removeWorktree,
} from "../../git/worktree.ts";
import { getDirtyState } from "../../git/status.ts";
import { loadConfig } from "../../config/load.ts";
import { runLifecycleHooks } from "../../hooks/lifecycle.ts";
import { type CdChannel, requestCd } from "../../util/cd.ts";
import { error, info, success, warn } from "../../util/log.ts";

export interface RemoveOptions {
  /** Branch whose worktree to remove. Defaults to the current worktree. */
  branch?: string;
  force?: boolean;
  keepBranch?: boolean;
  noHooks?: boolean;
  yes?: boolean;
  cd: CdChannel;
  cwd?: string;
}

export async function runRemove(opts: RemoveOptions): Promise<number> {
  const cwd = opts.cwd ?? Deno.cwd();
  const repo = await getRepoInfo(cwd);
  const config = await loadConfig(repo.root);
  const defaultBranch = await detectMainBranch(
    repo.root,
    config.settings["main-branch"],
  );
  const primary = await primaryWorktree(repo.root);

  // Resolve which worktree to remove.
  const branch = opts.branch ?? await currentBranch(cwd);
  if (!branch) {
    error("Cannot determine which worktree to remove (detached HEAD).");
    return 1;
  }

  const target = await findWorktreeByBranch(repo.root, branch);
  if (!target) {
    error(`No worktree found for branch '${branch}'.`);
    return 1;
  }

  if (target.path === primary.path) {
    error(`Refusing to remove the primary worktree (${primary.path}).`);
    return 1;
  }

  // Guard against losing uncommitted work unless forced.
  if (!opts.force) {
    const dirty = await getDirtyState(target.path);
    if (!dirty.clean) {
      error(
        `Worktree for '${branch}' has uncommitted changes. ` +
          `Commit them or pass --force.`,
      );
      return 1;
    }
  }

  // pre-remove (blocking) runs in the worktree being removed, before deletion.
  if (!opts.noHooks) {
    const pre = await runLifecycleHooks("pre-remove", config, {
      repo,
      defaultBranch,
      branch,
      worktreePath: target.path,
      commit: target.head,
      base: defaultBranch,
    }, { cwd: target.path, yes: opts.yes });
    if (!pre.ok) return 1;
  }

  const removingCurrent = target.path === repo.root;

  info(`Removing worktree ${branch} @ ${target.path}`);
  await removeWorktree(repo.root, target.path, { force: opts.force });

  if (!opts.keepBranch) {
    try {
      await deleteBranch(repo.root, branch, opts.force);
      success(`Removed worktree and branch ${branch}`);
    } catch (_err) {
      warn(
        `Removed worktree, but branch '${branch}' was not deleted ` +
          `(unmerged? use --force). Keeping it.`,
      );
    }
  } else {
    success(`Removed worktree ${branch} (branch kept)`);
  }

  // post-remove (background) runs in the primary worktree (target is gone).
  if (!opts.noHooks) {
    await runLifecycleHooks("post-remove", config, {
      repo,
      defaultBranch,
      branch,
      worktreePath: target.path,
      commit: target.head,
      base: defaultBranch,
    }, { cwd: primary.path, yes: opts.yes });
  }

  if (removingCurrent) {
    await requestCd(primary.path, opts.cd);
  }

  return 0;
}
