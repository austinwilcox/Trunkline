/**
 * Map the running platform to the release asset published by the release
 * workflow. Asset names are `tl-<version>-<os>-<arch>.<ext>` where:
 *   os   ∈ { linux, macos, windows }
 *   arch ∈ { x86_64, aarch64 }
 *   ext  = tar.gz (unix) | zip (windows)
 *
 * Kept pure and dependency-free so it is trivially testable.
 */

export interface Target {
  os: "linux" | "macos" | "windows";
  arch: "x86_64" | "aarch64";
  /** Archive extension for this platform. */
  ext: "tar.gz" | "zip";
  /** Name of the binary inside the archive. */
  binaryName: "tl" | "tl.exe";
}

/** Resolve the current platform, or throw if unsupported. */
export function currentTarget(
  denoOs: typeof Deno.build.os = Deno.build.os,
  denoArch: typeof Deno.build.arch = Deno.build.arch,
): Target {
  const os = mapOs(denoOs);
  const arch = mapArch(denoArch);
  const isWin = os === "windows";
  return {
    os,
    arch,
    ext: isWin ? "zip" : "tar.gz",
    binaryName: isWin ? "tl.exe" : "tl",
  };
}

function mapOs(os: string): Target["os"] {
  switch (os) {
    case "linux":
      return "linux";
    case "darwin":
      return "macos";
    case "windows":
      return "windows";
    default:
      throw new Error(`Unsupported OS for self-update: ${os}`);
  }
}

function mapArch(arch: string): Target["arch"] {
  switch (arch) {
    case "x86_64":
      return "x86_64";
    case "aarch64":
      return "aarch64";
    default:
      throw new Error(`Unsupported architecture for self-update: ${arch}`);
  }
}

/** The release asset file name for a version + target. */
export function assetName(version: string, t: Target): string {
  const v = version.replace(/^v/, "");
  return `tl-${v}-${t.os}-${t.arch}.${t.ext}`;
}
