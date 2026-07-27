/**
 * Period resolution core.
 *
 * No Obsidian imports here on purpose: everything in this file is testable
 * with plain Node. The UI lives elsewhere.
 *
 * The problem this module exists to solve: moment has two week systems that
 * look almost identical and cannot be mixed.
 *
 *   ISO 8601   GGGG (ISO week-year) + WW (ISO week) + E (day 1..7)
 *              Weeks start on Monday; week 1 contains the first Thursday.
 *   Locale     gggg (locale week-year) + ww (locale week) + e
 *              Week start depends on the locale.
 *
 * `YYYY` is the calendar year and belongs to neither. Combining it with a
 * week token breaks at the year boundary: 2024-12-30 falls in ISO week 1 of
 * 2025, so `YYYY-[W]WW` writes "2024-W01", which collides with January of the
 * same year and sorts wrong. The correct format is `GGGG-[W]WW` -> "2025-W01".
 */

export type Granularity = "day" | "week" | "month" | "quarter" | "year";

export const GRANULARITIES: Granularity[] = [
  "day",
  "week",
  "month",
  "quarter",
  "year",
];

export type WeekMode = "iso" | "locale";

export interface PeriodConfig {
  enabled: boolean;
  /** moment format for the filename */
  format: string;
  /** target folder, relative to the vault root */
  folder: string;
  /** optional template path */
  template: string;
}

export interface WeekSettings {
  mode: WeekMode;
  /** locale mode only: 0 = Sunday ... 6 = Saturday */
  startOfWeek: number;
}

export const DEFAULT_FORMATS: Record<Granularity, string> = {
  day: "YYYY-MM-DD",
  week: "GGGG-[W]WW",
  month: "YYYY-MM",
  quarter: "YYYY-[Q]Q",
  year: "YYYY",
};

/**
 * Units for startOf/endOf. `isoWeek` is valid here but NOT as a duration:
 * moment has no "add one isoWeek", only "add one week".
 */
export type BoundaryUnit =
  | "day"
  | "week"
  | "isoWeek"
  | "month"
  | "quarter"
  | "year";

/** Units valid for add/subtract. */
export type DurationUnit = "day" | "week" | "month" | "quarter" | "year";

/** Minimal moment surface, to avoid depending on the full type. */
export interface MomentLike {
  clone(): MomentLike;
  format(fmt: string): string;
  startOf(unit: BoundaryUnit): MomentLike;
  endOf(unit: BoundaryUnit): MomentLike;
  add(n: number, unit: DurationUnit): MomentLike;
  subtract(n: number, unit: DurationUnit): MomentLike;
  isValid(): boolean;
  /** day of the week, 0 = Sunday */
  day(): number;
}

export type MomentFactory = (
  input?: string,
  format?: string,
  strict?: boolean
) => MomentLike;

// ---------------------------------------------------------------------------
// Format validation
// ---------------------------------------------------------------------------

export interface FormatIssue {
  level: "error" | "warning";
  message: string;
  /** corrected format, when one can be inferred */
  suggestion?: string;
}

/** Text in square brackets is literal in moment, so it must be ignored. */
function stripLiterals(format: string): string {
  return format.replace(/\[[^\]]*\]/g, "");
}

/**
 * Replaces tokens without touching bracketed literals.
 *
 * Without this, correcting "gggg-[W]WW" would also rewrite the literal W in
 * the label and produce "gggg-[w]ww".
 */
function replaceOutsideLiterals(
  format: string,
  pattern: RegExp,
  replacement: string
): string {
  return format
    .split(/(\[[^\]]*\])/)
    .map((chunk) =>
      chunk.startsWith("[") ? chunk : chunk.replace(pattern, replacement)
    )
    .join("");
}

