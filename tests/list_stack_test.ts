import { assertEquals, assertStringIncludes } from "@std/assert";
import { git } from "../src/git/exec.ts";
import { runSwitch } from "../src/cli/commands/switch.ts";
import { runList } from "../src/cli/commands/list.ts";

async function makeRepo(): Promise<{ dir: string; cleanup: () => void }> {
  const dir = await Deno.makeTempDir({ prefix: "tl-liststack-" });
  const opts = { cwd: dir };
  await git(["init", "-q", "-b", "main"], opts);
  await git(["config", "user.email", "t@e.com"], opts);
  await git(["config", "user.name", "T"], opts);
  await Deno.writeTextFile(`${dir}/README.md`, "hi\n");
  await git(["add", "."], opts);
  await git(["commit", "-q", "-m", "initial"], opts);
  return { dir, cleanup: () => Deno.removeSync(dir, { recursive: true }) };
}

/** Capture console.log output produced while running `fn`. */
async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const chunks: string[] = [];
  console.log = (...args: unknown[]) => {
    chunks.push(args.map((a) => String(a)).join(" "));
  };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return chunks.join("\n");
}

// Strip ANSI so assertions match on visible text.
// deno-lint-ignore no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

Deno.test("list --stack indents branches by stack depth", async () => {
  const { dir, cleanup } = await makeRepo();
  const created: string[] = [];
  try {
    // Build main <- api <- ui.
    await runSwitch({
      branch: "api",
      create: true,
      stack: true,
      cd: { file: null },
      cwd: dir,
    });
    created.push("api");
    await runSwitch({
      branch: "ui",
      create: true,
      stack: true,
      cd: { file: null },
      cwd: `${dir}.api`,
    });
    created.push("ui");

    const out = (await captureStdout(async () => {
      await runList({ cwd: dir, stack: true });
    })).replace(ANSI, "");

    // api is depth 1 (2 spaces), ui is depth 2 (4 spaces) before the name.
    const lines = out.split("\n");
    const apiLine = lines.find((l) => l.includes("api") && !l.includes("ui"));
    const uiLine = lines.find((l) => l.includes("ui"));
    assertStringIncludes(apiLine ?? "", "  api");
    assertStringIncludes(uiLine ?? "", "    ui");
  } finally {
    // Remove worktrees discovered via git so nested paths are handled.
    for (const b of created) {
      try {
        Deno.removeSync(`${dir}.${b}`, { recursive: true });
      } catch { /* ignore */ }
      try {
        Deno.removeSync(`${dir}.api.${b}`, { recursive: true });
      } catch { /* ignore */ }
    }
    cleanup();
  }
});

Deno.test("list without --stack does not indent", async () => {
  const { dir, cleanup } = await makeRepo();
  const created: string[] = [];
  try {
    await runSwitch({
      branch: "api",
      create: true,
      stack: true,
      cd: { file: null },
      cwd: dir,
    });
    created.push("api");

    const out = (await captureStdout(async () => {
      await runList({ cwd: dir });
    })).replace(ANSI, "");

    // Flat mode: the api row's branch column is not indented with leading spaces
    // beyond the single-space marker column + its separator.
    const apiLine = out.split("\n").find((l) => l.includes("api")) ?? "";
    // In flat mode the branch starts right after the marker/pad; no 2-space
    // stack indent is inserted before the name.
    assertEquals(apiLine.includes("    api"), false);
  } finally {
    for (const b of created) {
      try {
        Deno.removeSync(`${dir}.${b}`, { recursive: true });
      } catch { /* ignore */ }
    }
    cleanup();
  }
});
