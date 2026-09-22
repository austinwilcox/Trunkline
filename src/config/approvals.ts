/**
 * Per-machine approval store for project hooks.
 *
 * Project hooks (`.config/tl.toml`) run code committed to a repository, so they
 * require explicit approval before first execution (DESIGN.md §5.4). Approvals
 * are recorded per machine in `~/.config/trunkline/approvals.toml`, keyed by
 * repo path + hook type + command name + a hash of the command template. If the
 * command text changes, its hash changes and approval is required again.
 *
 * User hooks are trusted and never consult this store.
 */

import { parse as parseToml, stringify as stringifyToml } from "@std/toml";
import { approvalsPath } from "../util/paths.ts";

/** One approved command. */
export interface ApprovalEntry {
  type: string;
  /** Command name, or "" for a bare string hook. */
  name: string;
  /** Hash of the command template that was approved. */
  hash: string;
}

/** In-memory view of the approvals file: repo path → approved entries. */
export interface ApprovalsStore {
  byRepo: Record<string, ApprovalEntry[]>;
}

/** Stable SHA-256 hex hash of a command template string. */
export async function hashCommand(template: string): Promise<string> {
  const bytes = new TextEncoder().encode(template);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Load the approvals store, or an empty one if the file is absent. */
export async function loadApprovals(path = approvalsPath()): Promise<
  ApprovalsStore
> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return { byRepo: {} };
    throw err;
  }

  const raw = parseToml(text) as Record<string, unknown>;
  const byRepo: Record<string, ApprovalEntry[]> = {};
  const repos = (raw.repo ?? {}) as Record<string, unknown>;
  for (const [repoPath, value] of Object.entries(repos)) {
    const entries = (value as { approved?: unknown }).approved;
    if (Array.isArray(entries)) {
      byRepo[repoPath] = entries.map((e) => ({
        type: String((e as ApprovalEntry).type),
        name: String((e as ApprovalEntry).name ?? ""),
        hash: String((e as ApprovalEntry).hash),
      }));
    }
  }
  return { byRepo };
}

/** Persist the approvals store to disk (creating parent dirs). */
export async function saveApprovals(
  store: ApprovalsStore,
  path = approvalsPath(),
): Promise<void> {
  const repo: Record<string, { approved: ApprovalEntry[] }> = {};
  for (const [repoPath, entries] of Object.entries(store.byRepo)) {
    if (entries.length > 0) repo[repoPath] = { approved: entries };
  }
  const dir = path.slice(0, path.lastIndexOf("/"));
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(path, stringifyToml({ repo }));
}

/** True if `hash` for (type,name) is already approved for `repoPath`. */
export function isApproved(
  store: ApprovalsStore,
  repoPath: string,
  type: string,
  name: string,
  hash: string,
): boolean {
  const entries = store.byRepo[repoPath];
  if (!entries) return false;
  return entries.some(
    (e) => e.type === type && e.name === name && e.hash === hash,
  );
}

/**
 * Record an approval, replacing any prior entry for the same (type,name) so a
 * changed-and-reapproved command doesn't leave a stale hash behind.
 */
export function addApproval(
  store: ApprovalsStore,
  repoPath: string,
  entry: ApprovalEntry,
): void {
  const entries = store.byRepo[repoPath] ??= [];
  const idx = entries.findIndex(
    (e) => e.type === entry.type && e.name === entry.name,
  );
  if (idx === -1) entries.push(entry);
  else entries[idx] = entry;
}
