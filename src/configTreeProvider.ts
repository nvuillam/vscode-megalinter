import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import type { NavigationTarget } from "./extension";
import { extractGroups, SchemaGroups } from "./shared/schemaUtils";
import { hasAnyKeySet } from "./shared/configPresence";
import { prettifyId } from "./webview/menuUtils";

class SectionNode extends vscode.TreeItem {
  constructor(
    public readonly target: NavigationTarget,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    clickable = true,
  ) {
    super(label, collapsibleState);

    if (clickable) {
      this.command = {
        command: "megalinter.revealSection",
        title: "Open section",
        arguments: [target],
      };
    }
  }
}

export class ConfigTreeProvider
  implements vscode.TreeDataProvider<SectionNode>, vscode.Disposable
{
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _groups: SchemaGroups | null = null;
  private _schemaLoaded = false;
  private _configPath?: string;
  private _configKeys: Set<string> = new Set();
  private _configWatcher?: vscode.FileSystemWatcher;

  constructor(private readonly context: vscode.ExtensionContext) {}

  dispose() {
    this._configWatcher?.dispose();
    this._onDidChangeTreeData.dispose();
  }

  setConfigPath(configPath: string) {
    if (this._configWatcher) {
      this._configWatcher.dispose();
      this._configWatcher = undefined;
    }
    this._configPath = configPath;

    if (configPath) {
      // Create a relative pattern if possible, or use absolute path
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(
        vscode.Uri.file(configPath),
      );
      if (workspaceFolder) {
        const relativePath = path.relative(
          workspaceFolder.uri.fsPath,
          configPath,
        );
        this._configWatcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(workspaceFolder, relativePath),
        );
      } else {
        // Fallback for files outside workspace (less common but possible)
        this._configWatcher =
          vscode.workspace.createFileSystemWatcher(configPath);
      }

      this._configWatcher.onDidChange(() => this.refresh());
      this._configWatcher.onDidCreate(() => this.refresh());
      this._configWatcher.onDidDelete(() => this.refresh());
    }
    this.refresh();
  }

  refresh() {
    this._schemaLoaded = false;
    this._groups = null;
    this._onDidChangeTreeData.fire();
  }

  private _categoryLabel(id: string): string {
    const meta = this._groups?.categoryMeta[id];
    if (
      meta?.kind === "linter" &&
      meta.parentId &&
      id.startsWith(`${meta.parentId}_`)
    ) {
      return prettifyId(id.replace(`${meta.parentId}_`, ""));
    }
    if (meta?.label) {
      return prettifyId(meta.label);
    }
    return prettifyId(id);
  }

  private _categoryOrder(id: string): number {
    return this._groups?.categoryMeta[id]?.order ?? Number.MAX_SAFE_INTEGER;
  }

  private _sortCategoryIds(ids: string[]): string[] {
    return [...ids].sort((a, b) => {
      const diff = this._categoryOrder(a) - this._categoryOrder(b);
      if (diff !== 0) {
        return diff;
      }
      return this._categoryLabel(a).localeCompare(this._categoryLabel(b));
    });
  }

  getTreeItem(element: SectionNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SectionNode): vscode.ProviderResult<SectionNode[]> {
    if (!this._schemaLoaded) {
      this._loadSchema();
    }

    if (!this._groups) {
      return [];
    }

    if (!element) {
      const descriptorIds = this._sortCategoryIds(
        Object.keys(this._groups.descriptorKeys),
      );

      const descriptorNodes = descriptorIds.map((descriptorId) => {
        const descriptorKeys = this._groups!.descriptorKeys[descriptorId] || [];
        const linterKeys = Object.values(
          this._groups!.linterKeys[descriptorId] || {},
        ).flat();
        const hasDescriptorValues = hasAnyKeySet(
          [...descriptorKeys, ...linterKeys],
          this._configKeys,
        );
        const baseLabel = this._categoryLabel(descriptorId);
        const label = hasDescriptorValues ? `${baseLabel} *` : baseLabel;
        return new SectionNode(
          { type: "descriptor", descriptorId },
          label,
          vscode.TreeItemCollapsibleState.Collapsed,
          false,
        );
      });

      const hasGeneralValues =
        hasAnyKeySet(this._groups.generalKeys, this._configKeys) ||
        this._configKeys.size > 0;

      const genericCategoryIds = this._sortCategoryIds(
        Object.keys(this._groups.genericCategoryKeys),
      );
      const genericNodes = genericCategoryIds.map((categoryId) => {
        const hasValues = hasAnyKeySet(
          this._groups!.genericCategoryKeys[categoryId] || [],
          this._configKeys,
        );
        const label = this._categoryLabel(categoryId);
        const displayLabel = hasValues ? `${label} *` : label;
        return new SectionNode(
          { type: "category", categoryId },
          displayLabel,
          vscode.TreeItemCollapsibleState.None,
        );
      });

      return [
        new SectionNode(
          { type: "general" },
          hasGeneralValues ? "General *" : "General",
          vscode.TreeItemCollapsibleState.None,
        ),
        ...genericNodes,
        ...descriptorNodes,
      ];
    }

    if (isDescriptorTarget(element.target)) {
      const descriptorId = element.target.descriptorId;
      const linters = this._groups.linterKeys[descriptorId] || {};
      const linterIds = Object.keys(linters).sort();

      const hasDescriptorValues = hasAnyKeySet(
        this._groups.descriptorKeys[descriptorId] || [],
        this._configKeys,
      );

      const descriptorEntry = new SectionNode(
        { type: "descriptor", descriptorId },
        hasDescriptorValues
          ? `${this._categoryLabel(descriptorId)} variables *`
          : `${this._categoryLabel(descriptorId)} variables`,
        vscode.TreeItemCollapsibleState.None,
      );

      const linterNodes = this._sortCategoryIds(linterIds).map((linterId) => {
        const shortLabel = this._categoryLabel(linterId);
        const hasValues = hasAnyKeySet(
          this._groups!.linterKeys[descriptorId]?.[linterId] || [],
          this._configKeys,
        );
        const label = hasValues ? `${shortLabel} *` : shortLabel;
        return new SectionNode(
          {
            type: "linter",
            descriptorId,
            linterId,
          },
          label,
          vscode.TreeItemCollapsibleState.None,
        );
      });

      return [descriptorEntry, ...linterNodes];
    }

    return [];
  }

  private _loadSchema() {
    try {
      const schemaPath = path.join(
        this.context.extensionPath,
        "src",
        "descriptors",
        "schemas",
        "megalinter-configuration.jsonschema.json",
      );

      const schemaContent = fs.readFileSync(schemaPath, "utf8");
      const schema = JSON.parse(schemaContent);
      this._groups = extractGroups(schema);
      this._loadConfigKeys();
    } catch (error) {
      console.error("Failed to load MegaLinter schema for tree view", error);
      this._groups = {
        generalKeys: [],
        genericCategoryKeys: {},
        descriptorKeys: {},
        linterKeys: {},
        categoryMeta: {},
        sectionMeta: { labels: {}, order: [] },
      };
    } finally {
      this._schemaLoaded = true;
    }
  }

  private _loadConfigKeys() {
    this._configKeys = new Set();
    if (!this._configPath || !fs.existsSync(this._configPath)) {
      return;
    }
    try {
      const content = fs.readFileSync(this._configPath, "utf8");
      const doc = YAML.parse(content);
      if (doc && typeof doc === "object") {
        Object.keys(doc).forEach((k) => this._configKeys.add(k));
      }
    } catch (err) {
      console.warn("Failed to parse config for tree highlights", err);
    }
  }
}

const isDescriptorTarget = (
  target: NavigationTarget,
): target is Extract<NavigationTarget, { type: "descriptor" }> =>
  target.type === "descriptor";
