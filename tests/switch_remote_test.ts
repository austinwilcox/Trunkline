import { assertEquals, assertStringIncludes } from "@std/assert";
import { git } from "../src/git/exec.ts";
import {
  branchExists,
  findRemoteBranch,
  findWorktreeByBranch,
} from "../src/git/worktree.ts";
import { runSwitch } from "../src/cli/commands/switch.ts";

/**
 * Create an "upstream" repo with `main` + an extra branch, then clone it so the
 * clone has `origin/<branch>` available but no local `<branch>`.
 */
async function makeClone(remoteBranch: string): Promise<{
  clone: string;
  cleanup: () => void;
}> {
  const upstream = await Deno.makeTempDir({ prefix: "tl-upstream-" });
  const up = { cwd: upstream };
  await git(["init", "-q", "-b", "main"], up);
  await git(["config", "user.email", "t@e.com"], up);
  await git(["config", "user.name", "T"], up);
  await Deno.writeTextFile(`${upstream}/README.md`, "hi\n");
  await git(["add", "."], up);
  await git(["commit", "-q", "-m", "initial"], up);
  // Create the branch with a unique commit in the upstream.
  await git(["checkout", "-q", "-b", remoteBranch], up);
  await Deno.writeTextFile(`${upstream}/feature.txt`, "remote work\n");
  await git(["add", "."], up);
  await git(["commit", "-q", "-m", "remote feature"], up);
  await git(["checkout", "-q", "main"], up);

  const clone = await Deno.makeTempDir({ prefix: "tl-clone-" });
  await Deno.remove(clone, { recursive: true }); // git clone wants a fresh dir
  await git(["clone", "-q", upstream, clone], {});
  await git(["config", "user.email", "t@e.com"], { cwd: clone });
  await git(["config", "user.name", "T"], { cwd: clone });

  return {
    clone,
    cleanup: () => {
      Deno.removeSync(upstream, { recursive: true });
      try {
        Deno.removeSync(clone, { recursive: true });
      } catch { /* ignore */ }
    },
  };
}

Deno.test("findRemoteBranch prefers origin and detects remote-only branches", async () => {
  const { clone, cleanup } = await makeClone("feature-remote");
  try {
    // Not checked out locally, but present on origin.
    assertEquals(await branchExists(clone, "feature-remote"), false);
    assertEquals(
      await findRemoteBranch(clone, "feature-remote"),
      "origin/feature-remote",
    );
    assertEquals(await findRemoteBranch(clone, "nope"), null);
  } finally {
    cleanup();
  }
});

Deno.test("switch pulls a remote-only branch and creates a tracking worktree", async () => {
  const { clone, cleanup } = await makeClone("feature-remote");
  const created: string[] = [];
  try {
    const code = await runSwitch({
      branch: "feature-remote",
      cd: { file: null },
      cwd: clone,
    });
    assertEquals(code, 0);
    created.push("feature-remote");

    // A worktree now exists for the branch.
    const wt = await findWorktreeByBranch(clone, "feature-remote");
    assertEquals(Boolean(wt), true);

    // The local branch was created and tracks origin/feature-remote.
    assertEquals(await branchExists(clone, "feature-remote"), true);
    const upstream = await git(
      [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "feature-remote@{upstream}",
      ],
      { cwd: clone, check: false },
    );
    assertStringIncludes(upstream.stdout.trim(), "origin/feature-remote");

    // The remote commit's file is present in the worktree.
    const content = await Deno.readTextFile(`${wt!.path}/feature.txt`);
    assertStringIncludes(content, "remote work");
  } finally {
    // Clean any worktree dirs created next to the clone.
    for (const b of created) {
      try {
        Deno.removeSync(`${clone}.${b}`, { recursive: true });
      } catch { /* ignore */ }
    }
    cleanup();
  }
});

Deno.test("switch still errors for a branch that exists nowhere", async () => {
  const { clone, cleanup } = await makeClone("feature-remote");
  try {
    const code = await runSwitch({
      branch: "does-not-exist",
      cd: { file: null },
      cwd: clone,
    });
    assertEquals(code, 1); // no local, no remote, no -c
  } finally {
    cleanup();
  }
});
