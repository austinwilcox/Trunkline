import { assertEquals, assertThrows } from "@std/assert";
import { render } from "../src/hooks/template.ts";

Deno.test("render substitutes a plain variable", () => {
  assertEquals(render("hi {{ branch }}", { branch: "feat" }), "hi feat");
});

Deno.test("render supports dotted access", () => {
  assertEquals(
    render("{{ vars.port }}", { vars: { port: 3000 } }),
    "3000",
  );
});

Deno.test("sanitize filter replaces slashes", () => {
  assertEquals(
    render("{{ branch | sanitize }}", { branch: "feat/auth" }),
    "feat-auth",
  );
});

Deno.test("hash_port is deterministic and in range", () => {
  const a = render("{{ branch | hash_port }}", { branch: "feat" });
  const b = render("{{ branch | hash_port }}", { branch: "feat" });
  assertEquals(a, b);
  const n = Number(a);
  assertEquals(n >= 10000 && n <= 19999, true);
});

Deno.test("dirname and basename traverse paths", () => {
  assertEquals(render("{{ p | dirname }}", { p: "/a/b/c" }), "/a/b");
  assertEquals(render("{{ p | basename }}", { p: "/a/b/c" }), "c");
});

Deno.test("unknown filter throws", () => {
  assertThrows(
    () => render("{{ x | nope }}", { x: "y" }),
    Error,
    "Unknown template filter",
  );
});

Deno.test("undefined variable throws", () => {
  assertThrows(
    () => render("{{ missing }}", {}),
    Error,
    "Undefined template variable",
  );
});
