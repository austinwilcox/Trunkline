/**
 * `tl switch <branch>` — switch to a worktree, creating it if requested.
 *
 * Flags:
 *   -c, --create        create the branch + worktree if it doesn't exist
 *       --base <ref>    base ref for the new branch (implies create)
 *   -x, --execute <cmd> run <cmd> in the worktree after switching
 *       --no-hooks      skip lifecycle hooks
 *
 * Lifecycle hooks:
 *   - pre-switch  (blocking, in source worktree) before switching
 *   - pre-start   (blocking, in new worktree) on create, before post-start/-x
 *   - post-start  (background, in new worktree) on create
 *   - post-switch (background) after switching
 */

import { detectMainBranch, getRepoInfo } from "../../git/repo.ts";
import {
  addTrackingWorktree,
  addWorktree,
  branchExists,
  currentBranch,
  fetchRemoteBranch,
  findRemoteBranch,
  findWorktreeByBranch,
} from "../../git/worktree.ts";
import { resolveWorktreePath } from "../../config/worktree_path.ts";
import { loadConfig } from "../../config/load.ts";
import { loadStackState, saveStackState, track } from "../../stack/store.ts";
import { runLifecycleHooks } from "../../hooks/lifecycle.ts";
import { type CdChannel, requestCd } from "../../util/cd.ts";
import { error, info, success, warn } from "../../util/log.ts";

export interface SwitchOptions {
  branch: string;
  create?: boolean;
  base?: string;
  execute?: string;
  executeArgs?: string[];
  noHooks?: boolean;
  yes?: boolean;
  /** Track the new branch in the stack, based on the current branch. */
  stack?: boolean;
  cd: CdChannel;
  cwd?: string;
}

export async function runSwitch(opts: SwitchOptions): Promise<number> {
  const cwd = opts.cwd ?? Deno.cwd();
  const { branch } = opts;

  if (!branch) {
    error("switch requires a branch name: tl switch <branch>");
    return 2;
  }

  const repo = await getRepoInfo(cwd);
  const config = await loadConfig(repo.root);
  const defaultBranch = await detectMainBranch(
    repo.root,
    config.settings["main-branch"],
  );
  const sourceBranch = await currentBranchSafe(cwd);

  // pre-switch runs in the source worktree, before anything changes.
  if (!opts.noHooks) {
    const pre = await runLifecycleHooks("pre-switch", config, {
      repo,
      defaultBranch,
      branch,
      worktreePath: repo.root,
      base: sourceBranch,
      args: opts.executeArgs,
    }, { cwd, yes: opts.yes });
    if (!pre.ok) return 1;
  }

  let target = await findWorktreeByBranch(repo.root, branch);
  const creating = !target;

  // In stack mode, a new branch is based on the branch we're currently on
  // (unless an explicit --base was given).
  const stackBase = opts.stack
    ? (opts.base ?? sourceBranch ?? defaultBranch)
    : opts.base;

  if (!target) {
    const wantCreate = opts.create || opts.base !== undefined || opts.stack;
    const exists = await branchExists(repo.root, branch);

    // Not local and not explicitly creating: if the branch exists on a remote,
    // fetch it and create a worktree that tracks it (no -c needed).
    let remoteRef: string | null = null;
    if (!exists && !wantCreate) {
      remoteRef = await findRemoteBranch(repo.root, branch);
      if (!remoteRef) {
        error(
          `No worktree or branch '${branch}' (locally or on any remote). ` +
            `Use -c to create it.`,
        );
        return 1;
      }
    }

    const path = resolveWorktreePath({
      repo,
      branch,
      template: config.settings["worktree-path"],
    });

    if (remoteRef) {
      // Refresh the remote-tracking ref, then check it out into a worktree.
      const remote = remoteRef.slice(0, remoteRef.indexOf("/"));
      info(`Fetching ${remoteRef} and creating worktree @ ${path}`);
      await fetchRemoteBranch(repo.root, remote, branch);
      await addTrackingWorktree(repo.root, branch, path, remoteRef);
    } else {
      info(`Creating worktree for ${branch} @ ${path}`);
      await addWorktree(repo.root, branch, path, {
        create: !exists,
        base: stackBase,
      });
    }

    target = await findWorktreeByBranch(repo.root, branch);
    if (!target) {
      error(`Worktree creation reported success but none was found.`);
      return 1;
    }
    success(
      `Created ${
        remoteRef
          ? `worktree tracking ${remoteRef}`
          : exists
          ? "worktree"
          : "branch and worktree"
      } ` +
        `${branch} @ ${target.path}`,
    );
  }

  // Track the branch in the stack when requested.
  if (opts.stack && stackBase) {
    const state = await loadStackState(repo.gitCommonDir);
    track(state, branch, stackBase);
    await saveStackState(repo.gitCommonDir, state);
    info(`Tracking ${branch} with base ${stackBase}`);
  }

  // pre-start (blocking) then post-start (background) run only on create,
  // in the new worktree.
  if (creating && !opts.noHooks) {
    const pre = await runLifecycleHooks("pre-start", config, {
      repo,
      defaultBranch,
      branch,
      worktreePath: target.path,
      commit: target.head,
      base: sourceBranch,
      args: opts.executeArgs,
    }, { cwd: target.path, yes: opts.yes });
    if (!pre.ok) return 1;

    await runLifecycleHooks("post-start", config, {
      repo,
      defaultBranch,
      branch,
      worktreePath: target.path,
      commit: target.head,
      base: sourceBranch,
      args: opts.executeArgs,
    }, { cwd: target.path, yes: opts.yes });
  }

  // Ask the shell wrapper to change directory.
  const changed = await requestCd(target.path, opts.cd);
  if (!changed) {
    warn(
      `Shell integration not active — cd manually:\n  cd ${target.path}\n` +
        `(run 'tl config shell install' to enable automatic switching)`,
    );
  }

  // post-switch (background) after the switch is resolved.
  if (!opts.noHooks) {
    await runLifecycleHooks("post-switch", config, {
      repo,
      defaultBranch,
      branch,
      worktreePath: target.path,
      commit: target.head,
      base: sourceBranch,
      args: opts.executeArgs,
    }, { cwd: target.path, yes: opts.yes });
  }

  // Optionally run a command in the new worktree.
  if (opts.execute) {
    return await runInWorktree(
      target.path,
      opts.execute,
      opts.executeArgs ?? [],
    );
  }

  return 0;
}

async function currentBranchSafe(cwd: string): Promise<string | null> {
  try {
    return await currentBranch(cwd);
  } catch {
    return null;
  }
}

async function runInWorktree(
  cwd: string,
  cmd: string,
  args: string[],
): Promise<number> {
  const command = new Deno.Command(cmd, {
    args,
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await command.output();
  return code;
}
