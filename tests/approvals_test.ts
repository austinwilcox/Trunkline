import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  addApproval,
  type ApprovalsStore,
  hashCommand,
  isApproved,
  loadApprovals,
  saveApprovals,
} from "../src/config/approvals.ts";
import { gateProjectHooks, type PendingCommand } from "../src/hooks/gate.ts";
import { buildPlans } from "../src/hooks/model.ts";

Deno.test("hashCommand is stable and differs by input", async () => {
  const a = await hashCommand("npm ci");
  const b = await hashCommand("npm ci");
  const c = await hashCommand("npm install");
  assertEquals(a, b);
  assertEquals(a === c, false);
  assertEquals(a.length, 64); // sha-256 hex
});

Deno.test("save then load round-trips approvals", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "tl-appr-" });
  const path = join(tmp, "approvals.toml");
  try {
    const store: ApprovalsStore = { byRepo: {} };
    addApproval(store, "/repo/a", {
      type: "pre-start",
      name: "install",
      hash: "abc",
    });
    await saveApprovals(store, path);

    const loaded = await loadApprovals(path);
    assertEquals(
      isApproved(loaded, "/repo/a", "pre-start", "install", "abc"),
      true,
    );
    assertEquals(
      isApproved(loaded, "/repo/a", "pre-start", "install", "xyz"),
      false,
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("addApproval replaces the prior hash for the same type+name", () => {
  const store: ApprovalsStore = { byRepo: {} };
  addApproval(store, "/r", { type: "pre-start", name: "x", hash: "old" });
  addApproval(store, "/r", { type: "pre-start", name: "x", hash: "new" });
  assertEquals(store.byRepo["/r"].length, 1);
  assertEquals(store.byRepo["/r"][0].hash, "new");
});

Deno.test("loadApprovals returns empty when file is absent", async () => {
  const store = await loadApprovals("/nonexistent/approvals.toml");
  assertEquals(store.byRepo, {});
});

// --- gate flow ---

function projectPlan(form: string | Record<string, string>) {
  return buildPlans([{ source: "project", form }]);
}

Deno.test("gate: user hooks pass through without prompting", async () => {
  const plans = buildPlans([{ source: "user", form: "echo hi" }]);
  let prompted = false;
  const result = await gateProjectHooks("pre-start", plans, {
    repoPath: "/r",
    prompt: () => {
      prompted = true;
      return Promise.resolve(false);
    },
    approvalsPath: "/nonexistent/approvals.toml",
  });
  assertEquals(prompted, false);
  assertEquals(result.length, 1);
  assertEquals(result[0].source, "user");
});

Deno.test("gate: --yes bypasses prompting and allows all", async () => {
  let prompted = false;
  const result = await gateProjectHooks("pre-start", projectPlan("rm -rf /"), {
    repoPath: "/r",
    yes: true,
    prompt: () => {
      prompted = true;
      return Promise.resolve(false);
    },
  });
  assertEquals(prompted, false);
  assertEquals(result[0].steps[0].commands.length, 1);
});

Deno.test("gate: unapproved project hook prompts; approving records + persists", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "tl-gate-" });
  const path = join(tmp, "approvals.toml");
  try {
    let seen: PendingCommand[] = [];
    const result = await gateProjectHooks(
      "pre-start",
      projectPlan("npm ci"),
      {
        repoPath: "/r",
        approvalsPath: path,
        prompt: (_repo, pending) => {
          seen = pending;
          return Promise.resolve(true);
        },
      },
    );
    assertEquals(seen.length, 1);
    assertEquals(seen[0].template, "npm ci");
    assertEquals(result[0].steps[0].commands.length, 1);

    // Now it's remembered: a second run must not prompt.
    let promptedAgain = false;
    await gateProjectHooks("pre-start", projectPlan("npm ci"), {
      repoPath: "/r",
      approvalsPath: path,
      prompt: () => {
        promptedAgain = true;
        return Promise.resolve(false);
      },
    });
    assertEquals(promptedAgain, false);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("gate: declining drops project plans but keeps user plans", async () => {
  const plans = buildPlans([
    { source: "user", form: "echo user" },
    { source: "project", form: "echo project" },
  ]);
  const result = await gateProjectHooks("pre-start", plans, {
    repoPath: "/r",
    approvalsPath: "/nonexistent/a.toml",
    prompt: () => Promise.resolve(false),
  });
  assertEquals(result.length, 1);
  assertEquals(result[0].source, "user");
});

Deno.test("gate: a changed command re-prompts even after prior approval", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "tl-gate2-" });
  const path = join(tmp, "approvals.toml");
  try {
    // Approve the original command.
    await gateProjectHooks("pre-start", projectPlan({ setup: "npm ci" }), {
      repoPath: "/r",
      approvalsPath: path,
      prompt: () => Promise.resolve(true),
    });

    // Same name, changed command → must prompt again.
    let reprompted = false;
    await gateProjectHooks(
      "pre-start",
      projectPlan({ setup: "npm ci --force" }),
      {
        repoPath: "/r",
        approvalsPath: path,
        prompt: () => {
          reprompted = true;
          return Promise.resolve(true);
        },
      },
    );
    assertEquals(reprompted, true);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
