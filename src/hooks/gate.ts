/**
 * Approval gate for project hooks.
 *
 * Given the normalized plans for a hook type, this filters out project-sourced
 * commands that have not been approved for this repo. User-sourced commands are
 * always allowed. On first encounter of unapproved project commands, the user
 * is prompted; approving records the command's hash so subsequent runs are
 * silent until the command text changes.
 *
 * Semantics (matching worktrunk):
 *   - `--yes` bypasses prompting and allows everything.
 *   - Declining skips *all* project commands for this operation (approved or
 *     not) but leaves saved approvals untouched.
 */

import type { HookPlan } from "./model.ts";
import type { HookType } from "../config/schema.ts";
import {
  addApproval,
  type ApprovalsStore,
  hashCommand,
  isApproved,
  loadApprovals,
  saveApprovals,
} from "../config/approvals.ts";
import { bold, warn } from "../util/log.ts";

/** Prompt function: returns true to allow-and-remember, false to decline. */
export type ApprovalPrompt = (
  repoPath: string,
  pending: PendingCommand[],
) => Promise<boolean>;

export interface PendingCommand {
  type: HookType;
  name: string;
  template: string;
  hash: string;
}

export interface GateOptions {
  repoPath: string;
  /** Bypass prompting and allow all commands (`--yes`). */
  yes?: boolean;
  /** Prompt implementation (defaults to an interactive stdin prompt). */
  prompt?: ApprovalPrompt;
  /** Approvals path override (tests). */
  approvalsPath?: string;
}

/**
 * Filter `plans` to the commands allowed to run.
 *
 * Returns the (possibly reduced) plans. User plans pass through untouched.
 */
export async function gateProjectHooks(
  type: HookType,
  plans: HookPlan[],
  opts: GateOptions,
): Promise<HookPlan[]> {
  const projectPlans = plans.filter((p) => p.source === "project");
  if (projectPlans.length === 0) return plans; // nothing to gate

  const store = opts.yes
    ? { byRepo: {} } as ApprovalsStore
    : await loadApprovals(opts.approvalsPath);

  // Determine which project commands still need approval.
  const pending: PendingCommand[] = [];
  for (const plan of projectPlans) {
    for (const step of plan.steps) {
      for (const c of step.commands) {
        const hash = await hashCommand(c.template);
        const name = c.name ?? "";
        if (
          !opts.yes &&
          !isApproved(store, opts.repoPath, type, name, hash)
        ) {
          pending.push({ type, name, template: c.template, hash });
        }
      }
    }
  }

  // With --yes, or when everything is already approved, run as-is.
  if (opts.yes || pending.length === 0) return plans;

  const prompt = opts.prompt ?? interactivePrompt;
  const allowed = await prompt(opts.repoPath, pending);

  if (!allowed) {
    // Decline: drop every project plan for this operation; keep user plans.
    warn("Declined — skipping all project hooks for this operation.");
    return plans.filter((p) => p.source !== "project");
  }

  // Approve-and-remember: persist the pending hashes.
  for (const p of pending) {
    addApproval(store, opts.repoPath, {
      type: p.type,
      name: p.name,
      hash: p.hash,
    });
  }
  await saveApprovals(store, opts.approvalsPath);
  return plans;
}

/** Default interactive prompt reading a single line from stdin. */
async function interactivePrompt(
  repoPath: string,
  pending: PendingCommand[],
): Promise<boolean> {
  const repoName = repoPath.slice(repoPath.lastIndexOf("/") + 1);
  console.error(
    warnLine(
      `${repoName} needs approval to execute ${pending.length} command(s):`,
    ),
  );
  for (const p of pending) {
    console.error(`  ○ ${p.type}${p.name ? " " + bold(p.name) : ""}:`);
    console.error(`     ${p.template}`);
  }
  await Deno.stderr.write(
    new TextEncoder().encode("❯ Allow and remember? [y/N] "),
  );

  const answer = (await readLine())?.trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

/** Read a single line from stdin, or null on EOF. */
async function readLine(): Promise<string | null> {
  const decoder = new TextDecoder();
  const buf = new Uint8Array(1);
  let line = "";
  while (true) {
    const n = await Deno.stdin.read(buf);
    if (n === null) return line.length > 0 ? line : null;
    const ch = decoder.decode(buf.subarray(0, n));
    if (ch === "\n") break;
    line += ch;
  }
  return line;
}

function warnLine(msg: string): string {
  return `▲ ${msg}`;
}
