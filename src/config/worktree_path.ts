/**
 * Resolve the filesystem path for a branch's worktree from a template.
 *
 * The template defaults to {@link DEFAULT_WORKTREE_PATH} but can be overridden
 * by the `worktree-path` config key. Rendering reuses the hook template engine
 * so filters like `sanitize` are available.
 */

import { normalize } from "@std/path";
import { render } from "../hooks/template.ts";
import { DEFAULT_WORKTREE_PATH } from "./schema.ts";
import type { RepoInfo } from "../git/repo.ts";

export interface WorktreePathParams {
  repo: RepoInfo;
  branch: string;
  template?: string;
}

/**
 * Render and normalize the worktree path for `branch`.
 *
 * The template has access to `repo`, `repo_path`, and `branch` plus all
 * template filters. Relative segments (e.g. the default `../`) are collapsed so
 * callers always receive a clean absolute path.
 */
export function resolveWorktreePath(params: WorktreePathParams): string {
  const { repo, branch, template = DEFAULT_WORKTREE_PATH } = params;
  const rendered = render(template, {
    repo: repo.name,
    repo_path: repo.root,
    branch,
  });
  return normalize(rendered);
}
