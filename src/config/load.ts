/**
 * Load and merge trunkline config from the project (`.config/tl.toml`) and user
 * (`~/.config/trunkline/config.toml`) files.
 *
 * Scalar settings: project overrides user. Hooks: both sources are retained and
 * tagged by origin, because they execute with different rules (§5.4) — project
 * hooks require approval, and pre-/post- ordering differs by source.
 */

import { parse as parseToml } from "@std/toml";
import {
  type HookForm,
  type HookType,
  isHookType,
  SETTING_KEYS,
  type Settings,
} from "./schema.ts";
import { projectConfigPath, userConfigPath } from "../util/paths.ts";

export type HookSource = "user" | "project";

/** A hook definition paired with where it came from. */
export interface SourcedHook {
  source: HookSource;
  form: HookForm;
}

/** The merged view used by commands. */
export interface LoadedConfig {
  settings: Settings;
  /** Hooks per type, in run order (user first, then project). */
  hooks: Partial<Record<HookType, SourcedHook[]>>;
  /** Absolute paths that were actually read (for diagnostics). */
  sources: { user?: string; project?: string };
}

interface ParsedFile {
  settings: Settings;
  hooks: Partial<Record<HookType, HookForm>>;
}

/** Load, validate, and merge project + user config. */
export async function loadConfig(repoRoot: string): Promise<LoadedConfig> {
  const userPath = userConfigPath();
  const projectPath = projectConfigPath(repoRoot);

  const user = await readConfigFile(userPath);
  const project = await readConfigFile(projectPath);

  const settings: Settings = {
    ...(user?.settings ?? {}),
    ...(project?.settings ?? {}), // project overrides user
  };

  const hooks: Partial<Record<HookType, SourcedHook[]>> = {};
  const addHooks = (parsed: ParsedFile | null, source: HookSource) => {
    if (!parsed) return;
    for (const [type, form] of Object.entries(parsed.hooks)) {
      const t = type as HookType;
      (hooks[t] ??= []).push({ source, form: form as HookForm });
    }
  };
  // User first so pre-* pipelines run user before project.
  addHooks(user, "user");
  addHooks(project, "project");

  return {
    settings,
    hooks,
    sources: {
      user: user ? userPath : undefined,
      project: project ? projectPath : undefined,
    },
  };
}

/** Read + parse + validate one TOML config file. Returns null if absent. */
async function readConfigFile(path: string): Promise<ParsedFile | null> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }

  let raw: Record<string, unknown>;
  try {
    raw = parseToml(text) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Failed to parse config ${path}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  return validate(raw, path);
}

/** Split a raw TOML object into typed settings + hooks, rejecting unknowns. */
export function validate(
  raw: Record<string, unknown>,
  path: string,
): ParsedFile {
  const settings: Settings = {};
  const hooks: Partial<Record<HookType, HookForm>> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (isHookType(key)) {
      hooks[key] = validateHookForm(value, key, path);
    } else if ((SETTING_KEYS as readonly string[]).includes(key)) {
      if (typeof value !== "string") {
        throw new Error(`${path}: '${key}' must be a string`);
      }
      (settings as Record<string, string>)[key] = value;
    } else {
      throw new Error(`${path}: unknown config key '${key}'`);
    }
  }

  return { settings, hooks };
}

/** Validate that a value is one of the three legal hook shapes. */
export function validateHookForm(
  value: unknown,
  key: string,
  path: string,
): HookForm {
  // string form
  if (typeof value === "string") return value;

  // pipeline form: array of tables of strings
  if (Array.isArray(value)) {
    for (const step of value) {
      assertStringTable(step, key, path);
    }
    return value as Array<Record<string, string>>;
  }

  // table form: object of strings
  if (value && typeof value === "object") {
    assertStringTable(value, key, path);
    return value as Record<string, string>;
  }

  throw new Error(
    `${path}: hook '${key}' must be a string, table, or array of tables`,
  );
}

function assertStringTable(
  value: unknown,
  key: string,
  path: string,
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path}: hook '${key}' step must be a table of commands`);
  }
  for (const [name, cmd] of Object.entries(value)) {
    if (typeof cmd !== "string") {
      throw new Error(
        `${path}: hook '${key}.${name}' must be a string command`,
      );
    }
  }
}
