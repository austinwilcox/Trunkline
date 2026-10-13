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

/** Add a worktree on `branch` with one commit per entry in `files`. */
async function addWorkWorktree(
  dir: string,
  branch: string,
  files: string[],
): Promise<string> {
  const path = await addMergedWorktree(dir, branch);
  for (const f of files) {
    await Deno.writeTextFile(`${path}/${f}`, `${f}\n`);
    await git(["add", "."], { cwd: path });
    await git(["commit", "-q", "-m", `add ${f}`], { cwd: path });
  }
  return path;
}

/** Squash-merge `branch` into the checked-out branch at `cwd`. */
async function squashMerge(cwd: string, branch: string): Promise<void> {
  await git(["merge", "-q", "--squash", branch], { cwd });
  await git(["commit", "-q", "-m", `${branch} (#1)`], { cwd });
}

Deno.test("prune removes a squash-merged worktree and its branch", async () => {
  const { dir, cleanup } = await makeRepo();
  const paths: string[] = [];
  try {
    paths.push(await addWorkWorktree(dir, "feat", ["a.txt", "b.txt"]));
    await squashMerge(dir, "feat");
    // main moves on afterwards; the squash must still be recognized.
    await Deno.writeTextFile(`${dir}/later.txt`, "later\n");
    await git(["add", "."], { cwd: dir });
    await git(["commit", "-q", "-m", "later"], { cwd: dir });

    const code = await runPrune({ yes: true, cd: { file: null }, cwd: dir });
    assertEquals(code, 0);
    assertEquals((await listWorktrees(dir)).length, 1);
    const branches = await git(["branch", "--list", "feat"], { cwd: dir });
    assertEquals(branches.stdout.trim(), "");
  } finally {
    cleanupPaths(paths);
    cleanup();
  }
});

Deno.test("prune detects a squash merge done on origin (local main stale)", async () => {
  const { dir, cleanup } = await makeRepo();
  const remote = `${dir}.origin.git`;
  const other = `${dir}.other`;
  const paths: string[] = [remote, other];
  try {
    await git(["init", "-q", "--bare", "-b", "main", remote], { cwd: dir });
    await git(["remote", "add", "origin", remote], { cwd: dir });
    await git(["push", "-q", "-u", "origin", "main"], { cwd: dir });

    paths.push(await addWorkWorktree(dir, "feat", ["a.txt"]));
    await git(["push", "-q", "origin", "feat"], { cwd: dir });

    // Simulate GitHub "Squash and merge" in a separate clone.
    await git(["clone", "-q", remote, other], { cwd: dir });
    await git(["config", "user.email", "t@e.com"], { cwd: other });
    await git(["config", "user.name", "T"], { cwd: other });
    await squashMerge(other, "origin/feat");
    await git(["push", "-q", "origin", "main"], { cwd: other });
    await git(["push", "-q", "origin", "--delete", "feat"], { cwd: other });

    const code = await runPrune({ yes: true, cd: { file: null }, cwd: dir });
    assertEquals(code, 0);
    assertEquals((await listWorktrees(dir)).length, 1);
  } finally {
    cleanupPaths(paths);
    cleanup();
  }
});

Deno.test("prune keeps a branch with work beyond what was squashed", async () => {
  const { dir, cleanup } = await makeRepo();
  const paths: string[] = [];
  try {
    const p = await addWorkWorktree(dir, "feat", ["a.txt"]);
    paths.push(p);
    await squashMerge(dir, "feat");
    // A follow-up commit on the branch that never landed.
    await Deno.writeTextFile(`${p}/extra.txt`, "extra\n");
    await git(["add", "."], { cwd: p });
    await git(["commit", "-q", "-m", "extra"], { cwd: p });

    const code = await runPrune({ yes: true, cd: { file: null }, cwd: dir });
    assertEquals(code, 0);
    const after = await listWorktrees(dir);
    assertEquals(after.some((w) => w.branch === "feat"), true);
  } finally {
    cleanupPaths(paths);
    cleanup();
  }
});
