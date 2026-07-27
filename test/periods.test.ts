import { test, describe } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";

import {
  validateWeekFormat,
  validateDayFormat,
  validateFormat,
  weekModeOfFormat,
  startOfPeriod,
  endOfPeriod,
  shiftPeriod,
  isSamePeriod,
  joinPath,
  periodFilename,
  periodPath,
  parsePeriodFilename,
  importLegacyConfig,
  DEFAULT_FORMATS,
  type WeekSettings,
  type PeriodConfig,
  type MomentLike,
  type MomentFactory,
} from "../src/periods.ts";

const ISO: WeekSettings = { mode: "iso", startOfWeek: 1 };
const SUNDAY: WeekSettings = { mode: "locale", startOfWeek: 0 };
const M = moment as unknown as MomentFactory;
const at = (s: string) => moment(s, "YYYY-MM-DD", true) as unknown as MomentLike;

const cfg = (over: Partial<PeriodConfig> = {}): PeriodConfig => ({
  enabled: true,
  format: DEFAULT_FORMATS.day,
  folder: "",
  template: "",
  ...over,
});

// ---------------------------------------------------------------------------
describe("ISO week vs calendar year", () => {
  test("2024-12-30 falls in ISO week 1 of 2025", () => {
    // independent of the plugin: this is a fact of the ISO calendar
    assert.equal(moment("2024-12-30", "YYYY-MM-DD").isoWeek(), 1);
    assert.equal(moment("2024-12-30", "YYYY-MM-DD").isoWeekYear(), 2025);
  });

  test("YYYY-[W]WW produces the wrong filename", () => {
    const wrong = moment("2024-12-30", "YYYY-MM-DD").format("YYYY-[W]WW");
    assert.equal(wrong, "2024-W01"); // collides with January 2024
  });

  test("GGGG-[W]WW produces the right filename", () => {
    const right = moment("2024-12-30", "YYYY-MM-DD").format("GGGG-[W]WW");
    assert.equal(right, "2025-W01");
  });

  test("the validator flags YYYY+WW and suggests GGGG", () => {
    const issues = validateWeekFormat("YYYY-[W]WW");
    const err = issues.find((i) => i.level === "error");
    assert.ok(err, "should report an error");
    assert.equal(err!.suggestion, "GGGG-[W]WW");
    assert.match(err!.message, /ISO week/);
  });

  test("the correct format raises no errors", () => {
    const issues = validateWeekFormat("GGGG-[W]WW");
    assert.equal(issues.filter((i) => i.level === "error").length, 0);
  });
});

describe("format validation", () => {
  test("rejects mixing WW with ww", () => {
    const issues = validateWeekFormat("gggg-[W]WW-ww");
    assert.ok(issues.some((i) => i.level === "error"));
  });

  test("gggg with ww is valid", () => {
    const issues = validateWeekFormat("gggg-[W]ww");
    assert.equal(issues.filter((i) => i.level === "error").length, 0);
  });

  test("gggg with WW is corrected to ww", () => {
    const issues = validateWeekFormat("gggg-[W]WW");
    const err = issues.find((i) => i.level === "error");
    assert.ok(err);
    assert.equal(err!.suggestion, "gggg-[W]ww");
  });

  test("a weekly format with no week token is an error", () => {
    const issues = validateWeekFormat("YYYY-MM");
    assert.ok(issues.some((i) => i.level === "error" && /no week token/i.test(i.message)));
  });

  test("a week with no year warns about collisions", () => {
    const issues = validateWeekFormat("[W]WW");
    assert.ok(issues.some((i) => /year/i.test(i.message)));
  });

  test("an empty format is an error", () => {
    assert.equal(validateFormat("week", "").length, 1);
    assert.equal(validateFormat("week", "")[0].level, "error");
  });

  test("DD-MM-YYYY warns about file ordering", () => {
    const issues = validateDayFormat("DD-MM-YYYY");
    assert.ok(issues.some((i) => /sorts chronologically/i.test(i.message)));
  });

  test("YYYY-MM-DD raises nothing", () => {
    assert.equal(validateDayFormat("YYYY-MM-DD").length, 0);
  });

  test("bracketed text is literal and never read as a token", () => {
    // [Week] contains a 'W' that must not be treated as the ISO token
    assert.equal(weekModeOfFormat("gggg-[Week]-ww"), "locale");
  });

  test("regression: suggestions never corrupt bracketed literals", () => {
    const a = validateWeekFormat("gggg-[W]WW").find((i) => i.level === "error");
    assert.ok(a);
    assert.equal(a!.suggestion, "gggg-[W]ww");

    const b = validateWeekFormat("YYYY-[Week]WW").find((i) => i.level === "error");
    assert.ok(b);
    assert.ok(b!.suggestion!.includes("[Week]"), "the literal must survive");
    assert.equal(b!.suggestion, "GGGG-[Week]WW");
  });
});

