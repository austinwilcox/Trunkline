/**
 * `tl prune` — remove worktrees whose branch is already merged into main.
 *
 * A worktree is prunable when:
 *   - it is not the primary worktree and not the main branch,
 *   - it has a branch (not detached),
 *   - its branch has landed in main — either **0 commits ahead** (regular
 *     merge / fast-forward) or its change is already in main as a **squash or
 *     rebase merge** (e.g. GitHub's "Squash and merge"), and
 *   - its working tree is clean (no uncommitted changes).
 *
 * Before checking, prune fetches `origin` (with `--prune`) and compares against
 * both the local main branch and `origin/<main>`, so PRs merged on GitHub are
 * detected without first pulling main locally.
 *
 * By default prune previews the candidates and asks for confirmation, since it
 * deletes worktrees and branches. Flags:
 *       --dry-run      list candidates and exit (never removes)
 *   -y, --yes          skip the confirmation prompt
 *       --keep-branch  remove the worktrees but keep the branches
 *       --no-fetch     skip fetching origin; compare against local refs only
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
import { git } from "../../git/exec.ts";
import {
  getAheadBehind,
  getDirtyState,
  isSquashMerged,
} from "../../git/status.ts";
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
  noFetch?: boolean;
  cd: CdChannel;
  cwd?: string;
}

interface Candidate {
  worktree: Worktree;
  branch: string;
  /** Landed via squash/rebase: git can't see it as merged, so force-delete. */
  squashed: boolean;
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
  const targets = await mergeTargets(repo.root, mainBranch, !opts.noFetch);

  const worktrees = await listWorktrees(repo.root);
  const candidates: Candidate[] = [];
  let skippedDirty = 0;
  let skippedAhead = 0;

  for (const wt of worktrees) {
    if (wt.bare) continue;
    if (wt.path === primary.path) continue; // never the primary worktree
    if (!wt.branch || wt.detached) continue; // skip detached
    if (wt.branch === mainBranch) continue; // never the main branch

    const landed = await landedIn(wt.path, wt.branch, targets);
    if (!landed) {
      skippedAhead++;
      continue; // has unique commits not in main
    }

    const dirty = await getDirtyState(wt.path);
    if (!dirty.clean) {
      skippedDirty++;
      continue; // uncommitted work
    }

    candidates.push({
      worktree: wt,
      branch: wt.branch,
      squashed: landed === "squashed",
    });
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
    const how = c.squashed ? dim(" (squash-merged)") : "";
    console.log(`  ${c.branch}${how}  ${dim(c.worktree.path)}`);
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
        // `git branch -d` rejects squash-merged branches (no ancestry), but
        // we've verified their change is in main, so force is safe here.
        await deleteBranch(repo.root, c.branch, c.squashed);
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

/**
 * Refs a branch may have landed in: local main, plus `origin/<main>` when an
 * origin remote exists (refreshed first, unless `fetch` is false).
 */
async function mergeTargets(
  root: string,
  mainBranch: string,
  fetch: boolean,
): Promise<string[]> {
  const targets = [mainBranch];
  const hasOrigin =
    (await git(["remote", "get-url", "origin"], { cwd: root, check: false }))
      .code === 0;
  if (!hasOrigin) return targets;

  if (fetch) {
    const res = await git(["fetch", "--prune", "--quiet", "origin"], {
      cwd: root,
      check: false,
    });
    if (res.code !== 0) {
      warn(`Could not fetch origin; using local refs. ${res.stderr.trim()}`);
    }
  }

  const remoteMain = `origin/${mainBranch}`;
  const exists = await git(
    ["rev-parse", "--verify", "--quiet", `${remoteMain}^{commit}`],
    { cwd: root, check: false },
  );
  if (exists.code === 0) targets.push(remoteMain);
  return targets;
}

/** How `branch` landed in any of `targets`, or null if it hasn't. */
async function landedIn(
  cwd: string,
  branch: string,
  targets: string[],
): Promise<"merged" | "squashed" | null> {
  for (const t of targets) {
    const ab = await getAheadBehind(cwd, branch, t);
    if (ab && ab.ahead === 0) return "merged";
  }
  for (const t of targets) {
    if (await isSquashMerged(cwd, branch, t)) return "squashed";
  }
  return null;
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
