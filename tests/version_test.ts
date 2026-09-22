import { assertEquals } from "@std/assert";
import { compareVersions, isNewer } from "../src/version.ts";

Deno.test("compareVersions orders core versions", () => {
  assertEquals(compareVersions("1.0.0", "1.0.1"), -1);
  assertEquals(compareVersions("1.2.0", "1.1.9"), 1);
  assertEquals(compareVersions("2.0.0", "1.9.9"), 1);
  assertEquals(compareVersions("1.0.0", "1.0.0"), 0);
});

Deno.test("compareVersions ignores a leading v", () => {
  assertEquals(compareVersions("v1.2.3", "1.2.3"), 0);
  assertEquals(compareVersions("v1.2.3", "v1.2.4"), -1);
});

Deno.test("compareVersions handles missing components", () => {
  assertEquals(compareVersions("1", "1.0.0"), 0);
  assertEquals(compareVersions("1.2", "1.2.0"), 0);
  assertEquals(compareVersions("1.2", "1.3"), -1);
});

Deno.test("pre-release sorts below its release", () => {
  assertEquals(compareVersions("1.0.0-rc.1", "1.0.0"), -1);
  assertEquals(compareVersions("1.0.0", "1.0.0-rc.1"), 1);
  assertEquals(compareVersions("1.0.0-alpha", "1.0.0-beta"), -1);
});

Deno.test("isNewer detects an available upgrade", () => {
  assertEquals(isNewer("0.1.0", "0.2.0"), true);
  assertEquals(isNewer("0.2.0", "0.2.0"), false);
  assertEquals(isNewer("0.3.0", "0.2.0"), false);
  assertEquals(isNewer("0.1.0", "v0.1.1"), true);
});
