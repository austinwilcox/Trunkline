import { assertEquals, assertStringIncludes } from "@std/assert";
import { git } from "../src/git/exec.ts";
import { detectMainBranch, getRepoInfo } from "../src/git/repo.ts";
import { listWorktrees } from "../src/git/worktree.ts";
import { getAheadBehind, getDirtyState } from "../src/git/status.ts";
import { runList } from "../src/cli/commands/list.ts";

/** Create a throwaway git repo with one commit on `main`. */
async function makeRepo(): Promise<{ dir: string; cleanup: () => void }> {
  const dir = await Deno.makeTempDir({ prefix: "tl-test-" });
  const opts = { cwd: dir };
  await git(["init", "-q", "-b", "main"], opts);
  await git(["config", "user.email", "test@example.com"], opts);
  await git(["config", "user.name", "Test"], opts);
  await Deno.writeTextFile(`${dir}/README.md`, "hello\n");
  await git(["add", "."], opts);
  await git(["commit", "-q", "-m", "initial commit"], opts);
  return {
    dir,
    cleanup: () => Deno.removeSync(dir, { recursive: true }),
  };
}

Deno.test("getRepoInfo resolves root and name", async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    const info = await getRepoInfo(dir);
    // macOS /var symlink etc.: compare the trailing directory name.
    assertEquals(info.name, info.root.split("/").pop());
    assertStringIncludes(info.root, "tl-test-");
  } finally {
    cleanup();
  }
});

Deno.test("detectMainBranch finds main", async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    assertEquals(await detectMainBranch(dir), "main");
  } finally {
    cleanup();
  }
});

Deno.test("listWorktrees returns the primary worktree", async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    const wts = await listWorktrees(dir);
    assertEquals(wts.length, 1);
    assertEquals(wts[0].branch, "main");
    assertEquals(wts[0].detached, false);
  } finally {
    cleanup();
  }
});

Deno.test("ahead/behind reflects a new commit on a branch", async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    const opts = { cwd: dir };
    await git(["checkout", "-q", "-b", "feat"], opts);
    await Deno.writeTextFile(`${dir}/a.txt`, "x\n");
    await git(["add", "."], opts);
    await git(["commit", "-q", "-m", "feat commit"], opts);

    const ab = await getAheadBehind(dir, "feat", "main");
    assertEquals(ab, { ahead: 1, behind: 0 });
  } finally {
    cleanup();
  }
});

Deno.test("dirty state counts untracked and staged", async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    await Deno.writeTextFile(`${dir}/untracked.txt`, "u\n");
    let d = await getDirtyState(dir);
    assertEquals(d.untracked, 1);
    assertEquals(d.clean, false);

    await git(["add", "untracked.txt"], { cwd: dir });
    d = await getDirtyState(dir);
    assertEquals(d.staged, 1);
    assertEquals(d.untracked, 0);
  } finally {
    cleanup();
  }
});

Deno.test("runList completes with exit code 0", async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    const code = await runList({ cwd: dir, json: true });
    assertEquals(code, 0);
  } finally {
    cleanup();
  }
});
