import {
  App,
  Modal,
  Plugin,
  TFile,
  TFolder,
  Notice,
  WorkspaceLeaf,
  normalizePath,
  moment,
} from "obsidian";

import {
  GRANULARITIES,
  DEFAULT_FORMATS,
  periodPath,
  startOfPeriod,
  shiftPeriod,
  importLegacyConfig,
  type Granularity,
  type MomentLike,
  type LegacyDailyNotes,
  type LegacyPeriodicNotes,
} from "./periods.ts";

import {
  defaultSettings,
  PeriodCalendarSettingTab,
  type PluginSettings,
} from "./settings.ts";

import { CalendarView, VIEW_TYPE } from "./view.ts";

const LABELS: Record<Granularity, string> = {
  day: "daily",
  week: "weekly",
  month: "monthly",
  quarter: "quarterly",
  year: "yearly",
};

/**
 * Confirmation before creating a note.
 * A Modal rather than a native dialog: native dialogs block the app thread
 * and behave badly on mobile.
 */
class ConfirmCreateModal extends Modal {
  constructor(
    app: App,
    private readonly path: string,
    private readonly onConfirm: () => void
  ) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText("Create note?");
    this.contentEl.createEl("p", { text: this.path });

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons
      .createEl("button", { text: "Cancel" })
      .addEventListener("click", () => this.close());
    buttons
      .createEl("button", { cls: "mod-cta", text: "Create" })
      .addEventListener("click", () => {
        this.close();
        this.onConfirm();
      });
  }

  onClose() {
    this.contentEl.empty();
  }
}

