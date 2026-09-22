import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { git } from "../src/git/exec.ts";
import { runInit } from "../src/cli/commands/init.ts";
import { runHookCommand } from "../src/cli/commands/hook.ts";

async function makeRepo(projectToml?: string): Promise<{
  dir: string;
  cleanup: () => void;
}> {
  const dir = await Deno.makeTempDir({ prefix: "tl-cmd-" });
  const opts = { cwd: dir };
  await git(["init", "-q", "-b", "main"], opts);
  await git(["config", "user.email", "t@e.com"], opts);
  await git(["config", "user.name", "T"], opts);
  await Deno.writeTextFile(`${dir}/README.md`, "hi\n");
  await git(["add", "."], opts);
  await git(["commit", "-q", "-m", "initial"], opts);
  if (projectToml) {
    await Deno.mkdir(join(dir, ".config"), { recursive: true });
    await Deno.writeTextFile(join(dir, ".config", "tl.toml"), projectToml);
  }
  return { dir, cleanup: () => Deno.removeSync(dir, { recursive: true }) };
}

Deno.test("init creates .config/tl.toml, refuses overwrite without --force", async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    assertEquals(await runInit({ cwd: dir }), 0);
    const path = join(dir, ".config", "tl.toml");
    const body = await Deno.readTextFile(path);
    assertStringIncludes(body, "Trunkline project config");

    // Second run without --force fails.
    assertEquals(await runInit({ cwd: dir }), 1);
    // With --force it succeeds.
    assertEquals(await runInit({ cwd: dir, force: true }), 0);
  } finally {
    cleanup();
  }
});

Deno.test("hook show returns 0 and lists nothing when unconfigured", async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    assertEquals(await runHookCommand({ args: ["show"], cwd: dir }), 0);
  } finally {
    cleanup();
  }
});

Deno.test("hook <type> runs a configured project hook (with --yes)", async () => {
  const { dir, cleanup } = await makeRepo(
    `pre-start = "echo on-demand > od.txt"\n`,
  );
  try {
    const code = await runHookCommand({
      args: ["pre-start"],
      yes: true,
      cwd: dir,
    });
    assertEquals(code, 0);
    const marker = (await Deno.readTextFile(join(dir, "od.txt"))).trim();
    assertEquals(marker, "on-demand");
  } finally {
    cleanup();
  }
});

Deno.test("hook --dry-run does not execute", async () => {
  const { dir, cleanup } = await makeRepo(
    `pre-start = "echo nope > dry.txt"\n`,
  );
  try {
    const code = await runHookCommand({
      args: ["pre-start"],
      dryRun: true,
      cwd: dir,
    });
    assertEquals(code, 0);
    let created = false;
    try {
      await Deno.stat(join(dir, "dry.txt"));
      created = true;
    } catch { /* expected */ }
    assertEquals(created, false);
  } finally {
    cleanup();
  }
});

Deno.test("hook name filter runs only the named command", async () => {
  const toml = `[pre-start]
a = "echo A > a.txt"
b = "echo B > b.txt"
`;
  const { dir, cleanup } = await makeRepo(toml);
  try {
    const code = await runHookCommand({
      args: ["pre-start", "a"],
      yes: true,
      cwd: dir,
    });
    assertEquals(code, 0);
    assertEquals((await Deno.readTextFile(join(dir, "a.txt"))).trim(), "A");
    // b must not have run.
    let ranB = false;
    try {
      await Deno.stat(join(dir, "b.txt"));
      ranB = true;
    } catch { /* expected */ }
    assertEquals(ranB, false);
  } finally {
    cleanup();
  }
});

Deno.test("hook unknown type returns exit 2", async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    assertEquals(await runHookCommand({ args: ["not-a-hook"], cwd: dir }), 2);
  } finally {
    cleanup();
  }
});
