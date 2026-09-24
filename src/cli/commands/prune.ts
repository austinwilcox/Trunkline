/**
 * `tl prune` — remove worktrees whose branch is already merged into main.
 *
 * A worktree is prunable when:
 *   - it is not the primary worktree and not the main branch,
 *   - it has a branch (not detached),
 *   - its branch has **0 commits ahead of main** (all its work has landed), and
 *   - its working tree is clean (no uncommitted changes).
 *
 * By default prune previews the candidates and asks for confirmation, since it
 * deletes worktrees and branches. Flags:
 *       --dry-run      list candidates and exit (never removes)
 *   -y, --yes          skip the confirmation prompt
 *       --keep-branch  remove the worktrees but keep the branches
 *       --no-hooks     skip pre/post-remove hooks
 */

import { detectMainBranch, getRepoInfo } from "../../git/repo.ts";
import {
  currentBranch,
  deleteBranch,
  primaryWorktree,
  removeWorktree,
  type Worktree,
} from "../../git/worktree.ts";
import { getAheadBehind, getDirtyState } from "../../git/status.ts";
import { listWorktrees } from "../../git/worktree.ts";
import { loadConfig } from "../../config/load.ts";
import { runLifecycleHooks } from "../../hooks/lifecycle.ts";
import { type CdChannel, requestCd } from "../../util/cd.ts";
import { bold, dim, info, success, warn } from "../../util/log.ts";

export interface PruneOptions {
  dryRun?: boolean;
  yes?: boolean;
  keepBranch?: boolean;
  noHooks?: boolean;
  cd: CdChannel;
  cwd?: string;
}

interface Candidate {
  worktree: Worktree;
  branch: string;
}

export async function runPrune(opts: PruneOptions): Promise<number> {
  const cwd = opts.cwd ?? Deno.cwd();
  const repo = await getRepoInfo(cwd);
  const config = await loadConfig(repo.root);
  const mainBranch = await detectMainBranch(
    repo.root,
    config.settings["main-branch"],
  );
  const primary = await primaryWorktree(repo.root);
  const here = await currentBranch(cwd);

  const worktrees = await listWorktrees(repo.root);
  const candidates: Candidate[] = [];
  let skippedDirty = 0;
  let skippedAhead = 0;

  for (const wt of worktrees) {
    if (wt.bare) continue;
    if (wt.path === primary.path) continue; // never the primary worktree
    if (!wt.branch || wt.detached) continue; // skip detached
    if (wt.branch === mainBranch) continue; // never the main branch

    const ab = await getAheadBehind(wt.path, wt.branch, mainBranch);
    if (!ab || ab.ahead > 0) {
      skippedAhead++;
      continue; // has unique commits not in main
    }

    const dirty = await getDirtyState(wt.path);
    if (!dirty.clean) {
      skippedDirty++;
      continue; // uncommitted work
    }

    candidates.push({ worktree: wt, branch: wt.branch });
  }

  if (candidates.length === 0) {
    info(
      `Nothing to prune — no merged, clean worktrees.` +
        summarySkips(skippedAhead, skippedDirty),
    );
    return 0;
  }

  // Preview.
  console.log(bold(`Prunable worktrees (merged into ${mainBranch}, clean):`));
  for (const c of candidates) {
    console.log(`  ${c.branch}  ${dim(c.worktree.path)}`);
  }
  console.log(dim(summarySkips(skippedAhead, skippedDirty).trimStart()));

  if (opts.dryRun) {
    info(`Dry run — nothing removed. Re-run without --dry-run to prune.`);
    return 0;
  }

  if (!opts.yes) {
    const ok = await confirm(
      `Remove ${candidates.length} worktree${
        candidates.length === 1 ? "" : "s"
      }${opts.keepBranch ? "" : " and their branches"}? [y/N] `,
    );
    if (!ok) {
      info("Aborted.");
      return 0;
    }
  }

  // Remove each candidate. If we're standing in one of them, hop to primary.
  let removed = 0;
  let movedShell = false;
  for (const c of candidates) {
    if (!opts.noHooks) {
      const pre = await runLifecycleHooks("pre-remove", config, {
        repo,
        defaultBranch: mainBranch,
        branch: c.branch,
        worktreePath: c.worktree.path,
        commit: c.worktree.head,
        base: mainBranch,
      }, { cwd: c.worktree.path, yes: opts.yes });
      if (!pre.ok) {
        warn(`Skipping ${c.branch}: pre-remove hook failed.`);
        continue;
      }
    }

    try {
      await removeWorktree(repo.root, c.worktree.path);
    } catch (err) {
      warn(
        `Could not remove ${c.branch}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      continue;
    }

    if (!opts.keepBranch) {
      try {
        await deleteBranch(repo.root, c.branch, false);
      } catch {
        warn(`Removed worktree for ${c.branch}, but kept the branch.`);
      }
    }

    if (!opts.noHooks) {
      await runLifecycleHooks("post-remove", config, {
        repo,
        defaultBranch: mainBranch,
        branch: c.branch,
        worktreePath: c.worktree.path,
        commit: c.worktree.head,
        base: mainBranch,
      }, { cwd: primary.path, yes: opts.yes });
    }

    if (c.branch === here) movedShell = true;
    removed++;
  }

  success(
    `Pruned ${removed} worktree${removed === 1 ? "" : "s"}` +
      `${opts.keepBranch ? " (branches kept)" : ""}.`,
  );

  // If we pruned the worktree we were standing in, move the shell to primary.
  if (movedShell) await requestCd(primary.path, opts.cd);

  return 0;
}

function summarySkips(ahead: number, dirty: number): string {
  const parts: string[] = [];
  if (ahead) parts.push(`${ahead} ahead of main`);
  if (dirty) parts.push(`${dirty} with uncommitted changes`);
  return parts.length ? `  (skipped: ${parts.join(", ")})` : "";
}

/** Read a yes/no answer from stdin (works with piped input). */
async function confirm(prompt: string): Promise<boolean> {
  await Deno.stderr.write(new TextEncoder().encode(prompt));
  const buf = new Uint8Array(1);
  const dec = new TextDecoder();
  let line = "";
  while (true) {
    const n = await Deno.stdin.read(buf);
    if (n === null) break;
    const ch = dec.decode(buf.subarray(0, n));
    if (ch === "\n") break;
    line += ch;
  }
  const a = line.trim().toLowerCase();
  return a === "y" || a === "yes";
}
