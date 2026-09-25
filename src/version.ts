/**
 * Version constant and a minimal semver comparison.
 *
 * The version is baked in at build time. The release workflow overrides
 * {@link VERSION} by rewriting this file (or via `--env`), so a compiled binary
 * reports the tag it was built from.
 */

export const VERSION = "0.3.0";

/**
 * Compare two semver-ish strings.
 *
 * Returns -1 if `a < b`, 1 if `a > b`, 0 if equal. Leading `v` is ignored.
 * Pre-release/build metadata (after `-` or `+`) is compared only enough to
 * order a pre-release below its release; this is intentionally simple and
 * sufficient for "is there a newer release" checks.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a);
  const pb = parse(b);

  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] > pb.nums[i]) return 1;
    if (pa.nums[i] < pb.nums[i]) return -1;
  }
  // Equal core: a version with a pre-release is lower than one without.
  if (pa.pre && !pb.pre) return -1;
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && pb.pre) {
    if (pa.pre < pb.pre) return -1;
    if (pa.pre > pb.pre) return 1;
  }
  return 0;
}

interface Parsed {
  nums: [number, number, number];
  pre: string;
}

function parse(v: string): Parsed {
  const cleaned = v.trim().replace(/^v/, "");
  const [core, ...rest] = cleaned.split(/[-+]/);
  const pre = rest.join("-");
  const parts = core.split(".").map((n) => {
    const x = parseInt(n, 10);
    return Number.isNaN(x) ? 0 : x;
  });
  return {
    nums: [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0],
    pre,
  };
}

/** True if `latest` is strictly newer than `current`. */
export function isNewer(current: string, latest: string): boolean {
  return compareVersions(current, latest) < 0;
}