export function validateWeekFormat(format: string): FormatIssue[] {
  const issues: FormatIssue[] = [];
  const bare = stripLiterals(format);

  const hasIsoWeek = /\bWW?\b/.test(bare);
  const hasLocaleWeek = /\bww?\b/.test(bare);
  const hasIsoYear = /\bGGGG\b|\bGG\b/.test(bare);
  const hasLocaleYear = /\bgggg\b|\bgg\b/.test(bare);
  const hasCalendarYear = /\bYYYY\b|\bYY\b/.test(bare);

  if (!hasIsoWeek && !hasLocaleWeek) {
    issues.push({
      level: "error",
      message:
        "This weekly format has no week token. Add WW (ISO week) or ww (locale week).",
      suggestion: DEFAULT_FORMATS.week,
    });
    return issues;
  }

  if (hasIsoWeek && hasLocaleWeek) {
    issues.push({
      level: "error",
      message:
        "Mixing WW (ISO week) and ww (locale week) in the same format. Pick one.",
      suggestion: DEFAULT_FORMATS.week,
    });
  }

  if (hasCalendarYear && hasIsoWeek) {
    issues.push({
      level: "error",
      message:
        "YYYY is the calendar year, but WW is the ISO week. At the turn of the " +
        "year these disagree — 2024-12-30 belongs to ISO week 1 of 2025, so " +
        "YYYY-[W]WW writes '2024-W01' and collides with January. Use GGGG.",
      suggestion: replaceOutsideLiterals(
        replaceOutsideLiterals(format, /YYYY/g, "GGGG"),
        /YY(?!YY)/g,
        "GG"
      ),
    });
  }
  if (hasCalendarYear && hasLocaleWeek) {
    issues.push({
      level: "error",
      message:
        "YYYY is the calendar year, but ww is the locale week. Use gggg so the " +
        "year matches the week numbering at year boundaries.",
      suggestion: replaceOutsideLiterals(
        replaceOutsideLiterals(format, /YYYY/g, "gggg"),
        /YY(?!YY)/g,
        "gg"
      ),
    });
  }
  if (hasIsoYear && hasLocaleWeek) {
    issues.push({
      level: "error",
      message: "GGGG (ISO week-year) paired with ww (locale week). Use GGGG with WW.",
      suggestion: replaceOutsideLiterals(
        replaceOutsideLiterals(format, /\bww\b/g, "WW"),
        /\bw\b/g,
        "W"
      ),
    });
  }
  if (hasLocaleYear && hasIsoWeek) {
    issues.push({
      level: "error",
      message: "gggg (locale week-year) paired with WW (ISO week). Use gggg with ww.",
      suggestion: replaceOutsideLiterals(
        replaceOutsideLiterals(format, /\bWW\b/g, "ww"),
        /\bW\b/g,
        "w"
      ),
    });
  }

  if (!hasIsoYear && !hasLocaleYear && !hasCalendarYear) {
    issues.push({
      level: "warning",
      message:
        "No year token. Week numbers repeat every year, so notes from " +
        "different years will collide.",
      suggestion: DEFAULT_FORMATS.week,
    });
  }

  return issues;
}

export function weekModeOfFormat(format: string): WeekMode {
  const bare = stripLiterals(format);
  if (/\bWW?\b|\bGGGG\b|\bGG\b/.test(bare)) return "iso";
  return "locale";
}

export function validateDayFormat(format: string): FormatIssue[] {
  const issues: FormatIssue[] = [];
  const bare = stripLiterals(format);
  if (!/\bYYYY\b|\bYY\b/.test(bare)) {
    issues.push({
      level: "warning",
      message: "No year token in the daily format. Notes from different years will collide.",
      suggestion: DEFAULT_FORMATS.day,
    });
  }
  const y = bare.indexOf("YYYY");
  const m = bare.search(/\bMM?\b/);
  const d = bare.search(/\bDD?\b/);
  if (y > -1 && m > -1 && d > -1 && !(y < m && m < d)) {
    issues.push({
      level: "warning",
      message:
        "Year-month-day order sorts chronologically in the file explorer. " +
        "Other orders do not.",
      suggestion: DEFAULT_FORMATS.day,
    });
  }
  return issues;
}

export function validateFormat(
  granularity: Granularity,
  format: string
): FormatIssue[] {
  if (!format || !format.trim()) {
    return [
      {
        level: "error",
        message: "Format is empty.",
        suggestion: DEFAULT_FORMATS[granularity],
      },
    ];
  }
  if (granularity === "week") return validateWeekFormat(format);
  if (granularity === "day") return validateDayFormat(format);
  return [];
}

