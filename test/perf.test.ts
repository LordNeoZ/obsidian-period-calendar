import { test, describe } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";

import {
  parsePeriodFilename,
  DEFAULT_FORMATS,
  type PeriodConfig,
  type MomentFactory,
} from "../src/periods.ts";

const M = moment as unknown as MomentFactory;
const cfg = (over: Partial<PeriodConfig> = {}): PeriodConfig => ({
  enabled: true,
  format: DEFAULT_FORMATS.day,
  folder: "",
  template: "",
  ...over,
});

/**
 * The index parses every markdown file in the vault against every enabled
 * period. On a large vault that is the difference between a plugin that opens
 * instantly and one that freezes Obsidian, so it gets a budget.
 */
describe("indexing cost on a large vault", () => {
  // names that will never parse: the expensive path, since a failure has to
  // exhaust every candidate position before giving up
  const names: string[] = [];
  for (let i = 0; i < 5000; i++) {
    names.push(`Meeting notes about the quarterly roadmap review ${i}`);
  }

  test("5000 non-matching names across 5 periods stay under budget", () => {
    const periods = ["day", "week", "month", "quarter", "year"] as const;
    const started = Date.now();
    let matches = 0;
    for (const n of names) {
      for (const g of periods) {
        const hit = parsePeriodFilename(n, g, cfg({ format: DEFAULT_FORMATS[g] }), M, true);
        if (hit) matches++;
      }
    }
    const ms = Date.now() - started;
    assert.equal(matches, 0, "none of these should parse as a date");
    // measured around 200ms; the ceiling leaves room for slower machines while
    // still catching a regression that removes the length guard
    assert.ok(ms < 800, `indexing 5000 files took ${ms}ms, expected under 800ms`);
    console.log(`      5000 files x 5 periods: ${ms}ms`);
  });

  test("long filenames do not make it worse than short ones", () => {
    const long = "A".repeat(200) + " some note";
    const started = Date.now();
    for (let i = 0; i < 2000; i++) {
      parsePeriodFilename(long, "day", cfg(), M, true);
    }
    const ms = Date.now() - started;
    // the length guard makes these nearly free: a name that long cannot be a
    // date under any format this plugin ships
    assert.ok(ms < 200, `2000 long names took ${ms}ms, expected under 200ms`);
    console.log(`      2000 x 210-char names: ${ms}ms`);
  });

  test("real matches still resolve", () => {
    assert.ok(parsePeriodFilename("2026-07-27 Groceries", "day", cfg(), M, true));
    assert.ok(parsePeriodFilename("2026-07-27", "day", cfg(), M, true));
  });
});
