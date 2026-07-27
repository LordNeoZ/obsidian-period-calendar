import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type PeriodCalendarPlugin from "./main.ts";
import {
  GRANULARITIES,
  DEFAULT_FORMATS,
  validateFormat,
  type Granularity,
  type PeriodConfig,
  type WeekSettings,
} from "./periods.ts";

export type OpenIn = "active" | "tab" | "split";

export interface PluginSettings {
  periods: Record<Granularity, PeriodConfig>;
  week: WeekSettings;
  openDailyOnStartup: boolean;
  showWeekNumbers: boolean;
  showDots: boolean;
  confirmBeforeCreate: boolean;
  /** where a note opens when a period is clicked */
  openIn: OpenIn;
  /** treat "20260727 Groceries" as that day's note */
  matchTitleSuffix: boolean;
  /** frontmatter property holding the date; empty disables the lookup */
  frontmatterProperty: string;
}

const LABELS: Record<Granularity, string> = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
  quarter: "Quarterly",
  year: "Yearly",
};

export function defaultSettings(): PluginSettings {
  const periods = {} as Record<Granularity, PeriodConfig>;
  for (const g of GRANULARITIES) {
    periods[g] = {
      enabled: g === "day" || g === "week",
      format: DEFAULT_FORMATS[g],
      folder: "",
      template: "",
    };
  }
  return {
    periods,
    week: { mode: "iso", startOfWeek: 1 },
    openDailyOnStartup: false,
    showWeekNumbers: true,
    showDots: true,
    confirmBeforeCreate: false,
    openIn: "active",
    matchTitleSuffix: false,
    frontmatterProperty: "",
  };
}

const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

export class PeriodCalendarSettingTab extends PluginSettingTab {
  plugin: PeriodCalendarPlugin;

  constructor(app: App, plugin: PeriodCalendarPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /** Persists without blocking the UI handler that triggered it. */
  private save() {
    void this.plugin.saveSettings();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Week").setHeading();

    new Setting(containerEl)
      .setName("Week numbering")
      .setDesc(
        "ISO 8601 weeks start on Monday and week 1 is the one containing the " +
          "first Thursday of the year. Locale weeks follow the start day you pick below."
      )
      .addDropdown((d) =>
        d
          .addOption("iso", "ISO 8601 (recommended)")
          .addOption("locale", "Locale")
          .setValue(this.plugin.settings.week.mode)
          .onChange((v) => {
            this.plugin.settings.week.mode = v as "iso" | "locale";
            this.save();
            this.display();
          })
      );

    if (this.plugin.settings.week.mode === "locale") {
      new Setting(containerEl).setName("Start week on").addDropdown((d) => {
        WEEKDAYS.forEach((w, i) => {
          d.addOption(String(i), w);
        });
        d.setValue(String(this.plugin.settings.week.startOfWeek)).onChange((v) => {
          this.plugin.settings.week.startOfWeek = Number(v);
          this.save();
          this.plugin.refreshViews();
        });
      });
    }

    for (const g of GRANULARITIES) {
      const cfg = this.plugin.settings.periods[g];

      new Setting(containerEl).setName(`${LABELS[g]} notes`).setHeading();

      new Setting(containerEl).setName("Enabled").addToggle((t) =>
        t.setValue(cfg.enabled).onChange((v) => {
          cfg.enabled = v;
          this.save();
          this.plugin.refreshViews();
        })
      );

      if (!cfg.enabled) continue;

      // The fix button is always created and then shown or hidden from the
      // current field value, rather than being decided once on open.
      const formatSetting = new Setting(containerEl)
        .setName("Filename format")
        .setDesc(this.formatDesc(g, cfg.format));

      let pendingFix: string | null = null;
      let fixEl: HTMLElement | null = null;

      const refreshFix = () => {
        const fixable = validateFormat(g, cfg.format).find(
          (i) => i.suggestion && i.suggestion !== cfg.format
        );
        pendingFix = fixable?.suggestion ?? null;
        if (!fixEl) return;
        if (pendingFix) {
          fixEl.show();
          fixEl.setAttribute("aria-label", `Fix: use ${pendingFix}`);
        } else {
          fixEl.hide();
        }
      };

      formatSetting.addText((t) =>
        t
          .setPlaceholder(DEFAULT_FORMATS[g])
          .setValue(cfg.format)
          .onChange((v) => {
            cfg.format = v;
            formatSetting.setDesc(this.formatDesc(g, v));
            refreshFix();
            this.save();
            this.plugin.refreshViews();
          })
      );

      formatSetting.addExtraButton((b) => {
        fixEl = b.extraSettingsEl;
        b.setIcon("wand").onClick(() => {
          if (!pendingFix) return;
          cfg.format = pendingFix;
          this.save();
          this.plugin.refreshViews();
          new Notice(`Format set to ${cfg.format}`);
          this.display();
        });
      });

      refreshFix();

      new Setting(containerEl)
        .setName("Folder")
        .setDesc("Leave empty for the vault root. Subfolders in the format also work.")
        .addText((t) =>
          t
            .setPlaceholder("Journal/Daily")
            .setValue(cfg.folder)
            .onChange((v) => {
              cfg.folder = v;
              this.save();
            })
        );

      new Setting(containerEl)
        .setName("Template")
        .setDesc("Path to a note used as template. Optional.")
        .addText((t) =>
          t
            .setPlaceholder("Templates/Daily.md")
            .setValue(cfg.template)
            .onChange((v) => {
              cfg.template = v;
              this.save();
            })
        );
    }

    new Setting(containerEl).setName("Behaviour").setHeading();

    new Setting(containerEl)
      .setName("Open notes in")
      .setDesc(
        "Where a note opens when you click a period. Ctrl or Cmd click always " +
          "opens a new tab, whatever this is set to."
      )
      .addDropdown((d) =>
        d
          .addOption("active", "Current pane")
          .addOption("tab", "New tab")
          .addOption("split", "Split pane")
          .setValue(this.plugin.settings.openIn)
          .onChange((v) => {
            this.plugin.settings.openIn = v as OpenIn;
            this.save();
          })
      );

    new Setting(containerEl).setName("Open daily note on startup").addToggle((t) =>
      t.setValue(this.plugin.settings.openDailyOnStartup).onChange((v) => {
        this.plugin.settings.openDailyOnStartup = v;
        this.save();
      })
    );

    new Setting(containerEl)
      .setName("Confirm before creating a note")
      .setDesc("Ask first when clicking a period that has no note yet.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.confirmBeforeCreate).onChange((v) => {
          this.plugin.settings.confirmBeforeCreate = v;
          this.save();
        })
      );

