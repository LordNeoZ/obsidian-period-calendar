import { moment } from "obsidian";
import type { MomentFactory, MomentLike } from "./periods.ts";

/**
 * Typed boundary around the moment instance Obsidian re-exports.
 *
 * `obsidian.moment` is declared as `typeof import("moment")`, which resolves to
 * `any` in the plugin review linter. Rather than scattering casts across every
 * call site — and getting "unsafe value" warnings at each one — the untyped
 * boundary is crossed exactly once, here, and the rest of the plugin consumes
 * the narrow `MomentLike` surface defined in periods.ts.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const factory: MomentFactory = moment as unknown as MomentFactory;

/** Current date and time. */
export function now(): MomentLike {
  return factory();
}

/** Strictly parses a string against a moment format. */
export function parseStrict(input: string, format: string): MomentLike {
  return factory(input, format, true);
}

export { factory as momentFactory };
