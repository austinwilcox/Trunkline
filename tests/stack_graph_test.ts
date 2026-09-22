import { assertEquals } from "@std/assert";
import {
  emptyState,
  isTracked,
  type StackState,
  track,
  untrack,
  validateState,
} from "../src/stack/store.ts";
import {
  baseOf,
  bottomOf,
  childrenOf,
  downstackOf,
  stackOf,
  topsOf,
  upstackOf,
} from "../src/stack/graph.ts";

/** Build: main ← api ← ui, api ← tests (api has two children). */
function sampleState(): StackState {
  const s = emptyState();
  track(s, "api", "main");
  track(s, "ui", "api");
  track(s, "tests", "api");
  return s;
}

Deno.test("track/untrack and isTracked", () => {
  const s = emptyState();
  track(s, "feat", "main");
  assertEquals(isTracked(s, "feat"), true);
  assertEquals(isTracked(s, "nope"), false);
});

Deno.test("untrack retargets children onto the removed branch's base", () => {
  const s = sampleState();
  const retargeted = untrack(s, "api");
  assertEquals(retargeted.sort(), ["tests", "ui"]);
  // ui and tests now based on main (api's base).
  assertEquals(baseOf(s, "ui"), "main");
  assertEquals(baseOf(s, "tests"), "main");
  assertEquals(isTracked(s, "api"), false);
});

Deno.test("childrenOf returns direct children sorted", () => {
  assertEquals(childrenOf(sampleState(), "api"), ["tests", "ui"]);
  assertEquals(childrenOf(sampleState(), "main"), ["api"]);
});

Deno.test("downstackOf walks toward trunk and includes it", () => {
  assertEquals(downstackOf(sampleState(), "ui"), ["api", "main"]);
  assertEquals(downstackOf(sampleState(), "api"), ["main"]);
});

Deno.test("upstackOf returns all descendants", () => {
  assertEquals(upstackOf(sampleState(), "api").sort(), ["tests", "ui"]);
  assertEquals(upstackOf(sampleState(), "ui"), []);
});

Deno.test("bottomOf returns the branch nearest trunk", () => {
  assertEquals(bottomOf(sampleState(), "ui"), "api");
  assertEquals(bottomOf(sampleState(), "api"), "api");
});

Deno.test("topsOf returns leaves (may be multiple)", () => {
  assertEquals(topsOf(sampleState(), "api").sort(), ["tests", "ui"]);
  assertEquals(topsOf(sampleState(), "ui"), ["ui"]);
});

Deno.test("stackOf returns the whole component bottom-up", () => {
  const ordered = stackOf(sampleState(), "ui");
  // api must come before its children.
  assertEquals(ordered[0], "api");
  assertEquals(ordered.slice(1).sort(), ["tests", "ui"]);
});

Deno.test("downstackOf guards against cycles", () => {
  const s = emptyState();
  track(s, "a", "b");
  track(s, "b", "a"); // cycle
  const chain = downstackOf(s, "a");
  // Terminates without looping forever.
  assertEquals(chain.length <= 2, true);
});

Deno.test("validateState rejects malformed input", () => {
  let threw = false;
  try {
    validateState({ branches: { x: { base: 123 } } }, "test");
  } catch {
    threw = true;
  }
  assertEquals(threw, true);

  const ok = validateState({ branches: { x: { base: "main" } } }, "test");
  assertEquals(ok.branches.x.base, "main");
});
