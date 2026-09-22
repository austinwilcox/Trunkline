import { assertEquals } from "@std/assert";
import { emptyState, type StackState, track } from "../src/stack/store.ts";
import { resolveTarget } from "../src/cli/commands/nav.ts";

/** main ← api ← ui (linear). */
function linear(): StackState {
  const s = emptyState();
  track(s, "api", "main");
  track(s, "ui", "api");
  return s;
}

/** main ← api ← {ui, tests} (fan-out). */
function forked(): StackState {
  const s = linear();
  track(s, "tests", "api");
  return s;
}

Deno.test("trunk always resolves to the trunk", () => {
  assertEquals(
    resolveTarget("trunk", linear(), "main", "ui", 1).branch,
    "main",
  );
});

Deno.test("down walks toward trunk", () => {
  assertEquals(resolveTarget("down", linear(), "main", "ui", 1).branch, "api");
  assertEquals(
    resolveTarget("down", linear(), "main", "api", 1).branch,
    "main",
  );
});

Deno.test("down from trunk errors", () => {
  const r = resolveTarget("down", linear(), "main", "main", 1);
  assertEquals(Boolean(r.error), true);
});

Deno.test("up moves into the stack from trunk (single root)", () => {
  assertEquals(resolveTarget("up", linear(), "main", "main", 1).branch, "api");
});

Deno.test("up with count climbs multiple levels", () => {
  assertEquals(resolveTarget("up", linear(), "main", "main", 2).branch, "ui");
});

Deno.test("up errors on ambiguous fork", () => {
  const r = resolveTarget("up", forked(), "main", "api", 1);
  assertEquals(Boolean(r.error), true);
  assertStringIncludesLoose(r.error, "Multiple branches");
});

Deno.test("bottom returns nearest-trunk branch", () => {
  assertEquals(
    resolveTarget("bottom", linear(), "main", "ui", 1).branch,
    "api",
  );
});

Deno.test("top resolves the single leaf", () => {
  assertEquals(resolveTarget("top", linear(), "main", "api", 1).branch, "ui");
});

Deno.test("top errors on multiple leaves", () => {
  const r = resolveTarget("top", forked(), "main", "api", 1);
  assertEquals(Boolean(r.error), true);
});

function assertStringIncludesLoose(s: string | undefined, sub: string): void {
  assertEquals(Boolean(s && s.includes(sub)), true);
}