describe("period arithmetic", () => {
  test("an ISO week starts on Monday", () => {
    const s = startOfPeriod(at("2026-07-26"), "week", ISO); // a Sunday
    assert.equal(s.format("YYYY-MM-DD"), "2026-07-20");
    assert.equal(s.format("dddd"), "Monday");
  });

  test("a locale week can start on Sunday", () => {
    const s = startOfPeriod(at("2026-07-26"), "week", SUNDAY); // already Sunday
    assert.equal(s.format("YYYY-MM-DD"), "2026-07-26");
    const s2 = startOfPeriod(at("2026-07-29"), "week", SUNDAY); // Wednesday
    assert.equal(s2.format("YYYY-MM-DD"), "2026-07-26");
  });

  test("a locale week ends six days later", () => {
    const e = endOfPeriod(at("2026-07-29"), "week", SUNDAY);
    assert.equal(e.format("YYYY-MM-DD"), "2026-08-01");
  });

  test("quarters", () => {
    assert.equal(startOfPeriod(at("2026-05-14"), "quarter", ISO).format("YYYY-MM-DD"), "2026-04-01");
    assert.equal(endOfPeriod(at("2026-05-14"), "quarter", ISO).format("YYYY-MM-DD"), "2026-06-30");
    assert.equal(at("2026-05-14").format("YYYY-[Q]Q"), "2026-Q2");
  });

  test("months and years, including leap years", () => {
    assert.equal(startOfPeriod(at("2026-02-17"), "month", ISO).format("YYYY-MM-DD"), "2026-02-01");
    assert.equal(endOfPeriod(at("2024-02-17"), "month", ISO).format("YYYY-MM-DD"), "2024-02-29");
    assert.equal(startOfPeriod(at("2026-07-26"), "year", ISO).format("YYYY-MM-DD"), "2026-01-01");
  });

  test("stepping forwards and backwards", () => {
    assert.equal(shiftPeriod(at("2026-07-26"), "week", 1, ISO).format("YYYY-MM-DD"), "2026-07-27");
    assert.equal(shiftPeriod(at("2026-07-26"), "week", -1, ISO).format("YYYY-MM-DD"), "2026-07-13");
    assert.equal(shiftPeriod(at("2026-01-15"), "month", -1, ISO).format("YYYY-MM"), "2025-12");
    assert.equal(shiftPeriod(at("2026-01-15"), "quarter", 3, ISO).format("YYYY-[Q]Q"), "2026-Q4");
  });

  test("stepping across the year boundary in ISO weeks", () => {
    const next = shiftPeriod(at("2024-12-30"), "week", 1, ISO);
    assert.equal(next.format("GGGG-[W]WW"), "2025-W02");
  });

  test("isSamePeriod separates adjacent weeks", () => {
    assert.ok(isSamePeriod(at("2026-07-20"), at("2026-07-26"), "week", ISO));
    assert.ok(!isSamePeriod(at("2026-07-19"), at("2026-07-20"), "week", ISO));
  });
});

describe("file paths", () => {
  test("joinPath normalises slashes", () => {
    assert.equal(joinPath("/Journal/", "/Daily/"), "Journal/Daily");
    assert.equal(joinPath("", "notes"), "notes");
    assert.equal(joinPath("a", "", "b"), "a/b");
  });

  test("a plain path", () => {
    const p = periodPath(at("2026-07-26"), "day", cfg({ folder: "Journal" }), ISO);
    assert.equal(p, "Journal/2026-07-26.md");
  });

  test("a format containing subfolders", () => {
    const p = periodPath(
      at("2026-07-26"),
      "day",
      cfg({ folder: "Journal", format: "YYYY/MM/YYYY-MM-DD" }),
      ISO
    );
    assert.equal(p, "Journal/2026/07/2026-07-26.md");
  });

  test("a weekly filename uses the start of the period, not the given date", () => {
    const name = periodFilename(
      at("2026-07-26"), // a Sunday
      "week",
      cfg({ format: "GGGG-[W]WW" }),
      ISO
    );
    assert.equal(name, "2026-W30");
  });
});

