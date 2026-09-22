import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { git } from "../src/git/exec.ts";
import { getRepoInfo } from "../src/git/repo.ts";
import { buildPlans } from "../src/hooks/model.ts";
import { runHooks } from "../src/hooks/run.ts";
import { logDir } from "../src/util/paths.ts";

async function makeRepo(): Promise<{ dir: string; cleanup: () => void }> {
  const dir = await Deno.makeTempDir({ prefix: "tl-hook-" });
  const opts = { cwd: dir };
  await git(["init", "-q", "-b", "main"], opts);
  await git(["config", "user.email", "t@e.com"], opts);
  await git(["config", "user.name", "T"], opts);
  await Deno.writeTextFile(`${dir}/README.md`, "hi\n");
  await git(["add", "."], opts);
  await git(["commit", "-q", "-m", "initial"], opts);
  return { dir, cleanup: () => Deno.removeSync(dir, { recursive: true }) };
}

async function ctxFor(dir: string) {
  const repo = await getRepoInfo(dir);
  return {
    vars: { branch: "feat", repo: repo.name },
    cwd: dir,
    gitCommonDir: repo.gitCommonDir,
  };
}

Deno.test("blocking pre-* hook runs commands and can use templates", async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    const plans = buildPlans([{
      source: "project",
      form: "echo {{ branch }} > marker.txt",
    }]);
    const outcome = await runHooks("pre-start", plans, await ctxFor(dir));
    assertEquals(outcome.ok, true);
    assertEquals(outcome.launched, 1);

    const marker = (await Deno.readTextFile(join(dir, "marker.txt"))).trim();
    assertEquals(marker, "feat");
  } finally {
    cleanup();
  }
});

Deno.test("blocking pre-* pipeline aborts on failure", async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    const plans = buildPlans([{
      source: "project",
      form: [
        { fail: "exit 3" },
        { after: "echo should-not-run > after.txt" },
      ],
    }]);
    const outcome = await runHooks("pre-start", plans, await ctxFor(dir));
    assertEquals(outcome.ok, false);

    // The second step must not have run.
    let ran = false;
    try {
      await Deno.stat(join(dir, "after.txt"));
      ran = true;
    } catch { /* expected: not created */ }
    assertEquals(ran, false);
  } finally {
    cleanup();
  }
});

Deno.test("background post-* hook writes a log file", async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    const ctx = await ctxFor(dir);
    const plans = buildPlans([{
      source: "project",
      form: { greet: "echo hello-from-hook" },
    }]);
    const outcome = await runHooks("post-start", plans, ctx);
    assertEquals(outcome.ok, true);

    // Background pipeline is detached; poll briefly for the log to appear.
    const dirPath = logDir(ctx.gitCommonDir);
    let content = "";
    for (let i = 0; i < 50 && !content.includes("hello-from-hook"); i++) {
      await new Promise((r) => setTimeout(r, 20));
      try {
        for await (const entry of Deno.readDir(dirPath)) {
          if (
            entry.isFile && entry.name.includes("post-start") &&
            entry.name.endsWith(".log")
          ) {
            content = await Deno.readTextFile(join(dirPath, entry.name));
          }
        }
      } catch { /* dir not ready yet */ }
    }
    assertStringIncludes(content, "hello-from-hook");
  } finally {
    cleanup();
  }
});

Deno.test("dry-run does not execute commands", async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    const plans = buildPlans([{
      source: "project",
      form: "echo nope > dryrun.txt",
    }]);
    const outcome = await runHooks("pre-start", plans, await ctxFor(dir), {
      dryRun: true,
    });
    assertEquals(outcome.ok, true);

    let created = false;
    try {
      await Deno.stat(join(dir, "dryrun.txt"));
      created = true;
    } catch { /* expected */ }
    assertEquals(created, false);
  } finally {
    cleanup();
  }
});
