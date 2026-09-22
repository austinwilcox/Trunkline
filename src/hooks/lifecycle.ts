/**
 * High-level lifecycle-hook entrypoint used by commands.
 *
 * Ties config → normalized plans → execution, and builds the template context
 * (repo + worktree + operation variables) shared by all hooks.
 */

import type { RepoInfo } from "../git/repo.ts";
import type { LoadedConfig } from "../config/load.ts";
import type { HookType } from "../config/schema.ts";
import type { TemplateContext } from "./template.ts";
import { buildPlans } from "./model.ts";
import { type HookOutcome, runHooks, type RunHooksOptions } from "./run.ts";
import { type ApprovalPrompt, gateProjectHooks } from "./gate.ts";
import { basename } from "@std/path";

export interface LifecycleVars {
  repo: RepoInfo;
  defaultBranch: string;
  /** Branch the operation acts on (destination for switch, source for remove). */
  branch: string | null;
  /** Absolute path of the worktree the operation acts on. */
  worktreePath: string;
  /** HEAD SHA of that worktree, if known. */
  commit?: string;
  /** Base/source branch for switch/create. */
  base?: string | null;
  /** Tokens forwarded from the CLI (after `--`). */
  args?: string[];
}

export interface RunLifecycleOptions extends RunHooksOptions {
  /** Directory hook commands run in (defaults to the worktree path). */
  cwd?: string;
  /** Bypass approval prompts for project hooks (`--yes`). */
  yes?: boolean;
  /** Prompt implementation override (tests). */
  prompt?: ApprovalPrompt;
  /** Approvals file path override (tests). */
  approvalsPath?: string;
}

/** Build the template variable context for a lifecycle event. */
export function buildVars(v: LifecycleVars): TemplateContext {
  const vars: TemplateContext = {
    repo: v.repo.name,
    repo_path: v.repo.root,
    default_branch: v.defaultBranch,
    worktree_path: v.worktreePath,
    worktree_name: basename(v.worktreePath),
    args: v.args ?? [],
  };
  if (v.branch) vars.branch = v.branch;
  if (v.commit) {
    vars.commit = v.commit;
    vars.short_commit = v.commit.slice(0, 12);
  }
  if (v.base) vars.base = v.base;
  return vars;
}

/**
 * Run every configured hook of `type` for this operation.
 *
 * Returns the outcome; callers should abort the operation when a blocking hook
 * returns `ok: false`.
 */
export async function runLifecycleHooks(
  type: HookType,
  config: LoadedConfig,
  vars: LifecycleVars,
  opts: RunLifecycleOptions = {},
): Promise<HookOutcome> {
  const sourced = config.hooks[type];
  if (!sourced || sourced.length === 0) return { ok: true, launched: 0 };

  const plans = buildPlans(sourced);

  // Gate project hooks through the approval system (user hooks pass through).
  const allowedPlans = await gateProjectHooks(type, plans, {
    repoPath: vars.repo.root,
    yes: opts.yes,
    prompt: opts.prompt,
    approvalsPath: opts.approvalsPath,
  });
  if (allowedPlans.every((p) => p.steps.length === 0)) {
    return { ok: true, launched: 0 };
  }

  const cwd = opts.cwd ?? vars.worktreePath;
  return await runHooks(type, allowedPlans, {
    vars: buildVars(vars),
    cwd,
    gitCommonDir: vars.repo.gitCommonDir,
  }, opts);
}
