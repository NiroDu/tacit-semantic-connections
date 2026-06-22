import { Plugin, WorkspaceLeaf } from "obsidian";
import { TacitSettings, DEFAULT_SETTINGS, TacitSettingTab } from "./settings";
import { RelatedView, RELATED_VIEW_TYPE } from "./views/related-view";
import { Indexer } from "./index/indexer";
import { StatusBar } from "./ui/status";

export default class TacitPlugin extends Plugin {
  settings!: TacitSettings;
  indexer!: Indexer;
  private statusBar!: StatusBar;

  async onload() {
    await this.loadSettings();

    this.registerView(RELATED_VIEW_TYPE, (leaf) => new RelatedView(leaf, this));
    this.addSettingTab(new TacitSettingTab(this.app, this));

    this.statusBar = new StatusBar(this.addStatusBarItem(), this);
    this.indexer = new Indexer(this.app, this, this.statusBar);

    this.addCommand({
      id: "open-related-notes",
      name: "打开相关笔记面板",
      callback: () => this.activateRelatedView(),
    });

    this.addCommand({
      id: "open-find",
      name: "查找（语义搜索）",
      hotkeys: [],
      callback: () => this.openFind(),
    });

    this.addCommand({
      id: "rebuild-index",
      name: "重建索引",
      callback: async () => {
        await this.indexer.rebuildAll();
      },
    });

    // Brain icon — reflects "tacit knowledge" / semantic thinking
    this.addRibbonIcon("brain", "Tacit — 相关笔记", () => {
      this.activateRelatedView();
    });

    this.app.workspace.onLayoutReady(async () => {
      await this.indexer.init();

      if (this.settings.firstRun) {
        this.settings.firstRun = false;
        await this.saveSettings();
        await this.activateRelatedView();
      }

      // Index is now loaded from disk — refresh any already-open related views
      // so they display cached results immediately (before reconcile scan runs)
      setTimeout(() => this.refreshRelatedViews(), 50);
    });
  }

  onunload() {
    this.indexer?.dispose();
    this.app.workspace.detachLeavesOfType(RELATED_VIEW_TYPE);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /** Refresh all open Related Notes views (called after index load / rebuild) */
  refreshRelatedViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(RELATED_VIEW_TYPE)) {
      if (leaf.view instanceof RelatedView) {
        (leaf.view as RelatedView).refresh();
      }
    }
  }

  async activateRelatedView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const existing = workspace.getLeavesOfType(RELATED_VIEW_TYPE);

    if (existing.length > 0) {
      leaf = existing[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) leaf = workspace.getLeaf("split");
      await leaf.setViewState({ type: RELATED_VIEW_TYPE, active: true });
    }

    workspace.revealLeaf(leaf);
  }

  async openFind() {
    const { FindModal } = await import("./views/find-modal");
    new FindModal(this.app, this).open();
  }
}
