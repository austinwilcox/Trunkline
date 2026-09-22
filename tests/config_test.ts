import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { loadConfig, validate } from "../src/config/load.ts";

/** Run `fn` with an isolated XDG_CONFIG_HOME so user config can't leak in. */
async function withIsolatedUserConfig<T>(
  userToml: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = Deno.env.get("XDG_CONFIG_HOME");
  const tmp = await Deno.makeTempDir({ prefix: "tl-xdg-" });
  Deno.env.set("XDG_CONFIG_HOME", tmp);
  try {
    if (userToml !== null) {
      const dir = join(tmp, "trunkline");
      await Deno.mkdir(dir, { recursive: true });
      await Deno.writeTextFile(join(dir, "config.toml"), userToml);
    }
    return await fn();
  } finally {
    if (prev === undefined) Deno.env.delete("XDG_CONFIG_HOME");
    else Deno.env.set("XDG_CONFIG_HOME", prev);
    await Deno.remove(tmp, { recursive: true });
  }
}

async function makeRepoRoot(projectToml: string | null): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "tl-cfg-" });
  if (projectToml !== null) {
    await Deno.mkdir(join(root, ".config"), { recursive: true });
    await Deno.writeTextFile(join(root, ".config", "tl.toml"), projectToml);
  }
  return root;
}

Deno.test("validate splits settings and hooks, rejects unknown keys", () => {
  const parsed = validate(
    { "main-branch": "trunk", "pre-start": "npm ci" },
    "test",
  );
  assertEquals(parsed.settings["main-branch"], "trunk");
  assertEquals(parsed.hooks["pre-start"], "npm ci");

  assertThrows(
    () => validate({ bogus: "x" }, "test"),
    Error,
    "unknown config key",
  );
});

Deno.test("validate rejects malformed hook forms", () => {
  assertThrows(
    () => validate({ "post-start": 123 }, "test"),
    Error,
    "must be a string, table, or array",
  );
  assertThrows(
    () => validate({ "post-start": { dev: 5 } }, "test"),
    Error,
    "must be a string command",
  );
});

Deno.test("loadConfig returns empty config when no files exist", async () => {
  await withIsolatedUserConfig(null, async () => {
    const root = await makeRepoRoot(null);
    try {
      const cfg = await loadConfig(root);
      assertEquals(cfg.settings, {});
      assertEquals(Object.keys(cfg.hooks).length, 0);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});

Deno.test("loadConfig: project overrides user scalar settings", async () => {
  await withIsolatedUserConfig(`main-branch = "master"\n`, async () => {
    const root = await makeRepoRoot(`main-branch = "develop"\n`);
    try {
      const cfg = await loadConfig(root);
      assertEquals(cfg.settings["main-branch"], "develop");
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});

Deno.test("loadConfig: hooks from both sources retained, user first", async () => {
  await withIsolatedUserConfig(`pre-start = "echo user"\n`, async () => {
    const root = await makeRepoRoot(`pre-start = "echo project"\n`);
    try {
      const cfg = await loadConfig(root);
      const hooks = cfg.hooks["pre-start"]!;
      assertEquals(hooks.length, 2);
      assertEquals(hooks[0].source, "user");
      assertEquals(hooks[1].source, "project");
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});

Deno.test("loadConfig surfaces parse errors", async () => {
  await withIsolatedUserConfig(null, async () => {
    const root = await makeRepoRoot(`this is = = not toml\n`);
    try {
      await assertRejects(
        () => loadConfig(root),
        Error,
        "Failed to parse config",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});
