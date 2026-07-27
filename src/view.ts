import { ItemView, WorkspaceLeaf, Menu } from "obsidian";
import type PeriodCalendarPlugin from "./main.ts";
import { now } from "./obsidian-moment.ts";
import {
  startOfPeriod,
  shiftPeriod,
  isSamePeriod,
  type Granularity,
  type MomentLike,
} from "./periods.ts";

export const VIEW_TYPE = "period-calendar-view";

const WEEKDAY_LETTERS_ISO = ["M", "T", "W", "T", "F", "S", "S"];

export class CalendarView extends ItemView {
  plugin: PeriodCalendarPlugin;
  /** month currently on screen */
  private cursor: MomentLike;

  constructor(leaf: WorkspaceLeaf, plugin: PeriodCalendarPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.cursor = now();
  }

  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "Period Calendar";
  }
  getIcon() {
    return "calendar-days";
  }

  async onOpen() {
    this.render();
    // repaint on vault changes so the dots stay truthful
    this.registerEvent(this.app.vault.on("create", () => this.render()));
    this.registerEvent(this.app.vault.on("delete", () => this.render()));
    this.registerEvent(this.app.vault.on("rename", () => this.render()));
  }

  public goToday() {
    this.cursor = now();
    this.render();
  }

  public render() {
    const el = this.containerEl.children[1] as HTMLElement;
    el.empty();
    el.addClass("period-calendar");

    this.renderHeader(el);
    this.renderGrid(el);
    this.renderPeriodBar(el);
  }

  // -------------------------------------------------------------------------
  private renderHeader(root: HTMLElement) {
    const header = root.createDiv({ cls: "pc-header" });

    const nav = header.createDiv({ cls: "pc-nav" });
    this.iconButton(nav, "‹", "Previous month", () => {
      this.cursor = shiftPeriod(this.cursor, "month", -1, this.plugin.settings.week);
      this.render();
    });
    this.iconButton(nav, "•", "Today", () => this.goToday());
    this.iconButton(nav, "›", "Next month", () => {
      this.cursor = shiftPeriod(this.cursor, "month", 1, this.plugin.settings.week);
      this.render();
    });

    const title = header.createDiv({ cls: "pc-title" });

    const monthEl = title.createSpan({
      cls: "pc-title-part",
      text: this.cursor.format("MMMM"),
    });
    this.markIfNoteExists(monthEl, "month", this.cursor);
    this.wirePeriod(monthEl, "month", () => this.cursor);

    const yearEl = title.createSpan({
      cls: "pc-title-part",
      text: this.cursor.format("YYYY"),
    });
    this.markIfNoteExists(yearEl, "year", this.cursor);
    this.wirePeriod(yearEl, "year", () => this.cursor);
  }

  /** Adds the dot to any period that already has a note. */
  private markIfNoteExists(
    el: HTMLElement,
    granularity: Granularity,
    date: MomentLike
  ) {
    if (!this.plugin.settings.showDots) return;
    if (!this.plugin.settings.periods[granularity].enabled) return;
    if (!this.plugin.noteExists(date, granularity)) return;
    el.addClass("pc-has-note");
    el.createSpan({ cls: "pc-dot" });
  }

  // -------------------------------------------------------------------------
  private renderGrid(root: HTMLElement) {
    const s = this.plugin.settings;
    const table = root.createEl("table", { cls: "pc-grid" });

    const thead = table.createEl("thead");
    const hr = thead.createEl("tr");
    if (s.showWeekNumbers) hr.createEl("th", { cls: "pc-wk-head", text: "W" });

    const letters = this.weekdayLetters();
    for (const l of letters) hr.createEl("th", { text: l });

    const tbody = table.createEl("tbody");

    const monthStart = startOfPeriod(this.cursor, "month", s.week);
    const monthEnd = startOfPeriod(this.cursor, "month", s.week).endOf("month");
    let cursor = startOfPeriod(monthStart, "week", s.week);
    const today = now();

    // six rows cover any month, so the grid never jumps height between months
    for (let row = 0; row < 6; row++) {
      const tr = tbody.createEl("tr");

      if (s.showWeekNumbers) {
        const weekStart = cursor.clone();
        const wkCell = tr.createEl("td", { cls: "pc-wk" });
        const label =
          s.week.mode === "iso" ? cursor.format("WW") : cursor.format("ww");
        wkCell.setText(label);
        this.markIfNoteExists(wkCell, "week", weekStart);
        this.wirePeriod(wkCell, "week", () => weekStart);
      }

      for (let i = 0; i < 7; i++) {
        const day = cursor.clone();
        const td = tr.createEl("td", { cls: "pc-day" });
        td.setText(day.format("D"));

        if (!isSamePeriod(day, monthStart, "month", s.week)) {
          td.addClass("pc-outside");
        }
        if (isSamePeriod(day, today, "day", s.week)) {
          td.addClass("pc-today");
        }
        if (s.showDots && this.plugin.noteExists(day, "day")) {
          td.addClass("pc-has-note");
          td.createSpan({ cls: "pc-dot" });
        }

        this.wirePeriod(td, "day", () => day);
        cursor = cursor.clone().add(1, "day");
      }

      // skip a trailing row that fell entirely outside the month
      if (
        row >= 4 &&
        cursor.clone().subtract(1, "day").format("YYYY-MM") >
          monthEnd.format("YYYY-MM")
      ) {
        break;
      }
    }
  }

  /** Bottom bar with quarter and year. */
  private renderPeriodBar(root: HTMLElement) {
    const s = this.plugin.settings;
    const enabled = (["quarter", "year"] as Granularity[]).filter(
      (g) => s.periods[g].enabled
    );
    if (enabled.length === 0) return;

    const bar = root.createDiv({ cls: "pc-bar" });
    for (const g of enabled) {
      const label =
        g === "quarter" ? this.cursor.format("[Q]Q") : this.cursor.format("YYYY");
      const btn = bar.createEl("button", { cls: "pc-bar-btn", text: label });
      this.markIfNoteExists(btn, g, this.cursor);
      this.wirePeriod(btn, g, () => this.cursor);
    }
  }

  // -------------------------------------------------------------------------
  /** Click opens or creates; middle click opens in a new tab; right click menu. */
  private wirePeriod(
    el: HTMLElement,
    granularity: Granularity,
    getDate: () => MomentLike
  ) {
    if (!this.plugin.settings.periods[granularity].enabled) {
      el.addClass("pc-disabled");
      return;
    }
    el.addClass("pc-clickable");

    el.addEventListener("click", (evt) => {
      void this.plugin.openPeriodNote(getDate(), granularity, {
        newLeaf: evt.ctrlKey || evt.metaKey,
      });
    });

    el.addEventListener("auxclick", (evt) => {
      if (evt.button === 1) {
        evt.preventDefault();
        void this.plugin.openPeriodNote(getDate(), granularity, { newLeaf: true });
      }
    });

    el.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      const menu = new Menu();
      menu.addItem((i) =>
        i
          .setTitle("Open in new tab")
          .setIcon("file-plus")
          .onClick(() => {
            void this.plugin.openPeriodNote(getDate(), granularity, {
              newLeaf: true,
            });
          })
      );
      menu.addItem((i) =>
        i
          .setTitle("Copy note path")
          .setIcon("copy")
          .onClick(() => {
            const p = this.plugin.pathFor(getDate(), granularity);
            void navigator.clipboard.writeText(p);
          })
      );
      menu.showAtMouseEvent(evt);
    });
  }

  private iconButton(
    parent: HTMLElement,
    label: string,
    tooltip: string,
    onClick: () => void
  ) {
    const b = parent.createEl("button", { cls: "pc-nav-btn", text: label });
    b.setAttribute("aria-label", tooltip);
    b.addEventListener("click", onClick);
  }

  private weekdayLetters(): string[] {
    const s = this.plugin.settings;
    if (s.week.mode === "iso") return WEEKDAY_LETTERS_ISO;
    // base starts on Sunday and is rotated to the configured start day
    const base = ["S", "M", "T", "W", "T", "F", "S"];
    const start = ((s.week.startOfWeek % 7) + 7) % 7;
    return base.slice(start).concat(base.slice(0, start));
  }
}
