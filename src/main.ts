/**
 * Trunkline entrypoint: parse argv, dispatch to a subcommand.
 *
 * Binary name: `tl`.
 */

import { parse } from "./cli/parse.ts";
import { runList } from "./cli/commands/list.ts";
import { runSwitch } from "./cli/commands/switch.ts";
import { runRemove } from "./cli/commands/remove.ts";
import { runConfig } from "./cli/commands/config.ts";
import { runHookCommand } from "./cli/commands/hook.ts";
import { runInit } from "./cli/commands/init.ts";
import { resolveCdChannel } from "./util/cd.ts";
import { error } from "./util/log.ts";
import { GitError } from "./git/exec.ts";

const VERSION = "0.1.0";

const HELP = `tl — Trunkline, a Git worktree manager

USAGE:
    tl <command> [options]

COMMANDS:
    list        List worktrees with status relative to main   (alias: ls)
    switch      Switch to / create a worktree                 (alias: sw, s)
    remove      Remove a worktree                             (alias: rm)
    hook        Run configured hooks on demand
    config      Manage config, approvals, shell integration
    init        Scaffold .config/tl.toml

OPTIONS:
    -h, --help       Show this help
    -V, --version    Show version
    -y, --yes        Approve project hooks without prompting
        --json       Machine-readable output (where supported)

    switch:
        -c, --create        Create branch + worktree if missing
            --base <ref>    Base ref for the new branch (implies --create)
        -x, --execute <cmd> Run <cmd> in the worktree after switching
            --no-hooks      Skip lifecycle hooks
    remove:
            --force         Remove despite uncommitted changes / unmerged branch
            --keep-branch   Remove the worktree but keep the branch
            --no-hooks      Skip lifecycle hooks
    hook:
            <type> [names]  Hook type (e.g. post-start) + optional name filters
            --foreground    Run a background hook inline
            --dry-run       Preview commands without running them
    config:
            show            Print the merged effective config
            path            Print resolved config/approval/log paths
            approvals list|clear [--repo]
            shell install [--shell bash|zsh|fish] [--print]
    init:
            --force         Overwrite an existing .config/tl.toml
`;

async function main(argv: string[]): Promise<number> {
  const cmd = parse(argv);

  if (cmd.version) {
    console.log(`tl ${VERSION}`);
    return 0;
  }

  if (cmd.help || cmd.command === "" || cmd.command === "help") {
    console.log(HELP);
    return cmd.command === "" && !cmd.help ? 1 : 0;
  }

  switch (cmd.command) {
    case "list":
      return await runList({ json: Boolean(cmd.flags.json) });

    case "switch": {
      const cd = resolveCdChannel(cmd.flags["cd-file"]);
      return await runSwitch({
        branch: cmd.positionals[0] ?? "",
        create: Boolean(cmd.flags.create),
        base: cmd.flags.base as string | undefined,
        execute: cmd.flags.execute as string | undefined,
        executeArgs: (cmd.flags.forwarded as string[] | undefined) ?? [],
        noHooks: Boolean(cmd.flags["no-hooks"]),
        yes: Boolean(cmd.flags.yes),
        cd,
      });
    }

    case "remove": {
      const cd = resolveCdChannel(cmd.flags["cd-file"]);
      return await runRemove({
        branch: cmd.positionals[0],
        force: Boolean(cmd.flags.force),
        keepBranch: Boolean(cmd.flags["keep-branch"]),
        noHooks: Boolean(cmd.flags["no-hooks"]),
        yes: Boolean(cmd.flags.yes),
        cd,
      });
    }

    case "hook":
      return await runHookCommand({
        args: cmd.positionals,
        foreground: Boolean(cmd.flags.foreground),
        dryRun: Boolean(cmd.flags["dry-run"]),
        yes: Boolean(cmd.flags.yes),
      });

    case "config":
      return await runConfig({
        args: cmd.positionals,
        shell: cmd.flags.shell as string | undefined,
        print: Boolean(cmd.flags.print),
        repo: Boolean(cmd.flags.repo),
      });

    case "init":
      return await runInit({ force: Boolean(cmd.flags.force) });

    default:
      error(`Unknown command: '${cmd.command}'. Run 'tl --help'.`);
      return 2;
  }
}

if (import.meta.main) {
  try {
    Deno.exit(await main(Deno.args));
  } catch (err) {
    if (err instanceof GitError) {
      error(err.message);
    } else {
      error(err instanceof Error ? err.message : String(err));
    }
    Deno.exit(1);
  }
}

export { main };
