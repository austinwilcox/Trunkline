import { assertEquals } from "@std/assert";
import { git } from "../src/git/exec.ts";
import { getRepoInfo } from "../src/git/repo.ts";
import { runSwitch } from "../src/cli/commands/switch.ts";
import { runStack } from "../src/cli/commands/stack.ts";
import { loadStackState } from "../src/stack/store.ts";
import { baseOf } from "../src/stack/graph.ts";

async function makeRepo(): Promise<{ dir: string; cleanup: () => void }> {
  const dir = await Deno.makeTempDir({ prefix: "tl-stack-" });
  const opts = { cwd: dir };
  await git(["init", "-q", "-b", "main"], opts);
  await git(["config", "user.email", "t@e.com"], opts);
  await git(["config", "user.name", "T"], opts);
  await Deno.writeTextFile(`${dir}/README.md`, "hi\n");
  await git(["add", "."], opts);
  await git(["commit", "-q", "-m", "initial"], opts);
  return { dir, cleanup: () => Deno.removeSync(dir, { recursive: true }) };
}

function cleanupWorktrees(base: string, branches: string[]): void {
  for (const b of branches) {
    try {
      Deno.removeSync(`${base}.${b}`, { recursive: true });
    } catch { /* ignore */ }
  }
}

Deno.test("switch -c --stack tracks the new branch on the current branch", async () => {
  const { dir, cleanup } = await makeRepo();
  const created: string[] = [];
  try {
    const repo = await getRepoInfo(dir);

    // Create api based on main (current branch is main in the primary worktree).
    const c1 = await runSwitch({
      branch: "api",
      create: true,
      stack: true,
      cd: { file: null },
      cwd: dir,
    });
    created.push("api");
    assertEquals(c1, 0);

    let state = await loadStackState(repo.gitCommonDir);
    assertEquals(baseOf(state, "api"), "main");

    // From the api worktree, create ui based on api.
    const apiPath = `${dir}.api`;
    const c2 = await runSwitch({
      branch: "ui",
      create: true,
      stack: true,
      cd: { file: null },
      cwd: apiPath,
    });
    created.push("ui");
    assertEquals(c2, 0);

    state = await loadStackState(repo.gitCommonDir);
    assertEquals(baseOf(state, "ui"), "api");
  } finally {
    cleanupWorktrees(dir, created);
    cleanup();
  }
});

Deno.test("stack track guesses the base from ancestry", async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    const repo = await getRepoInfo(dir);
    // Create a branch the plain way (no --stack), with a commit.
    await git(["branch", "feat"], { cwd: dir });
    await git(["worktree", "add", "-q", `${dir}.feat`, "feat"], { cwd: dir });
    await Deno.writeTextFile(`${dir}.feat/f.txt`, "x\n");
    await git(["add", "."], { cwd: `${dir}.feat` });
    await git(["commit", "-q", "-m", "feat work"], { cwd: `${dir}.feat` });

    // Track it from within its worktree; base should be guessed as main.
    const code = await runStack({ args: ["track"], cwd: `${dir}.feat` });
    assertEquals(code, 0);

    const state = await loadStackState(repo.gitCommonDir);
    assertEquals(baseOf(state, "feat"), "main");
  } finally {
    try {
      Deno.removeSync(`${dir}.feat`, { recursive: true });
    } catch { /* ignore */ }
    cleanup();
  }
});

Deno.test("stack untrack removes a branch from the graph", async () => {
  const { dir, cleanup } = await makeRepo();
  const created: string[] = [];
  try {
    const repo = await getRepoInfo(dir);
    await runSwitch({
      branch: "api",
      create: true,
      stack: true,
      cd: { file: null },
      cwd: dir,
    });
    created.push("api");

    const code = await runStack({ args: ["untrack", "api"], cwd: dir });
    assertEquals(code, 0);
    const state = await loadStackState(repo.gitCommonDir);
    assertEquals("api" in state.branches, false);
  } finally {
    cleanupWorktrees(dir, created);
    cleanup();
  }
});
