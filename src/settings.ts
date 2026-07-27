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

export interface PluginSettings {
  periods: Record<Granularity, PeriodConfig>;
  week: WeekSettings;
  openDailyOnStartup: boolean;
  showWeekNumbers: boolean;
  showDots: boolean;
  confirmBeforeCreate: boolean;
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
          .onChange(async (v) => {
            this.plugin.settings.week.mode = v as "iso" | "locale";
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.week.mode === "locale") {
      new Setting(containerEl)
        .setName("Start week on")
        .addDropdown((d) => {
          WEEKDAYS.forEach((w, i) => d.addOption(String(i), w));
          d.setValue(String(this.plugin.settings.week.startOfWeek)).onChange(
            async (v) => {
              this.plugin.settings.week.startOfWeek = Number(v);
              await this.plugin.saveSettings();
              this.plugin.refreshViews();
            }
          );
        });
    }

    for (const g of GRANULARITIES) {
      const cfg = this.plugin.settings.periods[g];

      new Setting(containerEl).setName(`${LABELS[g]} notes`).setHeading();

      new Setting(containerEl)
        .setName("Enabled")
        .addToggle((t) =>
          t.setValue(cfg.enabled).onChange(async (v) => {
            cfg.enabled = v;
            await this.plugin.saveSettings();
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
        const issues = validateFormat(g, cfg.format);
        const fixable = issues.find(
          (i) => i.suggestion && i.suggestion !== cfg.format
        );
        pendingFix = fixable?.suggestion ?? null;
        if (!fixEl) return;
        fixEl.toggleClass("pc-hidden", pendingFix === null);
        fixEl.setAttribute(
          "aria-label",
          pendingFix ? `Fix: use ${pendingFix}` : ""
        );
      };

      formatSetting.addText((t) =>
        t
          .setPlaceholder(DEFAULT_FORMATS[g])
          .setValue(cfg.format)
          .onChange(async (v) => {
            cfg.format = v;
            formatSetting.setDesc(this.formatDesc(g, v));
            refreshFix();
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })
      );

      formatSetting.addExtraButton((b) => {
        fixEl = b.extraSettingsEl;
        b.setIcon("wand").onClick(async () => {
          if (!pendingFix) return;
          cfg.format = pendingFix;
          await this.plugin.saveSettings();
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
            .onChange(async (v) => {
              cfg.folder = v;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Template")
        .setDesc("Path to a note used as template. Optional.")
        .addText((t) =>
          t
            .setPlaceholder("Templates/Daily.md")
            .setValue(cfg.template)
            .onChange(async (v) => {
              cfg.template = v;
              await this.plugin.saveSettings();
            })
        );
    }

    // ---- comportamiento ----
    new Setting(containerEl).setName("Behaviour").setHeading();

    new Setting(containerEl)
      .setName("Open daily note on startup")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.openDailyOnStartup).onChange(async (v) => {
          this.plugin.settings.openDailyOnStartup = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Confirm before creating a note")
      .setDesc("Ask first when clicking a period that has no note yet.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.confirmBeforeCreate).onChange(async (v) => {
          this.plugin.settings.confirmBeforeCreate = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Show week numbers")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showWeekNumbers).onChange(async (v) => {
          this.plugin.settings.showWeekNumbers = v;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        })
      );

    new Setting(containerEl)
      .setName("Show a dot on days with notes")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showDots).onChange(async (v) => {
          this.plugin.settings.showDots = v;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        })
      );

    // ---- migracion ----
    new Setting(containerEl).setName("Migration").setHeading();

    new Setting(containerEl)
      .setName("Import from Periodic Notes / Daily Notes")
      .setDesc(
        "Reads the configuration already stored in this vault and copies it " +
          "here, so your notes keep resolving to the same files."
      )
      .addButton((b) =>
        b.setButtonText("Import").onClick(async () => {
          const n = await this.plugin.importLegacy();
          new Notice(
            n > 0
              ? `Imported settings for ${n} period${n === 1 ? "" : "s"}.`
              : "No Periodic Notes or Daily Notes configuration found."
          );
          this.display();
        })
      );
  }

  /** Format field description: preview plus any validation messages. */
  private formatDesc(g: Granularity, format: string): DocumentFragment {
    const frag = document.createDocumentFragment();
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
