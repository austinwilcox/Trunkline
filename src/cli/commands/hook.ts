/**
 * `tl hook <type> [names...]` — run configured hooks on demand.
 *
 * Useful for testing hooks, running them in CI, or re-running after a failure.
 *
 *   tl hook show                 Show configured hooks
 *   tl hook post-start           Run all post-start hooks
 *   tl hook pre-merge test build Run only hooks named "test" and "build"
 *   tl hook pre-start user:      Run all user hooks
 *   tl hook pre-start project:x  Run project hook "x"
 *   tl hook post-start --foreground   Run a background hook inline
 *   tl hook pre-start --dry-run  Preview commands without running
 *   tl hook pre-start --yes      Skip approval prompts
 */

import { detectMainBranch, getRepoInfo } from "../../git/repo.ts";
import { currentBranch } from "../../git/worktree.ts";
import { loadConfig } from "../../config/load.ts";
import { HOOK_TYPES, type HookType, isHookType } from "../../config/schema.ts";
import {
  buildPlans,
  filterPlanByNames,
  type HookPlan,
} from "../../hooks/model.ts";
import { gateProjectHooks } from "../../hooks/gate.ts";
import { buildVars, type LifecycleVars } from "../../hooks/lifecycle.ts";
import { runHooks } from "../../hooks/run.ts";
import { bold, dim, error, info } from "../../util/log.ts";

export interface HookCommandOptions {
  args: string[];
  foreground?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  cwd?: string;
}

export async function runHookCommand(
  opts: HookCommandOptions,
): Promise<number> {
  const [typeArg, ...filters] = opts.args;

  if (!typeArg) {
    error(`Usage: tl hook <show|${HOOK_TYPES.join("|")}> [names...]`);
    return 2;
  }

  const cwd = opts.cwd ?? Deno.cwd();
  const repo = await getRepoInfo(cwd);
  const config = await loadConfig(repo.root);

  if (typeArg === "show") {
    return showHooks(config.hooks);
  }

  if (!isHookType(typeArg)) {
    error(`Unknown hook type '${typeArg}'. One of: ${HOOK_TYPES.join(", ")}`);
    return 2;
  }
  const type: HookType = typeArg;

  const sourced = config.hooks[type];
  if (!sourced || sourced.length === 0) {
    info(`No ${type} hooks configured.`);
    return 0;
  }

  let plans = buildPlans(sourced);
  plans = applyFilters(plans, filters);
  if (plans.every((p) => p.steps.length === 0)) {
    info(`No matching ${type} hooks.`);
    return 0;
  }

  // Gate project hooks (respects --yes), unless dry-run (preview only).
  if (!opts.dryRun) {
    plans = await gateProjectHooks(type, plans, {
      repoPath: repo.root,
      yes: opts.yes,
    });
    if (plans.every((p) => p.steps.length === 0)) return 0;
  }

  const branch = await currentBranch(cwd);
  const defaultBranch = await detectMainBranch(
    repo.root,
    config.settings["main-branch"],
  );
  const vars: LifecycleVars = {
    repo,
    defaultBranch,
    branch,
    worktreePath: repo.root,
    base: defaultBranch,
  };

  const outcome = await runHooks(type, plans, {
    vars: buildVars(vars),
    cwd: repo.root,
    gitCommonDir: repo.gitCommonDir,
  }, { foreground: opts.foreground, dryRun: opts.dryRun });

  return outcome.ok ? 0 : 1;
}

/**
 * Apply `user:`/`project:` source prefixes and/or name filters.
 *
 * - `user:` / `project:`      → keep only that source (all its commands)
 * - `user:name`/`project:name`→ that source's command named `name`
 * - bare `name`               → commands named `name` from any source
 */
function applyFilters(plans: HookPlan[], filters: string[]): HookPlan[] {
  if (filters.length === 0) return plans;

  const sourceAll = new Set<string>();
  const bySource: Record<string, string[]> = { user: [], project: [] };
  const bareNames: string[] = [];

  for (const f of filters) {
    if (f === "user:" || f === "project:") {
      sourceAll.add(f.slice(0, -1));
    } else if (f.startsWith("user:") || f.startsWith("project:")) {
      const [src, name] = f.split(":");
      bySource[src].push(name);
    } else {
      bareNames.push(f);
    }
  }

  return plans
    .map((plan) => {
      if (sourceAll.has(plan.source)) return plan;
      const names = [...bareNames, ...bySource[plan.source]];
      if (names.length === 0) {
        return { source: plan.source, steps: [] };
      }
      return filterPlanByNames(plan, names);
    })
    .filter((p) => p.steps.length > 0);
}

function showHooks(
  hooks: Record<string, unknown>,
): number {
  const types = Object.keys(hooks);
  if (types.length === 0) {
    console.log(dim("No hooks configured."));
    return 0;
  }
  for (const [type, sourced] of Object.entries(hooks)) {
    for (const s of (sourced as Array<{ source: string; form: unknown }>)) {
      console.log(
        `${bold(type)} (${s.source}): ${
          typeof s.form === "string" ? s.form : JSON.stringify(s.form)
        }`,
      );
    }
  }
  return 0;
}
