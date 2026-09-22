import { assertEquals } from "@std/assert";
import {
  buildPlans,
  filterPlanByNames,
  normalizeForm,
} from "../src/hooks/model.ts";

Deno.test("normalizeForm: string → one step, one unnamed command", () => {
  const steps = normalizeForm("npm install");
  assertEquals(steps.length, 1);
  assertEquals(steps[0].commands, [{ name: null, template: "npm install" }]);
});

Deno.test("normalizeForm: table → one step, concurrent named commands", () => {
  const steps = normalizeForm({
    server: "npm run dev",
    watch: "npm run watch",
  });
  assertEquals(steps.length, 1);
  assertEquals(steps[0].commands.length, 2);
  assertEquals(steps[0].commands[0], {
    name: "server",
    template: "npm run dev",
  });
});

Deno.test("normalizeForm: pipeline → step per table in order", () => {
  const steps = normalizeForm([
    { install: "npm ci" },
    { build: "npm run build", dev: "npm run dev" },
  ]);
  assertEquals(steps.length, 2);
  assertEquals(steps[0].commands[0], { name: "install", template: "npm ci" });
  assertEquals(steps[1].commands.length, 2);
});

Deno.test("buildPlans preserves source tags", () => {
  const plans = buildPlans([
    { source: "user", form: "echo user" },
    { source: "project", form: "echo project" },
  ]);
  assertEquals(plans.map((p) => p.source), ["user", "project"]);
});

Deno.test("filterPlanByNames keeps only matching named commands", () => {
  const [plan] = buildPlans([{
    source: "project",
    form: { a: "cmd a", b: "cmd b" },
  }]);
  const filtered = filterPlanByNames(plan, ["a"]);
  assertEquals(filtered.steps[0].commands.length, 1);
  assertEquals(filtered.steps[0].commands[0].name, "a");
});
