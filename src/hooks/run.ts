/**
 * Execute hook plans.
 *
 * `pre-*` hooks are blocking: steps run in order, commands within a step run
 * concurrently, and a non-zero exit aborts the operation. `post-*` hooks run in
 * the background: each command is spawned detached with stdout/stderr sent to a
 * log file under `.git/tl/logs/`, and we do not wait for them.
 *
 * Every command is executed via the platform shell (`sh -c` / `cmd /c`) so
 * users can write ordinary shell one-liners. Rendered template variables are
 * shell-escaped; the full context is also provided as JSON on stdin.
 */

import { join } from "@std/path";
import { render, type TemplateContext } from "./template.ts";
import { type HookPlan, type HookStep } from "./model.ts";
import { type HookType, isBlocking } from "../config/schema.ts";
import { logDir } from "../util/paths.ts";
import { error, info } from "../util/log.ts";

export interface HookRunContext {
  /** Template variables (branch, worktree_path, repo, ...). */
  vars: TemplateContext;
  /** Directory hook commands run in. */
  cwd: string;
  /** Git common dir, for locating the log directory. */
  gitCommonDir: string;
}

export interface RunHooksOptions {
  /** Force background hooks to run inline (blocking) instead. */
  foreground?: boolean;
  /** Render commands but do not execute them. */
  dryRun?: boolean;
}

export interface HookOutcome {
  /** True if all blocking commands succeeded (always true for background). */
  ok: boolean;
  /** Number of commands actually launched. */
  launched: number;
}

const isWindows = Deno.build.os === "windows";

function shellCommand(cmd: string): { exec: string; args: string[] } {
  return isWindows
    ? { exec: "cmd", args: ["/c", cmd] }
    : { exec: "sh", args: ["-c", cmd] };
}

/**
 * Run all plans for one hook type.
 *
 * Blocking types run sequentially across sources (user before project) so a
 * user failure short-circuits project hooks. Background types launch every
 * source's pipeline detached.
 */
export async function runHooks(
  type: HookType,
  plans: HookPlan[],
  ctx: HookRunContext,
  opts: RunHooksOptions = {},
): Promise<HookOutcome> {
  if (plans.length === 0) return { ok: true, launched: 0 };

  const blocking = isBlocking(type) || opts.foreground;
  const baseVars: TemplateContext = {
    ...ctx.vars,
    hook_type: type,
    cwd: ctx.cwd,
  };

  if (blocking) {
    return await runBlocking(type, plans, ctx, baseVars, opts);
  }
  return await runBackground(type, plans, ctx, baseVars, opts);
}

async function runBlocking(
  type: HookType,
  plans: HookPlan[],
  ctx: HookRunContext,
  baseVars: TemplateContext,
  opts: RunHooksOptions,
): Promise<HookOutcome> {
  let launched = 0;
  for (const plan of plans) {
    for (const step of plan.steps) {
      const results = await runStepConcurrently(
        type,
        step,
        ctx,
        baseVars,
        opts,
      );
      launched += results.length;
      const failed = results.find((r) => r.code !== 0);
      if (failed) {
        error(
          `Hook ${type} (${plan.source}${
            failed.name ? ":" + failed.name : ""
          }) failed with exit ${failed.code}; aborting.`,
        );
        return { ok: false, launched };
      }
    }
  }
  return { ok: true, launched };
}

interface CmdResult {
  name: string | null;
  code: number;
}

async function runStepConcurrently(
  type: HookType,
  step: HookStep,
  ctx: HookRunContext,
  baseVars: TemplateContext,
  opts: RunHooksOptions,
): Promise<CmdResult[]> {
  return await Promise.all(
    step.commands.map(async (c) => {
      const vars = { ...baseVars, hook_name: c.name ?? "" };
      const rendered = render(c.template, vars);
      if (opts.dryRun) {
        info(`[dry-run] ${type}${c.name ? " " + c.name : ""}: ${rendered}`);
        return { name: c.name, code: 0 };
      }
      info(`◎ ${type}${c.name ? " " + c.name : ""}: ${rendered}`);
      const code = await execForeground(rendered, ctx, vars);
      return { name: c.name, code };
    }),
  );
}

