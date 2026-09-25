/**
 * Shell integration: generate and install the `tl` shell wrapper.
 *
 * A compiled binary cannot change its parent shell's working directory, so the
 * wrapper runs the real binary with `--cd-file <tmp>`, then `cd`s to whatever
 * path the binary wrote there (see util/cd.ts). The wrapper is a thin shim; all
 * logic stays in the binary.
 */

import { join } from "@std/path";
import {
  COMPLETION_BEGIN,
  COMPLETION_END,
  generateCompletion,
} from "./completions.ts";

export type Shell = "bash" | "zsh" | "fish";

export const SUPPORTED_SHELLS: Shell[] = ["bash", "zsh", "fish"];

const BEGIN = "# >>> trunkline shell integration >>>";
const END = "# <<< trunkline shell integration <<<";

/** Detect the user's shell from $SHELL, defaulting to bash. */
export function detectShell(): Shell {
  const sh = Deno.env.get("SHELL") ?? "";
  if (sh.includes("fish")) return "fish";
  if (sh.includes("zsh")) return "zsh";
  return "bash";
}

/** The rc file a given shell reads on startup. */
export function rcFileFor(shell: Shell, home: string): string {
  switch (shell) {
    case "zsh":
      return join(home, ".zshrc");
    case "fish":
      return join(home, ".config", "fish", "config.fish");
    case "bash":
      return join(home, ".bashrc");
  }
}

/**
 * Generate the wrapper snippet for a shell.
 *
 * `binaryName` is the command the wrapper shells out to (the real binary must
 * be on PATH under that name).
 */
export function generateWrapper(shell: Shell, binaryName = "tl"): string {
  if (shell === "fish") {
    return [
      BEGIN,
      `function ${binaryName}`,
      `    set -l cd_file (mktemp)`,
      `    command ${binaryName} --cd-file "$cd_file" $argv`,
      `    set -l rc $status`,
      `    if test -s "$cd_file"`,
      `        cd (cat "$cd_file")`,
      `    end`,
      `    rm -f "$cd_file"`,
      `    return $rc`,
      `end`,
      END,
      "",
    ].join("\n");
  }

  // bash / zsh share POSIX syntax.
  return [
    BEGIN,
    `${binaryName}() {`,
    `  local cd_file`,
    `  cd_file="$(mktemp)"`,
    `  command ${binaryName} --cd-file "$cd_file" "$@"`,
    `  local rc=$?`,
    `  if [ -s "$cd_file" ]; then`,
    `    cd "$(cat "$cd_file")" || true`,
    `  fi`,
    `  rm -f "$cd_file"`,
    `  return $rc`,
    `}`,
    END,
    "",
  ].join("\n");
}

export interface InstallResult {
  rcFile: string;
  action: "installed" | "updated";
  snippet: string;
}

/**
 * Install (or update) the wrapper in the shell's rc file.
 *
 * Idempotent: an existing block between the BEGIN/END markers is replaced,
 * otherwise the snippet is appended.
 */
export async function installWrapper(
  shell: Shell,
  home: string,
  binaryName = "tl",
): Promise<InstallResult> {
  const rcFile = rcFileFor(shell, home);
  const wrapper = generateWrapper(shell, binaryName);
  const completion = generateCompletion(shell, binaryName);

  let existing = "";
  try {
    existing = await Deno.readTextFile(rcFile);
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }

  // Merge the cd-wrapper block, then the completion block (idempotent).
  const step1 = mergeBlock(existing, wrapper, BEGIN, END);
  const step2 = mergeBlock(
    step1.text,
    completion,
    COMPLETION_BEGIN,
    COMPLETION_END,
  );

  const dir = rcFile.slice(0, rcFile.lastIndexOf("/"));
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(rcFile, step2.text);

  // "updated" if either block already existed.
  const action = step1.action === "updated" || step2.action === "updated"
    ? "updated"
    : "installed";
  return { rcFile, action, snippet: wrapper + completion };
}

/** Replace an existing marker block, or append a new one (wrapper markers). */
export function mergeSnippet(
  existing: string,
  snippet: string,
): { text: string; action: "installed" | "updated" } {
  return mergeBlock(existing, snippet, BEGIN, END);
}

/** Replace an existing block between `begin`/`end` markers, or append it. */
export function mergeBlock(
  existing: string,
  snippet: string,
  begin: string,
  end: string,
): { text: string; action: "installed" | "updated" } {
  const b = existing.indexOf(begin);
  const e = existing.indexOf(end);

  if (b !== -1 && e !== -1 && e > b) {
    const before = existing.slice(0, b);
    const after = existing.slice(e + end.length);
    const text = `${before}${snippet}${after.replace(/^\n/, "")}`;
    return { text, action: "updated" };
  }

  const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  return { text: `${existing}${sep}${snippet}`, action: "installed" };
}