// ---------------------------------------------------------------------------
// Period arithmetic
// ---------------------------------------------------------------------------

function unitFor(granularity: Granularity, weekMode: WeekMode): BoundaryUnit {
  if (granularity === "week") return weekMode === "iso" ? "isoWeek" : "week";
  return granularity;
}

export function startOfPeriod(
  date: MomentLike,
  granularity: Granularity,
  week: WeekSettings
): MomentLike {
  if (granularity === "week" && week.mode === "locale") {
    // moment reads the global locale; the configured start day is applied
    // here instead so the global locale is left alone.
    const d = date.clone();
    const diff = (d.day() - week.startOfWeek + 7) % 7;
    return d.subtract(diff, "day").startOf("day");
  }
  return date.clone().startOf(unitFor(granularity, week.mode));
}

export function endOfPeriod(
  date: MomentLike,
  granularity: Granularity,
  week: WeekSettings
): MomentLike {
  if (granularity === "week" && week.mode === "locale") {
    return startOfPeriod(date, granularity, week).add(6, "day").endOf("day");
  }
  return date.clone().endOf(unitFor(granularity, week.mode));
}

export function shiftPeriod(
  date: MomentLike,
  granularity: Granularity,
  delta: number,
  week: WeekSettings
): MomentLike {
  const base = startOfPeriod(date, granularity, week);
  const unit: DurationUnit = granularity === "week" ? "week" : granularity;
  return delta >= 0 ? base.add(delta, unit) : base.subtract(-delta, unit);
}

export function isSamePeriod(
  a: MomentLike,
  b: MomentLike,
  granularity: Granularity,
  week: WeekSettings
): boolean {
  return startOfPeriod(a, granularity, week).format("YYYY-MM-DD") ===
    startOfPeriod(b, granularity, week).format("YYYY-MM-DD");
}

// ---------------------------------------------------------------------------
// File paths
// ---------------------------------------------------------------------------

export function joinPath(...parts: string[]): string {
  return parts
    .map((p) => (p || "").replace(/^\/+|\/+$/g, ""))
    .filter((p) => p.length > 0)
    .join("/");
}

/**
 * Filename for the period, without extension.
 * The format may contain slashes ("YYYY/MM/YYYY-MM-DD"), which Obsidian
 * treats as subfolders.
 */
export function periodFilename(
  date: MomentLike,
  granularity: Granularity,
  config: PeriodConfig,
  week: WeekSettings
): string {
  const start = startOfPeriod(date, granularity, week);
  return start.format(config.format || DEFAULT_FORMATS[granularity]);
}

export function periodPath(
  date: MomentLike,
  granularity: Granularity,
  config: PeriodConfig,
  week: WeekSettings
): string {
  const name = periodFilename(date, granularity, config, week);
  return joinPath(config.folder, name) + ".md";
}

/** Separators allowed between a date prefix and a free-text title. */
const TITLE_SEPARATORS = [" ", "-", "_", "."];

function tryExact(
  text: string,
  format: string,
  moment: MomentFactory
): MomentLike | null {
  const parsed = moment(text, format, true);
  if (!parsed || !parsed.isValid()) return null;
  // round-trip: if reformatting does not reproduce the input, it was not
  // really this period. Keeps "2026-1-1" from passing as "2026-01-01".
  if (parsed.format(format) !== text) return null;
  return parsed;
}

/**
 * How long a rendered date can be for a given format.
 *
 * Walking every position of a filename looking for a date prefix is what makes
 * indexing a large vault slow: a name that will never match has to exhaust all
 * of them before giving up. A format renders to a small set of lengths, so only
 * those positions are worth testing.
 *
 * Every month is probed because month names vary in length ("May" against
 * "September"), and two day numbers because days do too. The result is cached
 * per format, so this runs once rather than once per file.
 */
const lengthCache = new Map<string, number[]>();

