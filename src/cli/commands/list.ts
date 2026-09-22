/**
 * `tl list` — show every worktree with its status relative to the main branch.
 */

import { detectMainBranch, getRepoInfo } from "../../git/repo.ts";
import { listWorktrees, type Worktree } from "../../git/worktree.ts";
import { getWorktreeStatus, type WorktreeStatus } from "../../git/status.ts";
import { loadStackState, type StackState } from "../../stack/store.ts";
import { downstackOf } from "../../stack/graph.ts";
import { bold, dim, green, yellow } from "../../util/log.ts";

export interface ListOptions {
  cwd?: string;
  json?: boolean;
  /** Indent branches by their stack depth (using the stack graph). */
  stack?: boolean;
}

interface Row {
  worktree: Worktree;
  status: WorktreeStatus;
  isCurrent: boolean;
  isMain: boolean;
  /** Stack depth for indentation (0 = trunk or untracked). */
  depth: number;
}

export async function runList(opts: ListOptions = {}): Promise<number> {
  const cwd = opts.cwd ?? Deno.cwd();
  const repo = await getRepoInfo(cwd);
  const mainBranch = await detectMainBranch(repo.root);
  const worktrees = await listWorktrees(repo.root);
  const currentRoot = repo.root;

  // In --stack mode, load the graph to compute per-branch depth + ordering.
  const state = opts.stack ? await loadStackState(repo.gitCommonDir) : null;

  let rows: Row[] = [];
  for (const wt of worktrees) {
    if (wt.bare) continue;
    const status = await getWorktreeStatus(wt.path, wt.branch, mainBranch);
    rows.push({
      worktree: wt,
      status,
      isCurrent: wt.path === currentRoot,
      isMain: wt.branch === mainBranch,
      depth: state ? stackDepth(state, wt.branch, mainBranch) : 0,
    });
  }

  if (state) rows = orderByStack(rows, state, mainBranch);

  if (opts.json) {
    console.log(JSON.stringify(rows, null, 2));
    return 0;
  }

  printTable(rows, mainBranch, Boolean(opts.stack));
  return 0;
}

/**
 * Depth of a branch in the stack = number of tracked ancestors between it and
 * the trunk. The trunk and untracked branches are depth 0.
 */
function stackDepth(
  state: StackState,
  branch: string | null,
  trunk: string,
): number {
  if (!branch || branch === trunk || !(branch in state.branches)) return 0;
  // downstackOf includes the trunk at the end; count only tracked ancestors.
  return downstackOf(state, branch).filter((b) => b in state.branches).length +
    1;
}

/**
 * Order rows so a branch appears after its base: trunk first, then tracked
 * branches by ascending depth (stable within a depth), then untracked
 * worktrees. Keeps the flat set intact — only reorders for readability.
 */
function orderByStack(
  rows: Row[],
  state: StackState,
  trunk: string,
): Row[] {
  const rank = (r: Row): number => {
    if (r.worktree.branch === trunk) return -1; // trunk first
    if (r.worktree.branch && r.worktree.branch in state.branches) {
      return r.depth; // tracked: by depth
    }
    return 1000; // untracked worktrees last
  };
  return [...rows].sort((a, b) => rank(a) - rank(b));
}

function marker(row: Row): string {
  if (row.isCurrent) return "@";
  if (row.isMain) return "^";
  return " ";
}

/** The Branch cell, indented by stack depth when in --stack mode. */
function branchCell(row: Row, stackMode: boolean): string {
  const name = row.worktree.branch ?? dim("(detached)");
  if (!stackMode || row.depth <= 0) return name;
  return "  ".repeat(row.depth) + name;
}

function dirtyGlyph(status: WorktreeStatus): string {
  const d = status.dirty;
  if (d.clean) return dim("·");
  const parts: string[] = [];
  if (d.staged) parts.push(green("+"));
  if (d.unstaged) parts.push(yellow("*"));
  if (d.untracked) parts.push(dim("?"));
  return parts.join("");
}

function vsMainGlyph(status: WorktreeStatus): string {
  if (!status.vsMain) return dim("–");
  const { ahead, behind } = status.vsMain;
  const parts: string[] = [];
  if (ahead) parts.push(green(`↑${ahead}`));
  if (behind) parts.push(yellow(`↓${behind}`));
  return parts.length ? parts.join(" ") : dim("=");
}

function pushGlyph(status: WorktreeStatus): string {
  if (status.unpushed === null) return dim("–");
  return status.unpushed > 0 ? yellow(`⇡${status.unpushed}`) : dim("=");
}

function printTable(rows: Row[], mainBranch: string, stackMode: boolean): void {
  const header = [
    " ",
    bold("Branch"),
    bold("Dirty"),
    bold(`vs ${mainBranch}`),
    bold("Push"),
    bold("Commit"),
    bold("Age"),
    bold("Message"),
  ];

  const lines: string[][] = rows.map((row) => [
    marker(row),
    branchCell(row, stackMode),
    dirtyGlyph(row.status),
    vsMainGlyph(row.status),
    pushGlyph(row.status),
    row.status.commit.shortSha,
    row.status.commit.age,
    truncate(row.status.commit.subject, 48),
  ]);

  const table = [header, ...lines];
  const widths = colWidths(table);

  for (const cols of table) {
    const rendered = cols
      .map((c, i) => pad(c, widths[i]))
      .join("  ")
      .trimEnd();
    console.log(rendered);
  }

  const changed = rows.filter((r) => !r.status.dirty.clean).length;
  const ahead = rows.filter((r) => (r.status.vsMain?.ahead ?? 0) > 0).length;
  console.log(
    dim(
      `\nShowing ${rows.length} worktree${rows.length === 1 ? "" : "s"}, ` +
        `${changed} with changes, ${ahead} ahead`,
    ),
  );
}

// --- small formatting helpers (ANSI-aware) ---

// deno-lint-ignore no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

function visibleWidth(s: string): number {
  return s.replace(ANSI, "").length;
}

function colWidths(rows: string[][]): number[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, visibleWidth(cell));
    });
  }
  return widths;
}

function pad(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - visibleWidth(s)));
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
