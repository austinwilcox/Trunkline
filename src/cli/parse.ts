/**
 * Argument parsing and command dispatch.
 *
 * v1 keeps this hand-rolled on top of `@std/cli` `parseArgs` to avoid a heavy
 * CLI framework dependency. Each subcommand receives the already-parsed flags
 * plus its positional arguments.
 */

import { parseArgs } from "@std/cli/parse-args";

export interface ParsedCommand {
  /** The subcommand name, e.g. "list". Empty string if none given. */
  command: string;
  /** Positional arguments after the subcommand. */
  positionals: string[];
  /** Parsed flags. */
  flags: Record<string, unknown>;
  /** Whether --help was requested. */
  help: boolean;
  /** Whether --version was requested. */
  version: boolean;
}

const ALIASES: Record<string, string> = {
  ls: "list",
  sw: "switch",
  s: "switch",
  rm: "remove",
};

export function parse(argv: string[]): ParsedCommand {
  const parsed = parseArgs(argv, {
    boolean: [
      "help",
      "version",
      "json",
      "create",
      "force",
      "keep-branch",
      "no-hooks",
      "yes",
      "print",
      "foreground",
      "dry-run",
      "repo",
    ],
    string: ["base", "execute", "cd-file", "shell"],
    alias: {
      h: "help",
      V: "version",
      c: "create",
      x: "execute",
      y: "yes",
    },
    // Stop parsing flags after `--` so hook/exec args pass through verbatim.
    "--": true,
  });

  const [rawCommand, ...positionals] = parsed._.map(String);
  const command = rawCommand ? (ALIASES[rawCommand] ?? rawCommand) : "";

  const { _, help, version, ...flags } = parsed;
  // Preserve pass-through args under the conventional key.
  if (parsed["--"]) flags.forwarded = parsed["--"];

  return {
    command,
    positionals,
    flags: flags as Record<string, unknown>,
    help: Boolean(help),
    version: Boolean(version),
  };
}
