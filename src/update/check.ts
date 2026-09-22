/**
 * Deno-style update check: on run, occasionally check whether a newer release
 * of `tl` exists and print a one-line notice to stderr.
 *
 * Design (mirrors how `deno` surfaces upgrades):
 *   - Non-blocking and failure-silent — never breaks or slows a command.
 *   - Cached: the network check runs at most once per {@link CHECK_INTERVAL_MS}
 *     (daily), persisted to `<userConfigDir>/update-check.json`.
 *   - Opt-out via `TL_NO_UPDATE_CHECK=1` (or when `CI` is set).
 *   - Notice goes to stderr, so stdout (e.g. `--json`) stays clean.
 *   - Skipped for `--version`/`--json` and non-interactive edge cases.
 */

import { join } from "@std/path";
import { userConfigDir } from "../util/paths.ts";
import { isNewer, VERSION } from "../version.ts";
import { dim, green, yellow } from "../util/log.ts";

const RELEASES_API =
  "https://api.github.com/repos/austinwilcox/Trunkline/releases/latest";
const RELEASES_PAGE = "https://github.com/austinwilcox/Trunkline/releases";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // once/day
const FETCH_TIMEOUT_MS = 1500;

interface Cache {
  /** Epoch ms of the last successful (or attempted) check. */
  lastCheck: number;
  /** Latest version tag seen from the API, without leading `v`. */
  latest: string;
}

function cachePath(): string {
  return join(userConfigDir(), "update-check.json");
}

/** True if update checks are disabled by environment. */
function disabled(): boolean {
  return Deno.env.get("TL_NO_UPDATE_CHECK") === "1" ||
    (Deno.env.get("CI") ?? "") !== "";
}

/**
 * Print an upgrade notice if a newer release is known.
 *
 * This is the entry point commands call. It reads the cache and, if stale,
 * refreshes it in the background style (awaited here but time-boxed). Any error
 * is swallowed.
 */
export async function maybeNotifyUpdate(): Promise<void> {
  if (disabled()) return;

  try {
    const cache = await readCache();
    const now = Date.now();

    let latest = cache?.latest ?? null;
    if (!cache || now - cache.lastCheck > CHECK_INTERVAL_MS) {
      latest = await fetchLatest();
      await writeCache({
        lastCheck: now,
        latest: latest ?? cache?.latest ?? "",
      });
    }

    if (latest && isNewer(VERSION, latest)) {
      printNotice(latest);
    }
  } catch {
    // Never let update checking affect the command.
  }
}

/** Fetch the latest release tag from GitHub, or null on any failure. */
async function fetchLatest(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(RELEASES_API, {
      headers: { "accept": "application/vnd.github+json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = await res.json() as { tag_name?: string };
    if (!body.tag_name) return null;
    return body.tag_name.replace(/^v/, "");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readCache(): Promise<Cache | null> {
  try {
    const text = await Deno.readTextFile(cachePath());
    const obj = JSON.parse(text) as Cache;
    if (typeof obj.lastCheck === "number") return obj;
    return null;
  } catch {
    return null;
  }
}

async function writeCache(cache: Cache): Promise<void> {
  try {
    await Deno.mkdir(userConfigDir(), { recursive: true });
    await Deno.writeTextFile(cachePath(), JSON.stringify(cache));
  } catch {
    // best-effort
  }
}

function printNotice(latest: string): void {
  const line1 = yellow(
    `A new release of tl is available: ${VERSION} → ${latest}`,
  );
  const line2 = dim("Download: ") + green(RELEASES_PAGE);
  console.error(`\n${line1}\n${line2}`);
}
