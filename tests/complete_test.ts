import { assertEquals, assertStringIncludes } from "@std/assert";
import { git } from "../src/git/exec.ts";
import { resolve } from "../src/cli/complete.ts";
import { generateCompletion } from "../src/shell/completions.ts";

async function makeRepo(branches: string[]): Promise<{
  dir: string;
  cleanup: () => void;
}> {
  const dir = await Deno.makeTempDir({ prefix: "tl-comp-" });
  const opts = { cwd: dir };
  await git(["init", "-q", "-b", "main"], opts);
  await git(["config", "user.email", "t@e.com"], opts);
  await git(["config", "user.name", "T"], opts);
  await Deno.writeTextFile(`${dir}/README.md`, "hi\n");
  await git(["add", "."], opts);
  await git(["commit", "-q", "-m", "initial"], opts);
  for (const b of branches) await git(["branch", b], opts);
  return { dir, cleanup: () => Deno.removeSync(dir, { recursive: true }) };
}

Deno.test("resolve: position 1 completes subcommands", async () => {
  const { dir, cleanup } = await makeRepo([]);
  try {
    const out = await resolve(["s"], dir);
    // subcommands + aliases starting with 's'
    assertEquals(out.includes("switch"), true);
    assertEquals(out.includes("stack"), true);
    assertEquals(out.includes("s"), true); // alias
    assertEquals(out.includes("list"), false);
  } finally {
    cleanup();
  }
});

Deno.test("resolve: switch completes matching branch names", async () => {
  const { dir, cleanup } = await makeRepo(["DEV-123", "DEV-456", "feature-x"]);
  try {
    const out = await resolve(["switch", "DEV"], dir);
    assertEquals(out.sort(), ["DEV-123", "DEV-456"]);
  } finally {
    cleanup();
  }
});

Deno.test("resolve: branch match is case-insensitive", async () => {
  const { dir, cleanup } = await makeRepo(["DEV-123", "dev-tools"]);
  try {
    const out = await resolve(["switch", "dev"], dir);
    assertEquals(out.sort(), ["DEV-123", "dev-tools"]);
  } finally {
    cleanup();
  }
});

Deno.test("resolve: empty token lists all branches", async () => {
  const { dir, cleanup } = await makeRepo(["a", "b"]);
  try {
    const out = await resolve(["remove", ""], dir);
    // main + a + b
    assertEquals(out.sort(), ["a", "b", "main"]);
  } finally {
    cleanup();
  }
});

Deno.test("resolve: a leading dash completes flags", async () => {
  const { dir, cleanup } = await makeRepo([]);
  try {
    const out = await resolve(["switch", "--cr"], dir);
    assertEquals(out, ["--create"]);
  } finally {
    cleanup();
  }
});

Deno.test("resolve: stack subcommands then branches", async () => {
  const { dir, cleanup } = await makeRepo(["feat"]);
  try {
    assertEquals((await resolve(["stack", "tr"], dir)).includes("track"), true);
    const branches = await resolve(["stack", "track", "fe"], dir);
    assertEquals(branches, ["feat"]);
  } finally {
    cleanup();
  }
});

Deno.test("generateCompletion emits shell-appropriate hooks", () => {
  assertStringIncludes(generateCompletion("bash"), "complete -o default -F");
  assertStringIncludes(generateCompletion("bash"), "tl __complete");
  assertStringIncludes(generateCompletion("zsh"), "compdef _tl_complete tl");
  assertStringIncludes(generateCompletion("fish"), "complete -c tl");
  assertStringIncludes(generateCompletion("fish"), "tl __complete");
});
