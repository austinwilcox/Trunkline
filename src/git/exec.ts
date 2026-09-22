/**
 * Thin wrapper around spawning `git` via `Deno.Command`.
 *
 * Everything else in the git layer goes through {@link git}, so there is a
 * single place that handles process spawning, decoding, and error surfacing.
 */

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export class GitError extends Error {
  readonly code: number;
  readonly stderr: string;
  readonly args: readonly string[];

  constructor(args: readonly string[], result: GitResult) {
    super(
      `git ${
        args.join(" ")
      } failed (exit ${result.code}): ${result.stderr.trim()}`,
    );
    this.name = "GitError";
    this.code = result.code;
    this.stderr = result.stderr;
    this.args = args;
  }
}

export interface GitOptions {
  /** Working directory to run git in. Defaults to the current directory. */
  cwd?: string;
  /** If true, a non-zero exit throws {@link GitError}. Defaults to true. */
  check?: boolean;
}

const encoder = new TextDecoder();

/**
 * Run a git command and capture its output.
 *
 * @example
 * const root = (await git(["rev-parse", "--show-toplevel"])).stdout.trim();
 */
export async function git(
  args: readonly string[],
  opts: GitOptions = {},
): Promise<GitResult> {
  const { cwd, check = true } = opts;

  const command = new Deno.Command("git", {
    args: [...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();
  const result: GitResult = {
    code,
    stdout: encoder.decode(stdout),
    stderr: encoder.decode(stderr),
  };

  if (check && code !== 0) {
    throw new GitError(args, result);
  }
  return result;
}

/** Convenience helper: run git and return trimmed stdout. */
export async function gitStdout(
  args: readonly string[],
  opts: GitOptions = {},
): Promise<string> {
  return (await git(args, opts)).stdout.trim();
}
