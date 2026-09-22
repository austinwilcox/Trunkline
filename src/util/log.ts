/**
 * Small styled-output helpers built on `@std/fmt/colors`.
 *
 * Kept intentionally minimal for v1; a richer reporter can replace this later.
 */

import { bold, dim, green, red, yellow } from "@std/fmt/colors";

export function info(msg: string): void {
  console.error(dim(msg));
}

export function success(msg: string): void {
  console.error(green(`✓ ${msg}`));
}

export function warn(msg: string): void {
  console.error(yellow(`▲ ${msg}`));
}

export function error(msg: string): void {
  console.error(red(`✗ ${msg}`));
}

export function heading(msg: string): string {
  return bold(msg);
}

export { bold, dim, green, red, yellow };
