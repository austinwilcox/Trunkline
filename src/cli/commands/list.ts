/**
 * `tl list` — show every worktree with its status relative to the main branch.
 */

import { detectMainBranch, getRepoInfo } from "../../git/repo.ts";
import { listWorktrees, type Worktree } from "../../git/worktree.ts";
import { getWorktreeStatus, type WorktreeStatus } from "../../git/status.ts";
import { bold, dim, green, yellow } from "../../util/log.ts";

export interface ListOptions {
  cwd?: string;
  json?: boolean;
}

interface Row {
  worktree: Worktree;
  status: WorktreeStatus;
  isCurrent: boolean;
  isMain: boolean;
}

export async function runList(opts: ListOptions = {}): Promise<number> {
  const cwd = opts.cwd ?? Deno.cwd();
  const repo = await getRepoInfo(cwd);
  const mainBranch = await detectMainBranch(repo.root);
  const worktrees = await listWorktrees(repo.root);
  const currentRoot = repo.root;

  const rows: Row[] = [];
  for (const wt of worktrees) {
    if (wt.bare) continue;
    const status = await getWorktreeStatus(wt.path, wt.branch, mainBranch);
    rows.push({
      worktree: wt,
      status,
      isCurrent: wt.path === currentRoot,
      isMain: wt.branch === mainBranch,
    });
  }

  if (opts.json) {
    console.log(JSON.stringify(rows, null, 2));
    return 0;
  }

  printTable(rows, mainBranch);
  return 0;
}

function marker(row: Row): string {
  if (row.isCurrent) return "@";
  if (row.isMain) return "^";
  return " ";
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

function printTable(rows: Row[], mainBranch: string): void {
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
    row.worktree.branch ?? dim("(detached)"),
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
