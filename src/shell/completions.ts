/**
 * Generate shell completion scripts that delegate to `tl __complete`.
 *
 * Each script collects the words typed so far and the current partial token,
 * passes them to `tl __complete`, and feeds the newline-separated candidates
 * back to the shell. Keeping the logic in the binary means completion stays in
 * sync with the CLI without regenerating scripts.
 */

import type { Shell } from "./integration.ts";

const BEGIN = "# >>> trunkline completions >>>";
const END = "# <<< trunkline completions <<<";

export const COMPLETION_BEGIN = BEGIN;
export const COMPLETION_END = END;

/** Generate the completion snippet for a shell. */
export function generateCompletion(shell: Shell, binaryName = "tl"): string {
  switch (shell) {
    case "bash":
      return bash(binaryName);
    case "zsh":
      return zsh(binaryName);
    case "fish":
      return fish(binaryName);
  }
}

function bash(bin: string): string {
  // COMP_WORDS includes the command name; drop it and pass the rest. The last
  // element is the current (possibly empty) token.
  return [
    BEGIN,
    `_${bin}_complete() {`,
    `  local words=("\${COMP_WORDS[@]:1}")`,
    `  local IFS=$'\\n'`,
    `  local candidates`,
    `  candidates=$(command ${bin} __complete "\${words[@]}" 2>/dev/null)`,
    `  COMPREPLY=( $(compgen -W "\${candidates}" -- "\${COMP_WORDS[COMP_CWORD]}") )`,
    `}`,
    `complete -o default -F _${bin}_complete ${bin}`,
    END,
    "",
  ].join("\n");
}

function zsh(bin: string): string {
  return [
    BEGIN,
    `_${bin}_complete() {`,
    `  local -a candidates`,
    `  local line`,
    // words[2,-1] drops the command name; ${words} is the whole command line.
    `  candidates=("\${(@f)$(command ${bin} __complete "\${words[@]:1}" 2>/dev/null)}")`,
    `  compadd -- $candidates`,
    `}`,
    `compdef _${bin}_complete ${bin}`,
    END,
    "",
  ].join("\n");
}

function fish(bin: string): string {
  // -opc: tokens up to the cursor (without the current token); -ct: current
  // token. Pass both so __complete sees the trailing partial word.
  return [
    BEGIN,
    `function __${bin}_complete`,
    `    set -l tokens (commandline -opc)`,
    `    set -l current (commandline -ct)`,
    `    # Drop the command name (first token), keep the rest, then the partial.`,
    `    command ${bin} __complete $tokens[2..-1] $current 2>/dev/null`,
    `end`,
    `complete -c ${bin} -f -a '(__${bin}_complete)'`,
    END,
    "",
  ].join("\n");
}
