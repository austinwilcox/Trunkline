import { assertEquals } from "@std/assert";
import { git } from "../src/git/exec.ts";
import { listWorktrees } from "../src/git/worktree.ts";
import { runPrune } from "../src/cli/commands/prune.ts";

async function makeRepo(): Promise<{ dir: string; cleanup: () => void }> {
  const dir = await Deno.makeTempDir({ prefix: "tl-prune-" });
  const opts = { cwd: dir };
  await git(["init", "-q", "-b", "main"], opts);
  await git(["config", "user.email", "t@e.com"], opts);
  await git(["config", "user.name", "T"], opts);
  await Deno.writeTextFile(`${dir}/README.md`, "hi\n");
  await git(["add", "."], opts);
  await git(["commit", "-q", "-m", "initial"], opts);
  return { dir, cleanup: () => Deno.removeSync(dir, { recursive: true }) };
}

/** Add a worktree at main's current tip (0 commits ahead of main). */
async function addMergedWorktree(dir: string, branch: string): Promise<string> {
  const path = `${dir}.${branch}`;
  await git(["worktree", "add", "-q", path, "-b", branch], { cwd: dir });
  return path;
}

function cleanupPaths(paths: string[]): void {
  for (const p of paths) {
    try {
      Deno.removeSync(p, { recursive: true });
    } catch { /* ignore */ }
  }
}

Deno.test("prune removes a merged, clean worktree", async () => {
  const { dir, cleanup } = await makeRepo();
  const paths: string[] = [];
  try {
    paths.push(await addMergedWorktree(dir, "done"));
    assertEquals((await listWorktrees(dir)).length, 2);

    const code = await runPrune({ yes: true, cd: { file: null }, cwd: dir });
    assertEquals(code, 0);

    const after = await listWorktrees(dir);
    assertEquals(after.length, 1);
    assertEquals(after[0].branch, "main");
  } finally {
    cleanupPaths(paths);
    cleanup();
  }
});

Deno.test("prune keeps a worktree with commits ahead of main", async () => {
  const { dir, cleanup } = await makeRepo();
  const paths: string[] = [];
  try {
    const p = await addMergedWorktree(dir, "wip");
    paths.push(p);
    // Add a commit so 'wip' is 1 ahead of main.
    await Deno.writeTextFile(`${p}/x.txt`, "x\n");
    await git(["add", "."], { cwd: p });
    await git(["commit", "-q", "-m", "wip work"], { cwd: p });

    const code = await runPrune({ yes: true, cd: { file: null }, cwd: dir });
    assertEquals(code, 0);
    // 'wip' must still be present.
    const after = await listWorktrees(dir);
    assertEquals(after.some((w) => w.branch === "wip"), true);
  } finally {
    cleanupPaths(paths);
    cleanup();
  }
});

Deno.test("prune keeps a merged worktree that is dirty", async () => {
  const { dir, cleanup } = await makeRepo();
  const paths: string[] = [];
  try {
    const p = await addMergedWorktree(dir, "dirty");
    paths.push(p);
    await Deno.writeTextFile(`${p}/untracked.txt`, "u\n"); // uncommitted

    const code = await runPrune({ yes: true, cd: { file: null }, cwd: dir });
    assertEquals(code, 0);
    const after = await listWorktrees(dir);
    assertEquals(after.some((w) => w.branch === "dirty"), true);
  } finally {
    cleanupPaths(paths);
    cleanup();
  }
});

Deno.test("prune --dry-run removes nothing", async () => {
  const { dir, cleanup } = await makeRepo();
  const paths: string[] = [];
  try {
    paths.push(await addMergedWorktree(dir, "done"));
    const code = await runPrune({
      dryRun: true,
      yes: true,
      cd: { file: null },
      cwd: dir,
    });
    assertEquals(code, 0);
    assertEquals((await listWorktrees(dir)).length, 2); // unchanged
  } finally {
    cleanupPaths(paths);
    cleanup();
  }
});

Deno.test("prune never removes the primary worktree or main", async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    // Only the primary/main worktree exists.
    const code = await runPrune({ yes: true, cd: { file: null }, cwd: dir });
    assertEquals(code, 0);
    const after = await listWorktrees(dir);
    assertEquals(after.length, 1);
    assertEquals(after[0].branch, "main");
  } finally {
    cleanup();
  }
});