    new Setting(containerEl).setName("Show week numbers").addToggle((t) =>
      t.setValue(this.plugin.settings.showWeekNumbers).onChange((v) => {
        this.plugin.settings.showWeekNumbers = v;
        this.save();
        this.plugin.refreshViews();
      })
    );

    new Setting(containerEl).setName("Show a dot on days with notes").addToggle((t) =>
      t.setValue(this.plugin.settings.showDots).onChange((v) => {
        this.plugin.settings.showDots = v;
        this.save();
        this.plugin.refreshViews();
      })
    );

    new Setting(containerEl).setName("Finding existing notes").setHeading();

    new Setting(containerEl)
      .setName("Match notes with a title after the date")
      .setDesc(
        'Counts "20260727 Groceries" as that day\'s note. A separator is required ' +
          "after the date, so trailing digits are not mistaken for a title."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.matchTitleSuffix).onChange((v) => {
          this.plugin.settings.matchTitleSuffix = v;
          this.save();
          this.plugin.rebuildIndex();
        })
      );

    new Setting(containerEl)
      .setName("Frontmatter date property")
      .setDesc(
        "Also match notes by a date in their frontmatter, regardless of filename. " +
          "Leave empty to rely on filenames only."
      )
      .addText((t) =>
        t
          .setPlaceholder("date")
          .setValue(this.plugin.settings.frontmatterProperty)
          .onChange((v) => {
            this.plugin.settings.frontmatterProperty = v.trim();
            this.save();
            this.plugin.rebuildIndex();
          })
      );

    new Setting(containerEl).setName("Migration").setHeading();

    new Setting(containerEl)
      .setName("Import from Periodic Notes / Daily Notes")
      .setDesc(
        "Reads the configuration already stored in this vault and copies it " +
          "here, so your notes keep resolving to the same files. Periods with " +
          "no legacy counterpart are left untouched."
      )
      .addButton((b) =>
        b.setButtonText("Import").onClick(() => {
          void this.plugin.importLegacy().then((n) => {
            new Notice(
              n > 0
                ? `Imported settings for ${n} period${n === 1 ? "" : "s"}.`
                : "Nothing to import: no Periodic Notes or Daily Notes configuration found."
            );
            this.display();
          });
        })
      );
  }

  /** Format field description: preview plus any validation messages. */
  private formatDesc(g: Granularity, format: string): DocumentFragment {
    const frag = createFragment();
    const preview = this.plugin.previewFormat(g, format);

    const line = frag.createDiv({ cls: "pc-fmt-preview" });
    line.setText(`Today would be: ${preview}`);

    for (const issue of validateFormat(g, format)) {
      const d = frag.createDiv({
        cls: issue.level === "error" ? "pc-fmt-error" : "pc-fmt-warning",
      });
      d.setText(`${issue.level === "error" ? "⚠ " : "• "}${issue.message}`);
      if (issue.suggestion && issue.suggestion !== format) {
        d.createSpan({ cls: "pc-fmt-hint", text: ` → ${issue.suggestion}` });
      }
    }
    return frag;
  }
}
