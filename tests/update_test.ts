import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { assetName, currentTarget } from "../src/update/platform.ts";
import { installRelease, sha256File } from "../src/update/install.ts";

Deno.test("currentTarget maps os/arch to release conventions", () => {
  assertEquals(currentTarget("linux", "x86_64"), {
    os: "linux",
    arch: "x86_64",
    ext: "tar.gz",
    binaryName: "tl",
  });
  assertEquals(currentTarget("darwin", "aarch64"), {
    os: "macos",
    arch: "aarch64",
    ext: "tar.gz",
    binaryName: "tl",
  });
  assertEquals(currentTarget("windows", "x86_64"), {
    os: "windows",
    arch: "x86_64",
    ext: "zip",
    binaryName: "tl.exe",
  });
});

Deno.test("currentTarget rejects unsupported platforms", () => {
  // deno-lint-ignore no-explicit-any
  const ct = currentTarget as any;
  assertThrows(() => ct("solaris", "x86_64"), Error, "Unsupported OS");
  assertThrows(() => ct("linux", "riscv64"), Error, "Unsupported architecture");
});

Deno.test("assetName matches the release workflow naming", () => {
  const linux = currentTarget("linux", "x86_64");
  assertEquals(assetName("0.3.0", linux), "tl-0.3.0-linux-x86_64.tar.gz");
  // leading v is stripped
  assertEquals(assetName("v0.3.0", linux), "tl-0.3.0-linux-x86_64.tar.gz");

  const win = currentTarget("windows", "aarch64");
  assertEquals(assetName("1.2.3", win), "tl-1.2.3-windows-aarch64.zip");
});

Deno.test("sha256File computes the digest of a file", async () => {
  const tmp = await Deno.makeTempFile();
  try {
    await Deno.writeTextFile(tmp, "hello\n");
    // sha256 of "hello\n"
    assertEquals(
      await sha256File(tmp),
      "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
    );
  } finally {
    await Deno.remove(tmp);
  }
});

Deno.test("installRelease errors when no asset matches the platform", async () => {
  const target = currentTarget("linux", "x86_64");
  await assertRejects(
    () =>
      installRelease(
        {
          tag: "0.3.0",
          assets: [{
            name: "tl-0.3.0-macos-x86_64.tar.gz",
            browser_download_url: "x",
          }],
        },
        "/tmp/does-not-matter",
        target,
      ),
    Error,
    "no asset for this platform",
  );
});
