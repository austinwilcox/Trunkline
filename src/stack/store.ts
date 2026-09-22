/**
 * Per-repo stacked-branch graph store.
 *
 * Records the base (parent) of each tracked branch so trunkline can derive
 * stacks. The trunk branch is implicit (the root) and never stored. State lives
 * at `<gitCommonDir>/tl/stack.json`, shared across worktrees, never committed
 * (see docs/STACKS.md §3).
 */

import { stackStatePath } from "../util/paths.ts";

export interface BranchNode {
  /** The branch this one is stacked on (another tracked branch or the trunk). */
  base: string;
}

export interface StackState {
  version: 1;
  /** Tracked branches keyed by name. Trunk is not present here. */
  branches: Record<string, BranchNode>;
}

export function emptyState(): StackState {
  return { version: 1, branches: {} };
}

/** Load the stack state for a repo, or an empty state if none exists. */
export async function loadStackState(
  gitCommonDir: string,
): Promise<StackState> {
  const path = stackStatePath(gitCommonDir);
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return emptyState();
    throw err;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Failed to parse stack state ${path}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return validateState(raw, path);
}

/** Persist stack state (creating parent dirs). */
export async function saveStackState(
  gitCommonDir: string,
  state: StackState,
): Promise<void> {
  const path = stackStatePath(gitCommonDir);
  const dir = path.slice(0, path.lastIndexOf("/"));
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify(state, null, 2) + "\n");
}

/** Validate a parsed object into a StackState, rejecting malformed input. */
export function validateState(raw: unknown, path: string): StackState {
  if (!raw || typeof raw !== "object") {
    throw new Error(`${path}: stack state must be an object`);
  }
  const obj = raw as Record<string, unknown>;
  const branchesRaw = obj.branches;
  if (branchesRaw !== undefined && typeof branchesRaw !== "object") {
    throw new Error(`${path}: 'branches' must be an object`);
  }

  const branches: Record<string, BranchNode> = {};
  for (const [name, node] of Object.entries(branchesRaw ?? {})) {
    if (!node || typeof node !== "object") {
      throw new Error(`${path}: branch '${name}' must be an object`);
    }
    const base = (node as Record<string, unknown>).base;
    if (typeof base !== "string" || base.length === 0) {
      throw new Error(`${path}: branch '${name}' must have a string 'base'`);
    }
    branches[name] = { base };
  }
  return { version: 1, branches };
}

// --- mutation helpers (pure; operate on an in-memory state) ---

/** True if a branch is tracked in the stack. */
export function isTracked(state: StackState, branch: string): boolean {
  return branch in state.branches;
}

/** Track `branch` with the given `base`. Overwrites an existing entry. */
export function track(
  state: StackState,
  branch: string,
  base: string,
): void {
  state.branches[branch] = { base };
}

/**
 * Untrack `branch`, retargeting any children onto the untracked branch's base
 * so the tree stays connected (git-spice's default behavior).
 *
 * @returns the names of children that were retargeted.
 */
export function untrack(state: StackState, branch: string): string[] {
  const node = state.branches[branch];
  if (!node) return [];
  const retargeted: string[] = [];
  for (const [name, child] of Object.entries(state.branches)) {
    if (child.base === branch) {
      child.base = node.base;
      retargeted.push(name);
    }
  }
  delete state.branches[branch];
  return retargeted;
}