function candidateLengths(format: string, moment: MomentFactory): number[] {
  const cached = lengthCache.get(format);
  if (cached) return cached;

  const lengths = new Set<number>();
  for (let month = 1; month <= 12; month++) {
    for (const day of [1, 21]) {
      const iso = `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const m = moment(iso, "YYYY-MM-DD", true);
      if (m && m.isValid()) lengths.add(m.format(format).length);
    }
  }
  const out = Array.from(lengths).sort((a, b) => b - a); // longest first
  lengthCache.set(format, out);
  return out;
}

/**
 * Reads a filename as a period, or returns null.
 *
 * Strict parsing plus a round-trip check keeps notes like "Meeting notes"
 * from being read as dates.
 *
 * With `allowTitleSuffix`, a date followed by free text also counts, so
 * "20260727 Groceries" resolves to that day. The longest valid prefix wins,
 * and a separator is required after it — otherwise "202607271" would parse as
 * a date with a stray digit.
 */
export function parsePeriodFilename(
  basename: string,
  granularity: Granularity,
  config: PeriodConfig,
  moment: MomentFactory,
  allowTitleSuffix = false
): MomentLike | null {
  const fmt = config.format || DEFAULT_FORMATS[granularity];
  // a format may carry subfolders; only the last segment names the file
  const leaf = fmt.split("/").pop() as string;

  const lengths = candidateLengths(leaf, moment);
  // A name far longer than anything this format can render is not a date, and
  // finding that out costs nothing compared to a strict parse. The margin
  // covers formats whose length the probes may not have reproduced exactly.
  const maxLen = (lengths.length > 0 ? lengths[0] : 40) + 4;

  if (basename.length <= maxLen) {
    const exact = tryExact(basename, leaf, moment);
    if (exact) return exact;
  }
  if (!allowTitleSuffix) return null;

  // only the lengths this format can actually produce, longest first so the
  // longest valid date prefix wins
  for (const len of lengths) {
    if (len < 4 || len >= basename.length) continue;
    if (!TITLE_SEPARATORS.includes(basename[len])) continue;
    const hit = tryExact(basename.slice(0, len), leaf, moment);
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

export interface LegacyDailyNotes {
  format?: string;
  folder?: string;
  template?: string;
}

export interface LegacyPeriodicNotes {
  daily?: { enabled?: boolean; format?: string; folder?: string; template?: string };
  weekly?: { enabled?: boolean; format?: string; folder?: string; template?: string };
  monthly?: { enabled?: boolean; format?: string; folder?: string; template?: string };
  quarterly?: { enabled?: boolean; format?: string; folder?: string; template?: string };
  yearly?: { enabled?: boolean; format?: string; folder?: string; template?: string };
}

const LEGACY_KEYS: Record<Granularity, keyof LegacyPeriodicNotes> = {
  day: "daily",
  week: "weekly",
  month: "monthly",
  quarter: "quarterly",
  year: "yearly",
};

/**
 * Builds configuration from what the vault already has.
 * Priority: Periodic Notes, then core Daily Notes.
 *
 * Only periods actually present in the legacy configuration are returned.
 * Periods with no legacy counterpart are omitted rather than filled with
 * defaults, so importing never overwrites settings the user configured here
 * for periods those older plugins never supported.
 */
export function importLegacyConfig(
  daily: LegacyDailyNotes | null,
  periodic: LegacyPeriodicNotes | null
): Partial<Record<Granularity, PeriodConfig>> {
  const out: Partial<Record<Granularity, PeriodConfig>> = {};

  for (const g of GRANULARITIES) {
    const legacy = periodic ? periodic[LEGACY_KEYS[g]] : undefined;
    if (legacy && (legacy.format || legacy.folder || legacy.enabled !== undefined)) {
      out[g] = {
        enabled: legacy.enabled !== false,
        format: legacy.format || DEFAULT_FORMATS[g],
        folder: legacy.folder || "",
        template: legacy.template || "",
      };
      continue;
    }
    if (g === "day" && daily && (daily.format || daily.folder)) {
      out[g] = {
        enabled: true,
        format: daily.format || DEFAULT_FORMATS.day,
        folder: daily.folder || "",
        template: daily.template || "",
      };
    }
  }
  return out;
}
