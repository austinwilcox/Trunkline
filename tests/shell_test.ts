import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  detectShell,
  generateWrapper,
  mergeSnippet,
  rcFileFor,
} from "../src/shell/integration.ts";

Deno.test("generateWrapper (bash/zsh) uses --cd-file and command shadowing", () => {
  const w = generateWrapper("bash");
  assertStringIncludes(w, "tl() {");
  assertStringIncludes(w, `command tl --cd-file "$cd_file" "$@"`);
  assertStringIncludes(w, `cd "$(cat "$cd_file")"`);
});

Deno.test("generateWrapper (fish) uses fish syntax", () => {
  const w = generateWrapper("fish");
  assertStringIncludes(w, "function tl");
  assertStringIncludes(w, `command tl --cd-file "$cd_file" $argv`);
  assertStringIncludes(w, 'cd (cat "$cd_file")');
});

Deno.test("generateWrapper honors a custom binary name", () => {
  assertStringIncludes(generateWrapper("bash", "trunk"), "trunk() {");
});

Deno.test("mergeSnippet appends when no marker block present", () => {
  const { text, action } = mergeSnippet(
    "export FOO=1\n",
    generateWrapper("bash"),
  );
  assertEquals(action, "installed");
  assertStringIncludes(text, "export FOO=1");
  assertStringIncludes(text, "tl() {");
});

Deno.test("mergeSnippet replaces an existing block (idempotent update)", () => {
  const first = mergeSnippet("", generateWrapper("bash", "tl")).text;
  const { text, action } = mergeSnippet(first, generateWrapper("bash", "tl2"));
  assertEquals(action, "updated");
  // Only the new wrapper remains; no duplicate blocks.
  assertEquals(text.split("tl2() {").length, 2);
  assertEquals(text.indexOf("tl() {"), -1);
});

Deno.test("rcFileFor maps shells to rc files", () => {
  assertStringIncludes(rcFileFor("bash", "/home/u"), "/home/u/.bashrc");
  assertStringIncludes(rcFileFor("zsh", "/home/u"), "/home/u/.zshrc");
  assertStringIncludes(
    rcFileFor("fish", "/home/u"),
    "/.config/fish/config.fish",
  );
});

Deno.test("detectShell falls back to bash", () => {
  const prev = Deno.env.get("SHELL");
  try {
    Deno.env.set("SHELL", "/usr/bin/zsh");
    assertEquals(detectShell(), "zsh");
    Deno.env.set("SHELL", "/usr/bin/fish");
    assertEquals(detectShell(), "fish");
    Deno.env.set("SHELL", "/bin/sh");
    assertEquals(detectShell(), "bash");
  } finally {
    if (prev === undefined) Deno.env.delete("SHELL");
    else Deno.env.set("SHELL", prev);
  }
});
