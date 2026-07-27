# Period Calendar

A calendar for Obsidian where **every period is clickable** — day, week, month, quarter and year — with ISO weeks handled correctly.

It reads the configuration you already have in Periodic Notes or Daily Notes, so your existing notes keep resolving to the same files.

---

## Why this exists

Two things kept coming up in the issue trackers of the plugins people use for this, and neither was ever fixed:

**1. Only days and weeks were clickable.** Monthly, quarterly and yearly notes had no way in from the calendar. Across both trackers this is the single most requested feature, with over a hundred reactions spread across seven separate issues.

**2. Week filenames break at the turn of the year.** This one is subtle and costs you real notes.

Moment.js has two week systems that look almost identical:

| Tokens | System | Week starts | Week 1 is |
|---|---|---|---|
| `GGGG` `WW` `E` | ISO 8601 | Monday | the week containing the first Thursday |
| `gggg` `ww` `e` | Locale | depends on locale | depends on locale |

`YYYY` is the **calendar** year and does not belong with either of them. Mix them and you get this:

```
2024-12-30 is a Monday, and it belongs to ISO week 1 of 2025.

  YYYY-[W]WW  →  2024-W01   ✗  collides with January 2024, sorts wrong
  GGGG-[W]WW  →  2025-W01   ✓
```

That silent collision is what produces "unable to create new file" and duplicate weekly notes every January. Period Calendar **detects it, explains it in plain language, and fixes it with one click**.

---

## Features

- **Five periods, all clickable.** Click a day, a week number, the month name, the year, or the quarter button.
- **Format validation as you type.** Wrong week tokens, missing year, `DD-MM-YYYY` ordering that breaks your file explorer — each one is caught, explained, and fixable in one click.
- **ISO or locale weeks**, with a configurable first day of the week.
- **Subfolders in the format.** `YYYY/MM/YYYY-MM-DD` creates the folder tree for you.
- **Imports your existing setup** from Periodic Notes or core Daily Notes.
- **Strict filename parsing**, so `Meeting notes` is never mistaken for a date.
- **Commands for everything**, including opening the calendar view itself, and next/previous for each period.
- **Open today's note on startup**, optional.
- Templates per period, dots on days that already have notes, and a middle-click or Ctrl-click to open in a new tab.

---

## Installing

**From the community plugins browser** (once approved): search for *Period Calendar*.

**Manually:** download `main.js`, `manifest.json` and `styles.css` from the [latest release](../../releases/latest) into `<your vault>/.obsidian/plugins/period-calendar/`, then enable it in Settings → Community plugins.

---

## Coming from Periodic Notes?

If you use Periodic Notes for monthly, quarterly or yearly notes, you have probably wanted a calendar that can actually open them. That integration is the single most requested thing across both plugins' issue trackers, and it is what this one is built around: **the month name, the year, the quarter button and the week number are all clickable**, not just the days.

You also get the week format checked. Periodic Notes will happily accept `YYYY-[W]WW`, and that quietly writes the wrong filename every January — see the section above.

## Migrating from Calendar or Periodic Notes

Go to **Settings → Period Calendar → Migration** and press **Import**. It reads the configuration those plugins already store in your vault and copies it over, so nothing moves and no note is orphaned.

Periods you configured here that the older plugins never supported — monthly, quarterly, yearly — are left untouched by the import. It only brings over what actually exists on the other side.

If the imported format has one of the problems described above, it gets flagged right there with the fix.

You can keep the old plugins installed while you try this one — they do not conflict.

---

## Default formats

| Period | Default | Example |
|---|---|---|
| Day | `YYYY-MM-DD` | `2026-07-26` |
| Week | `GGGG-[W]WW` | `2026-W30` |
| Month | `YYYY-MM` | `2026-07` |
| Quarter | `YYYY-[Q]Q` | `2026-Q3` |
| Year | `YYYY` | `2026` |

Anything in square brackets is literal text, so `[W]` prints a `W` and is never read as a token. All of these are editable.

---

## Development

```bash
npm install
npm test          # 37 unit tests over the period logic
npm run build     # bundles to build/main.js
```

The period logic lives in `src/periods.ts` and has no Obsidian dependencies, so it is testable with plain Node. The tests cover the year-boundary cases, both week systems, leap years, subfolder paths, strict parsing and legacy import.

> Note when testing inside Obsidian: `Ctrl+R` does **not** reload plugin code. Restart Obsidian, or toggle the plugin off and on.

---

## License

MIT
