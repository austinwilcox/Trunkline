/**
 * `tl config` — inspect config, manage approvals, install shell integration.
 *
 * Subcommands:
 *   show                 Print the merged effective config (settings + hooks)
 *   path                 Print resolved config + approvals + log paths
 *   approvals list       List saved project-hook approvals
 *   approvals clear      Remove saved approvals (all, or for this repo)
 *   shell install        Install the cd-changing shell wrapper
 */

import { getRepoInfo } from "../../git/repo.ts";
import { loadConfig } from "../../config/load.ts";
import { loadApprovals, saveApprovals } from "../../config/approvals.ts";
import {
  approvalsPath,
  homeDir,
  logDir,
  projectConfigPath,
  userConfigPath,
} from "../../util/paths.ts";
import {
  detectShell,
  generateWrapper,
  installWrapper,
  type Shell,
  SUPPORTED_SHELLS,
} from "../../shell/integration.ts";
import { bold, dim, error, info, success } from "../../util/log.ts";

export interface ConfigOptions {
  args: string[];
  shell?: string;
  /** Print the wrapper snippet instead of installing it. */
  print?: boolean;
  /** `--repo`: scope approvals operations to the current repo. */
  repo?: boolean;
  cwd?: string;
}

export async function runConfig(opts: ConfigOptions): Promise<number> {
  const [sub, ...rest] = opts.args;
  switch (sub) {
    case "show":
      return await configShow(opts.cwd);
    case "path":
      return await configPath(opts.cwd);
    case "approvals":
      return await configApprovals(rest, opts);
    case "shell":
      return await configShell(rest, opts);
    default:
      error(
        `Usage: tl config <show|path|approvals|shell> ...`,
      );
      return 2;
  }
}

async function configShow(cwd?: string): Promise<number> {
  const repo = await getRepoInfo(cwd ?? Deno.cwd());
  const config = await loadConfig(repo.root);

  console.log(bold("Settings:"));
  const settings = Object.entries(config.settings);
  if (settings.length === 0) console.log(dim("  (none)"));
  for (const [k, v] of settings) console.log(`  ${k} = ${v}`);

  console.log(bold("\nHooks:"));
  const types = Object.keys(config.hooks);
  if (types.length === 0) console.log(dim("  (none)"));
  for (const [type, sourced] of Object.entries(config.hooks)) {
    for (const s of sourced ?? []) {
      console.log(`  ${type} (${s.source}): ${formatForm(s.form)}`);
    }
  }

  console.log(bold("\nSources:"));
  console.log(`  user:    ${config.sources.user ?? dim("(none)")}`);
  console.log(`  project: ${config.sources.project ?? dim("(none)")}`);
  return 0;
}

function formatForm(form: unknown): string {
  if (typeof form === "string") return form;
  return JSON.stringify(form);
}

async function configPath(cwd?: string): Promise<number> {
  const repo = await getRepoInfo(cwd ?? Deno.cwd());
  console.log(`project config: ${projectConfigPath(repo.root)}`);
  console.log(`user config:    ${userConfigPath()}`);
  console.log(`approvals:      ${approvalsPath()}`);
  console.log(`logs:           ${logDir(repo.gitCommonDir)}`);
  return 0;
}

async function configApprovals(
  rest: string[],
  opts: ConfigOptions,
): Promise<number> {
  const [action] = rest;
  const store = await loadApprovals();

  if (action === "list" || action === undefined) {
    const repos = Object.entries(store.byRepo);
    if (repos.length === 0) {
      console.log(dim("No approvals recorded."));
      return 0;
    }
    for (const [repoPath, entries] of repos) {
      console.log(bold(repoPath));
      for (const e of entries) {
        console.log(
          `  ${e.type}${e.name ? " " + e.name : ""}  ${
            dim(e.hash.slice(0, 12))
          }`,
        );
      }
    }
    return 0;
  }

  if (action === "clear") {
    if (opts.repo) {
      const repo = await getRepoInfo(opts.cwd ?? Deno.cwd());
      delete store.byRepo[repo.root];
      await saveApprovals(store);
      success(`Cleared approvals for ${repo.root}`);
    } else {
      await saveApprovals({ byRepo: {} });
      success("Cleared all approvals.");
    }
    return 0;
  }

  error("Usage: tl config approvals <list|clear [--repo]>");
  return 2;
}

async function configShell(
  rest: string[],
  opts: ConfigOptions,
): Promise<number> {
  const [action] = rest;
  if (action !== "install") {
    error("Usage: tl config shell install [--shell bash|zsh|fish] [--print]");
    return 2;
  }

  const shell = resolveShell(opts.shell);
  if (!shell) {
    error(
      `Unsupported shell '${opts.shell}'. Supported: ${
        SUPPORTED_SHELLS.join(", ")
      }`,
    );
    return 2;
  }

  if (opts.print) {
    console.log(generateWrapper(shell));
    return 0;
  }

  const result = await installWrapper(shell, homeDir());
  success(
    `${result.action === "installed" ? "Installed" : "Updated"} ${shell} ` +
      `integration in ${result.rcFile}`,
  );
  info(`Restart your shell or run:  source ${result.rcFile}`);
  return 0;
}

function resolveShell(value?: string): Shell | null {
  if (!value) return detectShell();
  if ((SUPPORTED_SHELLS as string[]).includes(value)) return value as Shell;
  return null;
}