export default class PeriodCalendarPlugin extends Plugin {
  settings: PluginSettings = defaultSettings();

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf) => new CalendarView(leaf, this));
    this.addSettingTab(new PeriodCalendarSettingTab(this.app, this));

    this.addRibbonIcon("calendar-days", "Open Period Calendar", () =>
      this.activateView()
    );

    this.addCommand({
      id: "open-calendar-view",
      name: "Open calendar view",
      callback: () => this.activateView(),
    });

    for (const g of GRANULARITIES) {
      this.addCommand({
        id: `open-${g}-note`,
        name: `Open ${LABELS[g]} note`,
        checkCallback: (checking) => {
          if (!this.settings.periods[g].enabled) return false;
          if (!checking) this.openPeriodNote(this.now(), g);
          return true;
        },
      });
      this.addCommand({
        id: `open-next-${g}-note`,
        name: `Open next ${LABELS[g]} note`,
        checkCallback: (checking) => {
          if (!this.settings.periods[g].enabled) return false;
          if (!checking) {
            this.openPeriodNote(shiftPeriod(this.now(), g, 1, this.settings.week), g);
          }
          return true;
        },
      });
      this.addCommand({
        id: `open-previous-${g}-note`,
        name: `Open previous ${LABELS[g]} note`,
        checkCallback: (checking) => {
          if (!this.settings.periods[g].enabled) return false;
          if (!checking) {
            this.openPeriodNote(shiftPeriod(this.now(), g, -1, this.settings.week), g);
          }
          return true;
        },
      });
    }

    this.app.workspace.onLayoutReady(async () => {
      if (this.settings.openDailyOnStartup && this.settings.periods.day.enabled) {
        await this.openPeriodNote(this.now(), "day");
      }
    });
  }

  onunload() {}

  // -------------------------------------------------------------------------
  private now(): MomentLike {
    return moment() as unknown as MomentLike;
  }

  async loadSettings() {
    const saved = await this.loadData();
    this.settings = Object.assign(defaultSettings(), saved ?? {});
    // deep-merge periods so any added later never arrives undefined on upgrade
    const base = defaultSettings();
    for (const g of GRANULARITIES) {
      this.settings.periods[g] = Object.assign(
        base.periods[g],
        this.settings.periods?.[g] ?? {}
      );
    }
    this.settings.week = Object.assign(base.week, this.settings.week ?? {});
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const v = leaf.view;
      if (v instanceof CalendarView) v.render();
    }
  }

  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf: WorkspaceLeaf | null = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  // -------------------------------------------------------------------------
  /** Normalized vault path for the period's note. */
  pathFor(date: MomentLike, granularity: Granularity): string {
    const cfg = this.settings.periods[granularity];
    return normalizePath(periodPath(date, granularity, cfg, this.settings.week));
  }

  noteExists(date: MomentLike, granularity: Granularity): boolean {
    if (!this.settings.periods[granularity].enabled) return false;
    const f = this.app.vault.getAbstractFileByPath(this.pathFor(date, granularity));
    return f instanceof TFile;
  }

  /** How today would look under a given format. Used by the settings preview. */
  previewFormat(granularity: Granularity, format: string): string {
    try {
      const start = startOfPeriod(this.now(), granularity, this.settings.week);
      return start.format(format || DEFAULT_FORMATS[granularity]);
    } catch {
      return "—";
    }
  }

  private async ensureFolder(path: string) {
    const dir = path.substring(0, path.lastIndexOf("/"));
    if (!dir) return;
    const existing = this.app.vault.getAbstractFileByPath(dir);
    if (existing instanceof TFolder) return;
    try {
      await this.app.vault.createFolder(dir);
    } catch {
      // another operation may have created it concurrently; only fail if it
      // really is not there
      if (!(this.app.vault.getAbstractFileByPath(dir) instanceof TFolder)) throw new Error(
        `Could not create folder: ${dir}`
      );
    }
  }

  private async templateContent(granularity: Granularity): Promise<string> {
    const tpl = this.settings.periods[granularity].template?.trim();
    if (!tpl) return "";
    const path = normalizePath(tpl.endsWith(".md") ? tpl : `${tpl}.md`);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) return this.app.vault.cachedRead(f);
    new Notice(`Template not found: ${path}`);
    return "";
  }

  async openPeriodNote(
    date: MomentLike,
    granularity: Granularity,
    opts: { newLeaf?: boolean } = {}
  ) {
    const cfg = this.settings.periods[granularity];
    if (!cfg.enabled) {
      new Notice(`${LABELS[granularity]} notes are disabled in settings.`);
      return;
    }

    const path = this.pathFor(date, granularity);
    const existing = this.app.vault.getAbstractFileByPath(path);

    if (existing instanceof TFile) {
      await this.reveal(existing, opts);
      return;
    }

    if (this.settings.confirmBeforeCreate) {
      new ConfirmCreateModal(this.app, path, () => {
        void this.createAndOpen(path, granularity, opts);
      }).open();
      return;
    }
    await this.createAndOpen(path, granularity, opts);
  }

  private async createAndOpen(
    path: string,
    granularity: Granularity,
    opts: { newLeaf?: boolean }
  ) {
    try {
      await this.ensureFolder(path);
      const file = await this.app.vault.create(
        path,
        await this.templateContent(granularity)
      );
      await this.reveal(file, opts);
    } catch (e) {
      // surface the reason instead of failing silently
      new Notice(`Could not create ${path}: ${(e as Error).message}`);
    }
  }

  private async reveal(file: TFile, opts: { newLeaf?: boolean }) {
    const leaf = this.app.workspace.getLeaf(opts.newLeaf ? "tab" : false);
    await leaf.openFile(file);
    this.refreshViews();
  }

  // -------------------------------------------------------------------------
  /**
   * Copies configuration from Periodic Notes and core Daily Notes.
   * Returns how many periods changed.
   */
  async importLegacy(): Promise<number> {
    const daily = await this.readJson<LegacyDailyNotes>(
      `${this.app.vault.configDir}/daily-notes.json`
    );
    const periodic = await this.readJson<LegacyPeriodicNotes>(
      `${this.app.vault.configDir}/plugins/periodic-notes/data.json`
    );

    if (!daily && !periodic) return 0;

    const imported = importLegacyConfig(daily, periodic);
    let count = 0;
    for (const g of GRANULARITIES) {
      const src = imported[g];
      // periods absent from the legacy config are left untouched
      if (!src) continue;
      const cur = this.settings.periods[g];
      if (src.format !== cur.format || src.folder !== cur.folder) count++;
      this.settings.periods[g] = { ...cur, ...src };
    }
    await this.saveSettings();
    this.refreshViews();
    return count;
  }

  /**
   * Reads a JSON file from the config folder.
   *
   * The Adapter API is used deliberately here, despite the guideline favouring
   * the Vault API: files under `.obsidian/` are not part of the indexed vault,
   * so the Vault API cannot reach them.
   */
  private async readJson<T>(path: string): Promise<T | null> {
    try {
      const exists = await this.app.vault.adapter.exists(path);
      if (!exists) return null;
      const raw = await this.app.vault.adapter.read(path);
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
}