async function execForeground(
  rendered: string,
  ctx: HookRunContext,
  vars: TemplateContext,
): Promise<number> {
  const { exec, args } = shellCommand(rendered);
  const command = new Deno.Command(exec, {
    args,
    cwd: ctx.cwd,
    stdin: "piped",
    stdout: "inherit",
    stderr: "inherit",
  });
  const child = command.spawn();
  await writeJsonStdin(child, vars);
  const { code } = await child.status;
  return code;
}

async function runBackground(
  type: HookType,
  plans: HookPlan[],
  ctx: HookRunContext,
  baseVars: TemplateContext,
  opts: RunHooksOptions,
): Promise<HookOutcome> {
  const dir = logDir(ctx.gitCommonDir);
  if (!opts.dryRun) await Deno.mkdir(dir, { recursive: true });

  let launched = 0;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  for (const plan of plans) {
    for (const step of plan.steps) {
      for (const c of step.commands) {
        const vars = { ...baseVars, hook_name: c.name ?? "" };
        const rendered = render(c.template, vars);
        if (opts.dryRun) {
          info(
            `[dry-run bg] ${type}${c.name ? " " + c.name : ""}: ${rendered}`,
          );
          continue;
        }
        const label = `${stamp}-${type}-${plan.source}-${c.name ?? "cmd"}`;
        await spawnDetached(rendered, ctx, vars, join(dir, `${label}.log`));
        launched++;
      }
    }
  }

  if (!opts.dryRun && launched > 0) {
    info(`◎ Running ${type} in background (${launched} command(s)) → ${dir}`);
  }
  return { ok: true, launched };
}

/**
 * Spawn a background command that outlives this CLI process.
 *
 * The command is wrapped in a shell that redirects its own stdout/stderr to the
 * log file, so no in-process piping is needed. The child is `unref()`-ed so the
 * Deno runtime can exit without waiting for it. The JSON context is written to
 * a sidecar file whose path is exported as `TL_HOOK_CONTEXT`; hooks that want
 * it can `cat "$TL_HOOK_CONTEXT"`.
 *
 * Note: `[[post-start]]` pipeline ordering within a background source is not
 * preserved once detached — v1 launches each command independently. Commands
 * with a hard dependency chain should use a blocking `pre-*` hook. (Tracked for
 * refinement in a later step.)
 */
async function spawnDetached(
  rendered: string,
  ctx: HookRunContext,
  vars: TemplateContext,
  logPath: string,
): Promise<void> {
  const ctxFile = `${logPath}.ctx.json`;
  await Deno.writeTextFile(ctxFile, JSON.stringify(vars));

  const wrapped = isWindows
    ? rendered // Windows redirection handled below via cmd
    : `exec >${shQuote(logPath)} 2>&1; ${rendered}`;

  const command = isWindows
    ? new Deno.Command("cmd", {
      args: ["/c", `${rendered} > "${logPath}" 2>&1`],
      cwd: ctx.cwd,
      stdin: "null",
      stdout: "null",
      stderr: "null",
      env: { TL_HOOK_CONTEXT: ctxFile },
    })
    : new Deno.Command("sh", {
      args: ["-c", wrapped],
      cwd: ctx.cwd,
      stdin: "null",
      stdout: "null",
      stderr: "null",
      env: { ...envSnapshot(), TL_HOOK_CONTEXT: ctxFile },
    });

  const child = command.spawn();
  // Detach: let the runtime exit without awaiting this process.
  child.unref();
}

function shQuote(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}

function envSnapshot(): Record<string, string> {
  return Deno.env.toObject();
}

async function writeJsonStdin(
  child: Deno.ChildProcess,
  vars: TemplateContext,
): Promise<void> {
  // Best-effort: a fast command may exit before we finish writing, which
  // closes the pipe (EPIPE). Hooks read stdin optionally, so never fail here.
  try {
    const writer = child.stdin.getWriter();
    try {
      await writer.write(new TextEncoder().encode(JSON.stringify(vars)));
    } finally {
      await writer.close();
    }
  } catch {
    // stdin already closed by the child; ignore.
  }
}
