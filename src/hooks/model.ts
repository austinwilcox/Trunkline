/**
 * Normalize the three TOML hook forms into a uniform execution plan.
 *
 * Forms (see DESIGN.md §5):
 *   - string                    → one step, one unnamed command
 *   - table {name: cmd}         → one step, commands run concurrently
 *   - array of tables [[hook]]  → many steps run in order; commands within a
 *                                 step run concurrently
 *
 * The result is always a list of steps; each step is a list of named commands.
 */

import type { HookForm } from "../config/schema.ts";
import type { HookSource, SourcedHook } from "../config/load.ts";

export interface HookCommand {
  /** Command name (table key), or null for a bare string hook. */
  name: string | null;
  /** The raw (un-rendered) command template. */
  template: string;
}

export interface HookStep {
  commands: HookCommand[];
}

/** A normalized plan for one hook source (user or project). */
export interface HookPlan {
  source: HookSource;
  steps: HookStep[];
}

/** Normalize a single hook form into ordered steps. */
export function normalizeForm(form: HookForm): HookStep[] {
  // string → single unnamed command
  if (typeof form === "string") {
    return [{ commands: [{ name: null, template: form }] }];
  }

  // array of tables → one step per table, in order
  if (Array.isArray(form)) {
    return form.map((table) => ({ commands: tableToCommands(table) }));
  }

  // table → single step, concurrent commands
  return [{ commands: tableToCommands(form) }];
}

function tableToCommands(table: Record<string, string>): HookCommand[] {
  return Object.entries(table).map(([name, template]) => ({
    name,
    template,
  }));
}

/** Build ordered plans for a hook type from its sourced definitions. */
export function buildPlans(sourced: SourcedHook[]): HookPlan[] {
  return sourced.map((s) => ({
    source: s.source,
    steps: normalizeForm(s.form),
  }));
}

/** Filter a plan's commands to a set of names (for `tl hook <type> name`). */
export function filterPlanByNames(
  plan: HookPlan,
  names: string[],
): HookPlan {
  if (names.length === 0) return plan;
  const wanted = new Set(names);
  const steps = plan.steps
    .map((step) => ({
      commands: step.commands.filter((c) => c.name && wanted.has(c.name)),
    }))
    .filter((step) => step.commands.length > 0);
  return { source: plan.source, steps };
}
