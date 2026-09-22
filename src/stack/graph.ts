/**
 * Stack graph traversal over {@link StackState}.
 *
 * The graph is a tree rooted at the trunk branch. Each tracked branch has one
 * base; a branch may have multiple children. All functions here are pure.
 *
 * Vocabulary (docs/STACKS.md §2):
 *   - downstack: ancestors toward trunk (base, base's base, ...)
 *   - upstack:   descendants (children, grandchildren, ...)
 */

import type { StackState } from "./store.ts";

/** The base of `branch`, or null if it isn't tracked. */
export function baseOf(state: StackState, branch: string): string | null {
  return state.branches[branch]?.base ?? null;
}

/** Direct children of `branch` (branches whose base is `branch`). */
export function childrenOf(state: StackState, branch: string): string[] {
  return Object.entries(state.branches)
    .filter(([, node]) => node.base === branch)
    .map(([name]) => name)
    .sort();
}

/**
 * Ancestors from `branch` toward the trunk, nearest first, excluding `branch`.
 * Stops at the trunk (which is not a tracked node). Guards against cycles.
 */
export function downstackOf(state: StackState, branch: string): string[] {
  const chain: string[] = [];
  const seen = new Set<string>([branch]);
  let current = baseOf(state, branch);
  while (current && state.branches[current] && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = baseOf(state, current);
  }
  // Include the final base (often the trunk) if it isn't a tracked node.
  if (current && !state.branches[current] && !seen.has(current)) {
    chain.push(current);
  }
  return chain;
}

/**
 * All descendants of `branch` (its upstack), breadth-first, excluding `branch`.
 */
export function upstackOf(state: StackState, branch: string): string[] {
  const result: string[] = [];
  const queue = [...childrenOf(state, branch)];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const b = queue.shift()!;
    if (seen.has(b)) continue;
    seen.add(b);
    result.push(b);
    queue.push(...childrenOf(state, b));
  }
  return result;
}

/** The trunk-ward root a branch ultimately rests on (the implicit trunk). */
export function rootBaseOf(state: StackState, branch: string): string | null {
  const chain = downstackOf(state, branch);
  return chain.length > 0 ? chain[chain.length - 1] : baseOf(state, branch);
}

/**
 * The topmost branch(es) above `branch`. A stack may fan out, so this returns
 * every leaf reachable upward. Callers prompt when there's more than one.
 */
export function topsOf(state: StackState, branch: string): string[] {
  const up = upstackOf(state, branch);
  const candidates = up.length > 0 ? up : [branch];
  return candidates.filter((b) => childrenOf(state, b).length === 0);
}

/**
 * The bottommost non-trunk branch under `branch` (nearest to trunk). This is
 * the branch whose base is the trunk on `branch`'s downstack path.
 */
export function bottomOf(state: StackState, branch: string): string | null {
  if (!state.branches[branch]) return null;
  const chain = [branch, ...downstackOf(state, branch)];
  // The last tracked entry before the trunk.
  for (let i = chain.length - 1; i >= 0; i--) {
    if (state.branches[chain[i]]) return chain[i];
  }
  return null;
}

/**
 * All branches in `branch`'s stack (its whole tree component), including the
 * branch itself but not the trunk, ordered bottom-up (a branch always appears
 * after its base). Suitable for restack ordering.
 */
export function stackOf(state: StackState, branch: string): string[] {
  // Find the bottom, then collect that subtree top-down and sort bottom-up.
  const bottom = bottomOf(state, branch);
  if (!bottom) return [];
  const all = [bottom, ...upstackOf(state, bottom)];
  return topoSort(state, all);
}

/** Order `branches` so each appears after its base (bottom-up). */
export function topoSort(state: StackState, branches: string[]): string[] {
  const set = new Set(branches);
  const depth = (b: string): number => downstackOf(state, b).length;
  // Sorting by downstack depth guarantees bases precede dependents.
  return [...set].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
}
