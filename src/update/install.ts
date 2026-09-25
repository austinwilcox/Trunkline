/**
 * Self-update installer: download the latest release asset for this platform,
 * verify its SHA-256, extract the binary, and atomically replace the running
 * executable.
 *
 * Platform notes:
 *   - Unix: a running executable's file can be replaced. We write the new
 *     binary into the target's directory under a temp name, chmod +x, then
 *     rename() over the original (atomic on the same filesystem).
 *   - Windows: a running .exe cannot be overwritten, but it can be renamed. We
 *     move the running exe aside to `<name>.old`, then move the new one into
 *     place; the `.old` file is best-effort deleted.
 *
 * If the target directory is not writable, replacement fails with EACCES/EPERM;
 * callers surface a "re-run with sudo" hint (see cli/commands/update.ts).
 */

import { dirname, join } from "@std/path";
import { assetName, currentTarget, type Target } from "./platform.ts";

const REPO = "austinwilcox/Trunkline";
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface LatestRelease {
  tag: string; // without leading v
  assets: ReleaseAsset[];
}

/** Fetch metadata about the latest release. Throws on network/parse failure. */
export async function fetchLatestRelease(): Promise<LatestRelease> {
  const res = await fetch(LATEST_API, {
    headers: { "accept": "application/vnd.github+json" },
  });
  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status} ${res.statusText}`);
  }
  const body = await res.json() as {
    tag_name?: string;
    assets?: ReleaseAsset[];
  };
  if (!body.tag_name) throw new Error("Latest release has no tag_name");
  return {
    tag: body.tag_name.replace(/^v/, ""),
    assets: body.assets ?? [],
  };
}

export interface InstallResult {
  version: string;
  execPath: string;
}

/**
 * Download, verify, and install `release` for the current platform, replacing
 * `execPath` (defaults to the running binary).
 */
export async function installRelease(
  release: LatestRelease,
  execPath: string = Deno.execPath(),
  target: Target = currentTarget(),
): Promise<InstallResult> {
  const wantAsset = assetName(release.tag, target);
  const asset = release.assets.find((a) => a.name === wantAsset);
  if (!asset) {
    throw new Error(
      `Release ${release.tag} has no asset for this platform ` +
        `(expected ${wantAsset}).`,
    );
  }
  const shaAsset = release.assets.find((a) => a.name === `${wantAsset}.sha256`);

  const tmpDir = await Deno.makeTempDir({ prefix: "tl-update-" });
  try {
    // 1) Download the archive.
    const archivePath = join(tmpDir, wantAsset);
    await download(asset.browser_download_url, archivePath);

    // 2) Verify checksum when a .sha256 sidecar is published.
    if (shaAsset) {
      const expected = await fetchChecksum(shaAsset.browser_download_url);
      const actual = await sha256File(archivePath);
      if (expected && expected.toLowerCase() !== actual.toLowerCase()) {
        throw new Error(
          `Checksum mismatch for ${wantAsset}:\n  expected ${expected}\n  got      ${actual}`,
        );
      }
    }

    // 3) Extract the binary from the archive.
    const extractedBinary = await extract(archivePath, tmpDir, target);

    // 4) Atomically replace the running executable.
    await replaceExecutable(extractedBinary, execPath, target);

    return { version: release.tag, execPath };
  } finally {
    await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
  }
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, {
    headers: { "accept": "application/octet-stream" },
  });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  const file = await Deno.open(dest, {
    create: true,
    write: true,
    mode: 0o755,
  });
  await res.body.pipeTo(file.writable);
}

/** The `.sha256` sidecar is `<hex>  <filename>`; return the hex digest. */
async function fetchChecksum(url: string): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const text = await res.text();
  const m = text.trim().match(/^([0-9a-fA-F]{64})/);
  return m ? m[1] : null;
}

/** Hex SHA-256 of a file. */
export async function sha256File(path: string): Promise<string> {
  const bytes = await Deno.readFile(path);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Extract the `tl` binary from the archive; returns its path. */
async function extract(
  archivePath: string,
  destDir: string,
  target: Target,
): Promise<string> {
  if (target.ext === "zip") {
    // Windows: use PowerShell Expand-Archive (available on modern Windows).
    await run([
      "powershell",
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force`,
    ]);
  } else {
    // Unix: tar.
    await run(["tar", "-xzf", archivePath, "-C", destDir]);
  }
  const binaryPath = join(destDir, target.binaryName);
  await Deno.stat(binaryPath); // throws if the binary isn't where we expect
  return binaryPath;
}

/**
 * Replace `execPath` with `newBinary`. Unix: rename-over. Windows: move the
 * running exe aside first.
 */
async function replaceExecutable(
  newBinary: string,
  execPath: string,
  target: Target,
): Promise<void> {
  const destDir = dirname(execPath);

  if (target.os === "windows") {
    const old = `${execPath}.old`;
    await Deno.remove(old).catch(() => {});
    await Deno.rename(execPath, old); // move running exe aside
    await copyInto(newBinary, execPath);
    return;
  }

  // Unix: stage in the same directory (for an atomic same-filesystem rename),
  // set the exec bit, then rename over the original.
  const staged = join(destDir, `.tl-update-${Date.now()}`);
  await copyInto(newBinary, staged);
  await Deno.chmod(staged, 0o755);
  await Deno.rename(staged, execPath);
}

/** Copy a file's bytes to `dest` (works across filesystems). */
async function copyInto(src: string, dest: string): Promise<void> {
  const data = await Deno.readFile(src);
  await Deno.writeFile(dest, data, { mode: 0o755 });
}

async function run(cmd: string[]): Promise<void> {
  const [exec, ...args] = cmd;
  const out = await new Deno.Command(exec, {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.code) return;
  const err = new TextDecoder().decode(out.stderr);
  throw new Error(`${exec} failed: ${err.trim() || `exit ${out.code}`}`);
}
