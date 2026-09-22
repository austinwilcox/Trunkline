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
  addWorktree,
  branchExists,
  currentBranch,
  findWorktreeByBranch,
} from "../../git/worktree.ts";
import { resolveWorktreePath } from "../../config/worktree_path.ts";
import { loadConfig } from "../../config/load.ts";
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

  if (!target) {
    const wantCreate = opts.create || opts.base !== undefined;
    const exists = await branchExists(repo.root, branch);

    if (!exists && !wantCreate) {
      error(`No worktree or branch '${branch}'. Use -c to create it.`);
      return 1;
    }

    const path = resolveWorktreePath({
      repo,
      branch,
      template: config.settings["worktree-path"],
    });
    info(`Creating worktree for ${branch} @ ${path}`);
    await addWorktree(repo.root, branch, path, {
      create: !exists,
      base: opts.base,
    });
    target = await findWorktreeByBranch(repo.root, branch);
    if (!target) {
      error(`Worktree creation reported success but none was found.`);
      return 1;
    }
    success(
      `Created ${exists ? "worktree" : "branch and worktree"} ` +
        `${branch} @ ${target.path}`,
    );
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
