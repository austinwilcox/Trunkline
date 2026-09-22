/**
 * Stack navigation: `tl up`, `tl down`, `tl top`, `tl bottom`, `tl trunk`.
 *
 * Each resolves a target branch from the stack graph relative to the current
 * branch, then reuses `runSwitch` to move to that branch's worktree (creating
 * it lazily if it doesn't exist yet, and using the shell `cd` wrapper).
 */

import { resolveStackContext } from "./stack.ts";
import { runSwitch } from "./switch.ts";
import { baseOf, bottomOf, childrenOf, topsOf } from "../../stack/graph.ts";
import { isTracked, type StackState } from "../../stack/store.ts";
import { type CdChannel } from "../../util/cd.ts";
import { error, info } from "../../util/log.ts";

export type NavDirection = "up" | "down" | "top" | "bottom" | "trunk";

export interface NavOptions {
  direction: NavDirection;
  /** Steps for up/down (default 1). */
  count?: number;
  cd: CdChannel;
  cwd?: string;
}

export async function runNav(opts: NavOptions): Promise<number> {
  const cwd = opts.cwd ?? Deno.cwd();
  const ctx = await resolveStackContext(cwd);
  const { state, trunk, branch } = ctx;

  const target = resolveTarget(
    opts.direction,
    state,
    trunk,
    branch,
    opts.count ?? 1,
  );

  if (target.error) {
    error(target.error);
    return 1;
  }
  if (!target.branch || target.branch === branch) {
    info(`Already at ${branch ?? "the requested branch"}.`);
    return 0;
  }

  // Reuse switch: creates the worktree on demand and moves the shell.
  return await runSwitch({
    branch: target.branch,
    create: true,
    cd: opts.cd,
    cwd,
  });
}

interface TargetResult {
  branch?: string;
  error?: string;
}

/** Resolve the destination branch for a navigation direction. */
export function resolveTarget(
  direction: NavDirection,
  state: StackState,
  trunk: string,
  current: string | null,
  count: number,
): TargetResult {
  if (direction === "trunk") return { branch: trunk };

  // For up/down/top/bottom we need to know where we are in the graph.
  const onTrunk = current === trunk;

  switch (direction) {
    case "up": {
      // From trunk, "up" means into a stack (a child of trunk).
      let cursor = current;
      for (let i = 0; i < count; i++) {
        const children = onTrunkAware(state, trunk, cursor);
        if (children.length === 0) {
          return i === 0
            ? { error: `No branch above ${cursor ?? trunk}.` }
            : { branch: cursor ?? undefined };
        }
        if (children.length > 1) {
          return {
            error: `Multiple branches above ${cursor ?? trunk}: ${
              children.join(", ")
            }. Switch explicitly with 'tl switch <branch>'.`,
          };
        }
        cursor = children[0];
      }
      return { branch: cursor ?? undefined };
    }

    case "down": {
      if (onTrunk) return { error: "Already at the trunk." };
      if (!current || !isTracked(state, current)) {
        return { error: `'${current}' is not tracked; cannot go down.` };
      }
      let cursor: string | null = current;
      for (let i = 0; i < count && cursor; i++) {
        cursor = baseOf(state, cursor);
      }
      return { branch: cursor ?? trunk };
    }

    case "bottom": {
      if (!current || current === trunk) {
        return { error: "Not in a stack." };
      }
      const bottom = bottomOf(state, current);
      return bottom ? { branch: bottom } : { error: "Not in a stack." };
    }

    case "top": {
      const from = current && isTracked(state, current) ? current : null;
      if (from) {
        const tops = topsOf(state, from);
        if (tops.length === 1) return { branch: tops[0] };
        if (tops.length > 1) {
          return {
            error: `Multiple tops: ${
              tops.join(", ")
            }. Switch explicitly with 'tl switch <branch>'.`,
          };
        }
        return { branch: from };
      }
      // On trunk: only unambiguous if there's a single linear stack.
      const roots = childrenOf(state, trunk);
      if (roots.length === 0) return { error: "No tracked branches." };
      if (roots.length > 1) {
        return {
          error: `Multiple stacks: ${
            roots.join(", ")
          }. Enter one with 'tl switch <branch>'.`,
        };
      }
      const tops = topsOf(state, roots[0]);
      if (tops.length === 1) return { branch: tops[0] };
      return {
        error: `Multiple tops: ${tops.join(", ")}.`,
      };
    }
  }
}

/**
 * Children to move "up" into. From the trunk, that's the roots of each stack;
 * from a tracked branch, its children; from an untracked branch, nothing.
 */
function onTrunkAware(
  state: StackState,
  trunk: string,
  cursor: string | null,
): string[] {
  if (cursor === null || cursor === trunk) return childrenOf(state, trunk);
  if (!isTracked(state, cursor)) return [];
  return childrenOf(state, cursor);
}
