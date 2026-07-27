import {
  App,
  Modal,
  Plugin,
  TFile,
  TFolder,
  Notice,
  WorkspaceLeaf,
  debounce,
  normalizePath,
} from "obsidian";

import { now, momentFactory } from "./obsidian-moment.ts";

import {
  GRANULARITIES,
  DEFAULT_FORMATS,
  periodPath,
  parsePeriodFilename,
  startOfPeriod,
  shiftPeriod,
  importLegacyConfig,
  joinPath,
  type Granularity,
  type MomentLike,
  type PeriodConfig,
  type LegacyDailyNotes,
  type LegacyPeriodicNotes,
} from "./periods.ts";

import {
  defaultSettings,
  PeriodCalendarSettingTab,
  type PluginSettings,
} from "./settings.ts";
// PluginSettings is used both as a type and to shape loadData()'s result

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

/** period start (YYYY-MM-DD) -> path of the note that represents it */
type PeriodIndex = Record<Granularity, Map<string, string>>;

function emptyIndex(): PeriodIndex {
  const idx = {} as PeriodIndex;
  for (const g of GRANULARITIES) idx[g] = new Map<string, string>();
  return idx;
}

export default class PeriodCalendarPlugin extends Plugin {
  settings: PluginSettings = defaultSettings();

  /**
   * Notes are not always named exactly like the format: they may carry a title
   * after the date, or declare their date in frontmatter. Resolving that by
   * walking the vault on every repaint would be wasteful, so it is indexed once
   * and kept up to date from vault events.
   */
  private index: PeriodIndex = emptyIndex();

  private reindex = debounce(() => this.rebuildIndex(), 400, true);

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
          if (!checking) void this.openPeriodNote(this.now(), g);
          return true;
        },
      });
      this.addCommand({
        id: `open-next-${g}-note`,
        name: `Open next ${LABELS[g]} note`,
        checkCallback: (checking) => {
          if (!this.settings.periods[g].enabled) return false;
          if (!checking) {
            void this.openPeriodNote(
              shiftPeriod(this.now(), g, 1, this.settings.week),
              g
            );
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
            void this.openPeriodNote(
              shiftPeriod(this.now(), g, -1, this.settings.week),
              g
            );
          }
          return true;
        },
      });
    }

    // obsidian://period-calendar?period=week&date=2026-07-27
    this.registerObsidianProtocolHandler("period-calendar", (params) => {
      const g = (params.period ?? "day") as Granularity;
      if (!GRANULARITIES.includes(g)) {
        new Notice(`Unknown period "${params.period ?? ""}".`);
        return;
      }
      let date = this.now();
      if (params.date) {
        const parsed = momentFactory(params.date, "YYYY-MM-DD", true);
        if (!parsed.isValid()) {
          new Notice(`Could not read date "${params.date}". Use YYYY-MM-DD.`);
          return;
        }
        date = parsed;
      }
      void this.openPeriodNote(date, g);
    });

    // registered one by one: vault.on has a different signature per event
    this.registerEvent(this.app.vault.on("create", () => this.reindex()));
    this.registerEvent(this.app.vault.on("delete", () => this.reindex()));
    this.registerEvent(this.app.vault.on("rename", () => this.reindex()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.reindex()));

    this.app.workspace.onLayoutReady(() => {
      this.rebuildIndex();
      if (this.settings.openDailyOnStartup && this.settings.periods.day.enabled) {
        void this.openPeriodNote(this.now(), "day");
      }
    });
  }

  onunload() {}

  // -------------------------------------------------------------------------
  // Index of existing notes
  // -------------------------------------------------------------------------

  /** Which period a file represents, or null if it represents none. */
  private periodOf(
    file: TFile,
    granularity: Granularity,
    cfg: PeriodConfig
  ): string | null {
    // the configured folder scopes the search; empty means the whole vault
    const folder = normalizePath(joinPath(cfg.folder));
    if (folder && folder !== "/" && !file.path.startsWith(folder + "/")) return null;

    const byName = parsePeriodFilename(
      file.basename,
      granularity,
      cfg,
      momentFactory,
      this.settings.matchTitleSuffix
    );
    if (byName) {
      return startOfPeriod(byName, granularity, this.settings.week).format("YYYY-MM-DD");
    }

    const prop = this.settings.frontmatterProperty;
    if (!prop) return null;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const raw = fm?.[prop];
    if (raw === undefined || raw === null) return null;
    // frontmatter dates arrive as strings; take the leading ISO date
    const text = String(raw).trim().slice(0, 10);
    const parsed = momentFactory(text, "YYYY-MM-DD", true);
    if (!parsed.isValid()) return null;
    return startOfPeriod(parsed, granularity, this.settings.week).format("YYYY-MM-DD");
  }

  rebuildIndex() {
    const idx = emptyIndex();
    for (const file of this.app.vault.getMarkdownFiles()) {
      for (const g of GRANULARITIES) {
        const cfg = this.settings.periods[g];
        if (!cfg.enabled) continue;
        const key = this.periodOf(file, g, cfg);
        // first match wins, so the canonical filename is not displaced by a
        // later note that happens to carry the same date
        if (key && !idx[g].has(key)) idx[g].set(key, file.path);
      }
    }
    this.index = idx;
    this.refreshViews();
  }

  /** Path of the note representing this period, if one already exists. */
  private existingPath(date: MomentLike, granularity: Granularity): string | null {
    const key = startOfPeriod(date, granularity, this.settings.week).format("YYYY-MM-DD");
    return this.index[granularity].get(key) ?? null;
  }

  // -------------------------------------------------------------------------
  private now(): MomentLike {
    return now();
  }

  async loadSettings() {
    const saved = (await this.loadData()) as Partial<PluginSettings> | null;
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
      await this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf: WorkspaceLeaf | null = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  // -------------------------------------------------------------------------
  /** Normalized vault path for the period's note. */
  pathFor(date: MomentLike, granularity: Granularity): string {
    const cfg = this.settings.periods[granularity];
    return normalizePath(periodPath(date, granularity, cfg, this.settings.week));
  }

  noteExists(date: MomentLike, granularity: Granularity): boolean {
    if (!this.settings.periods[granularity].enabled) return false;
    return this.existingPath(date, granularity) !== null;
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

    // an existing note may not be named exactly like the format, so the index
    // is consulted before falling back to the canonical path
    const found = this.existingPath(date, granularity);
    if (found) {
      const f = this.app.vault.getAbstractFileByPath(found);
      if (f instanceof TFile) {
        await this.reveal(f, opts);
        return;
      }
    }

    const path = this.pathFor(date, granularity);
    if (this.app.vault.getAbstractFileByPath(path) instanceof TFile) {
      const f = this.app.vault.getAbstractFileByPath(path) as TFile;
      await this.reveal(f, opts);
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
    // an explicit ctrl/cmd click always wins over the configured default
    const leaf = opts.newLeaf
      ? this.app.workspace.getLeaf("tab")
      : this.settings.openIn === "tab"
        ? this.app.workspace.getLeaf("tab")
        : this.settings.openIn === "split"
          ? this.app.workspace.getLeaf("split")
          : this.app.workspace.getLeaf(false);
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
