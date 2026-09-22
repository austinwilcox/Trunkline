import { assertEquals, assertStringIncludes } from "@std/assert";
import { git } from "../src/git/exec.ts";
import { getRepoInfo } from "../src/git/repo.ts";
import {
  addWorktree,
  branchExists,
  findWorktreeByBranch,
  listWorktrees,
  primaryWorktree,
  removeWorktree,
} from "../src/git/worktree.ts";
import { resolveWorktreePath } from "../src/config/worktree_path.ts";
import { runSwitch } from "../src/cli/commands/switch.ts";
import { runRemove } from "../src/cli/commands/remove.ts";

async function makeRepo(): Promise<{ dir: string; cleanup: () => void }> {
  const dir = await Deno.makeTempDir({ prefix: "tl-wt-" });
  const opts = { cwd: dir };
  await git(["init", "-q", "-b", "main"], opts);
  await git(["config", "user.email", "t@e.com"], opts);
  await git(["config", "user.name", "T"], opts);
  await Deno.writeTextFile(`${dir}/README.md`, "hi\n");
  await git(["add", "."], opts);
  await git(["commit", "-q", "-m", "initial"], opts);
  return { dir, cleanup: () => Deno.removeSync(dir, { recursive: true }) };
}

Deno.test("resolveWorktreePath renders default template", async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    const repo = await getRepoInfo(dir);
    const path = resolveWorktreePath({ repo, branch: "feat/x" });
    // default: {{ repo_path }}/../{{ repo }}.{{ branch | sanitize }}
    assertStringIncludes(path, `${repo.name}.feat-x`);
    // "../" should have been normalized away
    assertEquals(path.includes("/../"), false);
  } finally {
    cleanup();
  }
});

Deno.test("resolveWorktreePath honors a custom template", async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    const repo = await getRepoInfo(dir);
    const path = resolveWorktreePath({
      repo,
      branch: "feat",
      template: "/tmp/wt/{{ branch }}",
    });
    assertEquals(path, "/tmp/wt/feat");
  } finally {
    cleanup();
  }
});

Deno.test("addWorktree creates a branch + worktree; removeWorktree deletes it", async () => {
  const { dir, cleanup } = await makeRepo();
  const wtPath = `${dir}-feat`;
  try {
    await addWorktree(dir, "feat", wtPath, { create: true });
    assertEquals(await branchExists(dir, "feat"), true);

    const found = await findWorktreeByBranch(dir, "feat");
    assertEquals(found?.path, wtPath);
    assertEquals((await listWorktrees(dir)).length, 2);

    await removeWorktree(dir, wtPath);
    assertEquals(await findWorktreeByBranch(dir, "feat"), null);
    assertEquals((await listWorktrees(dir)).length, 1);
  } finally {
    try {
      Deno.removeSync(wtPath, { recursive: true });
    } catch { /* already removed */ }
    cleanup();
  }
});

Deno.test("primaryWorktree returns the original clone", async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    const primary = await primaryWorktree(dir);
    assertEquals(primary.path, dir);
    assertEquals(primary.branch, "main");
  } finally {
    cleanup();
  }
});

Deno.test("runSwitch --create makes a worktree and writes cd-file", async () => {
  const { dir, cleanup } = await makeRepo();
  const cdFile = `${dir}.cd`;
  try {
    const code = await runSwitch({
      branch: "feature-x",
      create: true,
      cd: { file: cdFile },
      cwd: dir,
    });
    assertEquals(code, 0);

    const target = await findWorktreeByBranch(dir, "feature-x");
    assertEquals(Boolean(target), true);

    const cdTarget = await Deno.readTextFile(cdFile);
    assertEquals(cdTarget, target!.path);
  } finally {
    const t = await findWorktreeByBranch(dir, "feature-x");
    if (t) {
      try {
        Deno.removeSync(t.path, { recursive: true });
      } catch { /* ignore */ }
    }
    try {
      Deno.removeSync(cdFile);
    } catch { /* ignore */ }
    cleanup();
  }
});

Deno.test("runRemove refuses to remove the primary worktree", async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    const code = await runRemove({
      branch: "main",
      cd: { file: null },
      cwd: dir,
    });
    assertEquals(code, 1);
    // main worktree still present
    assertEquals((await listWorktrees(dir)).length, 1);
  } finally {
    cleanup();
  }
});

Deno.test("runRemove deletes a clean worktree and its branch", async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    await runSwitch({
      branch: "feature-y",
      create: true,
      cd: { file: null },
      cwd: dir,
    });
    assertEquals((await listWorktrees(dir)).length, 2);

    const code = await runRemove({
      branch: "feature-y",
      cd: { file: null },
      cwd: dir,
    });
    assertEquals(code, 0);
    assertEquals((await listWorktrees(dir)).length, 1);
    assertEquals(await branchExists(dir, "feature-y"), false);
  } finally {
    cleanup();
  }
});
