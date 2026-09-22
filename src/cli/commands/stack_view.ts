/**
 * Render a stack as an indented tree, rooted at the trunk, with per-branch
 * status (ahead of its base, dirty) drawn from the worktree when one exists.
 */

import type { StackContext } from "./stack.ts";
import { childrenOf, rootBases } from "../../stack/graph.ts";
import { findWorktreeByBranch } from "../../git/worktree.ts";
import { commitsAhead } from "../../git/worktree.ts";
import { getDirtyState } from "../../git/status.ts";
import { bold, dim, green, yellow } from "../../util/log.ts";

/**
 * Build a tree string for all tracked stacks. Renders the trunk first, then any
 * "orphan roots" — untracked bases that anchor tracked branches whose chain
 * doesn't reach the trunk through the graph.
 */
export async function renderStackTree(
  ctx: StackContext,
  cwd: string,
): Promise<string> {
  const { state, trunk, branch: current } = ctx;
  const lines: string[] = [];

  const roots = rootBases(state, trunk);
  for (const root of roots) {
    const label = root === trunk ? dim("(trunk)") : dim("(untracked base)");
    lines.push(`${marker(root, current, trunk)} ${bold(root)} ${label}`);
    for (const child of childrenOf(state, root)) {
      await renderSubtree(ctx, cwd, child, 1, lines, current);
    }
  }

  if (Object.keys(state.branches).length === 0) {
    lines.push(dim("  (no tracked branches — use 'tl stack track')"));
  }
  return lines.join("\n");
}

async function renderSubtree(
  ctx: StackContext,
  cwd: string,
  branch: string,
  depth: number,
  lines: string[],
  current: string | null,
): Promise<void> {
  const indent = "  ".repeat(depth);
  const status = await branchStatus(ctx, cwd, branch);
  lines.push(
    `${indent}${marker(branch, current, ctx.trunk)} ${branch}${status}`,
  );
  for (const child of childrenOf(ctx.state, branch)) {
    await renderSubtree(ctx, cwd, child, depth + 1, lines, current);
  }
}

function marker(
  branch: string,
  current: string | null,
  trunk: string,
): string {
  if (branch === current) return "@";
  if (branch === trunk) return "^";
  return " ";
}

/** " ↑N +*" style suffix: commits ahead of base, and dirty glyphs. */
async function branchStatus(
  ctx: StackContext,
  cwd: string,
  branch: string,
): Promise<string> {
  const base = ctx.state.branches[branch]?.base;
  const wt = await findWorktreeByBranch(ctx.repo.root, branch);
  const parts: string[] = [];

  if (base) {
    const ahead = await commitsAhead(cwd, base, branch);
    if (ahead > 0) parts.push(green(`↑${ahead}`));
  }

  if (wt) {
    const dirty = await getDirtyState(wt.path);
    if (!dirty.clean) {
      const glyphs = [
        dirty.staged ? green("+") : "",
        dirty.unstaged ? yellow("*") : "",
        dirty.untracked ? dim("?") : "",
      ].join("");
      if (glyphs) parts.push(glyphs);
    }
  } else {
    parts.push(dim("(no worktree)"));
  }

  return parts.length ? "  " + parts.join(" ") : "";
}
