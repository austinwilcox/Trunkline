/**
 * Directory-change side channel for the shell wrapper.
 *
 * A compiled binary cannot change its parent shell's working directory, so
 * `tl switch` writes the target directory somewhere the installed shell
 * function can read and `cd` to. We support two mechanisms:
 *
 *   1. `--cd-file <path>`: write the directory to that file (used by the
 *      installed wrapper and by tests — deterministic, no stdout parsing).
 *   2. `$TL_CD_FILE`: same, via environment, when the flag is absent.
 *
 * When neither is present (running `tl` directly without the wrapper), we print
 * a hint so the user knows why the directory didn't change.
 */

export interface CdChannel {
  /** Resolved cd-file path, if any. */
  file: string | null;
}

export function resolveCdChannel(flagValue?: unknown): CdChannel {
  const fromFlag = typeof flagValue === "string" && flagValue.length > 0
    ? flagValue
    : null;
  const fromEnv = Deno.env.get("TL_CD_FILE") ?? null;
  return { file: fromFlag ?? fromEnv };
}

/**
 * Request that the shell wrapper change to `dir`.
 *
 * @returns true if the directive was written to a cd-file, false if there was
 * no channel (in which case a hint is printed to stderr).
 */
export async function requestCd(
  dir: string,
  channel: CdChannel,
): Promise<boolean> {
  if (channel.file) {
    await Deno.writeTextFile(channel.file, dir);
    return true;
  }
  return false;
}