describe("filename parsing", () => {
  test("recognises a daily note", () => {
    const d = parsePeriodFilename("2026-07-26", "day", cfg(), M);
    assert.ok(d);
    assert.equal(d!.format("YYYY-MM-DD"), "2026-07-26");
  });

  test("rejects text that is not a date", () => {
    assert.equal(parsePeriodFilename("Meeting notes", "day", cfg(), M), null);
    assert.equal(parsePeriodFilename("Project 2026", "day", cfg(), M), null);
  });

  test("rejects impossible dates", () => {
    assert.equal(parsePeriodFilename("2026-02-30", "day", cfg(), M), null);
    assert.equal(parsePeriodFilename("2026-13-01", "day", cfg(), M), null);
  });

  test("recognises an ISO weekly note", () => {
    const w = parsePeriodFilename("2026-W30", "week", cfg({ format: "GGGG-[W]WW" }), M);
    assert.ok(w);
    assert.equal(w!.format("GGGG-[W]WW"), "2026-W30");
  });

  test("with a subfolder format, only the last segment is parsed", () => {
    const d = parsePeriodFilename("2026-07-26", "day", cfg({ format: "YYYY/MM/YYYY-MM-DD" }), M);
    assert.ok(d);
  });
});

describe("legacy import", () => {
  test("prefers the Periodic Notes configuration when present", () => {
    const out = importLegacyConfig(null, {
      daily: { enabled: true, format: "YYYY-MM-DD", folder: "Diary" },
      weekly: { enabled: true, format: "gggg-[W]ww", folder: "Weeks" },
    });
    assert.equal(out.day!.folder, "Diary");
    assert.equal(out.week!.format, "gggg-[W]ww");
    assert.equal(out.week!.folder, "Weeks");
  });

  test("falls back to core Daily Notes", () => {
    const out = importLegacyConfig({ format: "DD-MM-YYYY", folder: "Journal" }, null);
    assert.equal(out.day!.format, "DD-MM-YYYY");
    assert.equal(out.day!.folder, "Journal");
  });

  test("with nothing to import, returns nothing", () => {
    assert.deepEqual(importLegacyConfig(null, null), {});
  });

  test("respects an explicit enabled:false", () => {
    const out = importLegacyConfig(null, { weekly: { enabled: false, format: "gggg-[W]ww" } });
    assert.equal(out.week!.enabled, false);
  });

  test("an imported broken format is still caught by the validator", () => {
    const out = importLegacyConfig(null, { weekly: { enabled: true, format: "YYYY-[W]WW" } });
    const issues = validateFormat("week", out.week!.format);
    assert.ok(issues.some((i) => i.level === "error"));
    assert.equal(issues[0].suggestion, "GGGG-[W]WW");
  });

  // Regression: importing used to fill every period with defaults, wiping the
  // folder a user had configured for periods the old plugins never supported.
  test("periods absent from the legacy config are omitted, not defaulted", () => {
    const out = importLegacyConfig(null, {
      daily: { enabled: true, format: "YYYY-MM-DD", folder: "Journal/Daily" },
      weekly: { enabled: true, format: "GGGG-[W]WW", folder: "Journal/Weekly" },
    });
    assert.ok(out.day, "day comes from the legacy config");
    assert.ok(out.week, "week comes from the legacy config");
    assert.equal(out.month, undefined);
    assert.equal(out.quarter, undefined);
    assert.equal(out.year, undefined);
    assert.deepEqual(Object.keys(out).sort(), ["day", "week"]);
  });

  test("core Daily Notes alone imports only the day", () => {
    const out = importLegacyConfig({ format: "DD-MM-YYYY", folder: "Journal" }, null);
    assert.deepEqual(Object.keys(out), ["day"]);
  });
});
