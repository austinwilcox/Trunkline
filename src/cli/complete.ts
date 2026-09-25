/**
 * `tl __complete <words...>` — hidden subcommand that emits completion
 * candidates, one per line, for the shell completion scripts to consume.
 *
 * The shell passes the words typed so far (excluding `tl` itself). The last
 * word is the partial token being completed (may be empty). We resolve:
 *   - position 1: subcommand names (+ aliases)
 *   - branch-taking commands: local branch names, prefix-filtered
 *   - a leading '-' : relevant flags
 *
 * Output is plain lines; failures print nothing (completion must never error).
 */

import { getRepoInfo } from "../git/repo.ts";
import { listBranches } from "../git/worktree.ts";

/** Top-level subcommands offered at position 1. */
const SUBCOMMANDS = [
  "list",
  "switch",
  "remove",
  "hook",
  "config",
  "init",
  "stack",
  "up",
  "down",
  "top",
  "bottom",
  "trunk",
];

const ALIASES = ["ls", "sw", "s", "rm"];

/** Commands whose next positional argument is a branch name. */
const BRANCH_COMMANDS = new Set([
  "switch",
  "sw",
  "s",
  "remove",
  "rm",
]);

/** Per-command flag suggestions (shown when the token starts with '-'). */
const FLAGS: Record<string, string[]> = {
  switch: ["--create", "--base", "--execute", "--stack", "--no-hooks", "--yes"],
  remove: ["--force", "--keep-branch", "--no-hooks", "--yes"],
  list: ["--json", "--stack"],
  hook: ["--foreground", "--dry-run", "--yes"],
  config: ["--shell", "--print", "--repo"],
  init: ["--force"],
};

export interface CompleteOptions {
  /** Words typed after `tl` (the last one is the partial token). */
  words: string[];
  cwd?: string;
}

/**
 * Resolve candidates and print them (one per line). Returns 0 always —
 * completion must not fail the shell.
 */
export async function runComplete(opts: CompleteOptions): Promise<number> {
  try {
    const candidates = await resolve(opts.words, opts.cwd ?? Deno.cwd());
    if (candidates.length > 0) console.log(candidates.join("\n"));
  } catch {
    // Silent: emit nothing on error.
  }
  return 0;
}

/** Pure resolution of candidates for a set of words. Exposed for testing. */
export async function resolve(
  words: string[],
  cwd: string,
): Promise<string[]> {
  // `words` includes the partial token as its last element. If the line ended
  // with a space, the shell passes a trailing empty token.
  const current = words.length > 0 ? words[words.length - 1] : "";
  const command = words.length > 0 ? words[0] : "";

  // Completing the subcommand itself (position 1).
  if (words.length <= 1) {
    return prefixFilter([...SUBCOMMANDS, ...ALIASES], current);
  }

  // Flags for the current command.
  if (current.startsWith("-")) {
    return prefixFilter(FLAGS[canonical(command)] ?? [], current);
  }

  // Branch-name completion for branch-taking commands.
  if (BRANCH_COMMANDS.has(command)) {
    const branches = await branchesFor(cwd);
    return prefixFilterCI(branches, current);
  }

  // `stack track/untrack [branch]` — complete branch on the 2nd positional.
  if (command === "stack") {
    const sub = words[1];
    if ((sub === "track" || sub === "untrack") && words.length >= 3) {
      const branches = await branchesFor(cwd);
      return prefixFilterCI(branches, current);
    }
    if (words.length <= 2) {
      return prefixFilter(["show", "track", "untrack"], current);
    }
  }

  return [];
}

function canonical(cmd: string): string {
  const map: Record<string, string> = {
    ls: "list",
    sw: "switch",
    s: "switch",
    rm: "remove",
  };
  return map[cmd] ?? cmd;
}

async function branchesFor(cwd: string): Promise<string[]> {
  const repo = await getRepoInfo(cwd);
  return await listBranches(repo.root);
}

/** Case-sensitive prefix filter. */
function prefixFilter(items: string[], prefix: string): string[] {
  if (!prefix) return items;
  return items.filter((i) => i.startsWith(prefix));
}

/** Case-insensitive prefix filter (nicer for branch names). */
function prefixFilterCI(items: string[], prefix: string): string[] {
  if (!prefix) return items;
  const p = prefix.toLowerCase();
  return items.filter((i) => i.toLowerCase().startsWith(p));
}
