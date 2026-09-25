/**
 * `tl update` — self-update the running binary to the latest GitHub release.
 *
 *   tl update            check, confirm, download + replace this binary
 *   tl update --yes      skip the confirmation prompt
 *   tl update --force    reinstall even if already on the latest version
 *   tl update --check    only report whether an update is available (no install)
 *
 * Replacing the binary requires write access to its directory. If that fails
 * (e.g. installed under /usr/local/bin), the user is told to re-run with sudo.
 */

import { VERSION } from "../../version.ts";
import { isNewer } from "../../version.ts";
import {
  fetchLatestRelease,
  installRelease,
  type LatestRelease,
} from "../../update/install.ts";
import { assetName, currentTarget } from "../../update/platform.ts";
import { bold, error, green, info, success, warn } from "../../util/log.ts";

export interface UpdateOptions {
  yes?: boolean;
  force?: boolean;
  check?: boolean;
}

export async function runUpdate(opts: UpdateOptions = {}): Promise<number> {
  let release: LatestRelease;
  try {
    info("Checking for the latest release…");
    release = await fetchLatestRelease();
  } catch (err) {
    error(
      `Could not reach GitHub releases: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 1;
  }

  const current = VERSION;
  const latest = release.tag;
  const upgradeable = isNewer(current, latest);

  if (opts.check) {
    if (upgradeable) {
      console.log(`Update available: ${current} → ${bold(latest)}`);
    } else {
      console.log(`Up to date (${current}).`);
    }
    return 0;
  }

  if (!upgradeable && !opts.force) {
    success(`Already up to date (${current}).`);
    return 0;
  }

  // Confirm the platform has a matching asset before prompting.
  const target = currentTarget();
  const wanted = assetName(latest, target);
  if (!release.assets.some((a) => a.name === wanted)) {
    error(`Release ${latest} has no build for this platform (${wanted}).`);
    return 1;
  }

  const verb = upgradeable ? `${current} → ${latest}` : `reinstall ${latest}`;
  if (!opts.yes) {
    const ok = await confirm(`Update tl (${verb})? [y/N] `);
    if (!ok) {
      info("Aborted.");
      return 0;
    }
  }

  try {
    info(`Downloading ${wanted}…`);
    const result = await installRelease(release);
    success(`Updated tl to ${result.version} (${result.execPath}).`);
    info("Run 'tl --version' to confirm.");
    return 0;
  } catch (err) {
    return handleInstallError(err);
  }
}

function handleInstallError(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err);

  // Permission problems replacing the binary → suggest sudo.
  if (
    err instanceof Deno.errors.PermissionDenied ||
    /permission denied|operation not permitted|EACCES|EPERM/i.test(msg)
  ) {
    error(`Could not replace the tl binary: ${msg}`);
    warn(
      "The install location isn't writable by your user. Re-run with sudo:\n" +
        `  ${green("sudo tl update")}`,
    );
    return 1;
  }

  error(`Update failed: ${msg}`);
  return 1;
}

/** Read a yes/no answer from stdin (works with piped input). */
async function confirm(prompt: string): Promise<boolean> {
  await Deno.stderr.write(new TextEncoder().encode(prompt));
  const buf = new Uint8Array(1);
  const dec = new TextDecoder();
  let line = "";
  while (true) {
    const n = await Deno.stdin.read(buf);
    if (n === null) break;
    const ch = dec.decode(buf.subarray(0, n));
    if (ch === "\n") break;
    line += ch;
  }
  const a = line.trim().toLowerCase();
  return a === "y" || a === "yes";
}
