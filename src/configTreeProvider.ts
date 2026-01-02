import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { extractGroups, SchemaGroups } from './shared/schemaUtils';
import { hasAnyKeySet } from './shared/configPresence';

export type NavigationTarget =
  | { type: 'general' }
  | { type: 'descriptor'; descriptorId: string }
  | { type: 'linter'; descriptorId: string; linterId: string };

class SectionNode extends vscode.TreeItem {
  constructor(
    public readonly target: NavigationTarget,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    clickable = true
  ) {
    super(label, collapsibleState);

    if (clickable) {
      this.command = {
        command: 'megalinter.revealSection',
        title: 'Open section',
        arguments: [target]
      };
    }
  }
}

export class ConfigTreeProvider implements vscode.TreeDataProvider<SectionNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _groups: SchemaGroups | null = null;
  private _schemaLoaded = false;
  private _configPath?: string;
  private _configKeys: Set<string> = new Set();
  private _configWatcher?: fs.FSWatcher;

  constructor(private readonly context: vscode.ExtensionContext) {}

  setConfigPath(configPath: string) {
    if (this._configWatcher) {
      this._configWatcher.close();
    }
    this._configPath = configPath;
    this._configWatcher = undefined;
    if (configPath) {
      try {
        if (fs.existsSync(configPath)) {
          this._configWatcher = fs.watch(configPath, () => this.refresh());
        } else {
          const dir = path.dirname(configPath);
          if (dir && fs.existsSync(dir)) {
            this._configWatcher = fs.watch(dir, () => {
              if (fs.existsSync(configPath)) {
                this.refresh();
              }
            });
          }
        }
      } catch (err) {
        console.warn('Failed to watch config file', err);
      }
    }
    this.refresh();
  }

  refresh() {
    this._schemaLoaded = false;
    this._groups = null;
    this._onDidChangeTreeData.fire();
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
      const descriptorIds = Object.keys(this._groups.descriptorKeys).sort();

      const descriptorNodes = descriptorIds.map((descriptorId) => {
        const descriptorKeys = this._groups!.descriptorKeys[descriptorId] || [];
        const linterKeys = Object.values(this._groups!.linterKeys[descriptorId] || {}).flat();
        const hasDescriptorValues = hasAnyKeySet([...descriptorKeys, ...linterKeys], this._configKeys);
        const label = hasDescriptorValues ? `${descriptorId} *` : descriptorId;
        return new SectionNode(
          { type: 'descriptor', descriptorId },
          label,
          vscode.TreeItemCollapsibleState.Collapsed,
          false
        );
      });

      const hasGeneralValues =
        hasAnyKeySet(this._groups.generalKeys, this._configKeys) || this._configKeys.size > 0;

      return [
        new SectionNode(
          { type: 'general' },
          hasGeneralValues ? 'General *' : 'General',
          vscode.TreeItemCollapsibleState.None
        ),
        ...descriptorNodes
      ];
    }

    if (isDescriptorTarget(element.target)) {
      const descriptorId = element.target.descriptorId;
      const linters = this._groups.linterKeys[descriptorId] || {};
      const linterIds = Object.keys(linters).sort();

      const hasDescriptorValues = hasAnyKeySet(
        this._groups.descriptorKeys[descriptorId] || [],
        this._configKeys
      );

      const descriptorEntry = new SectionNode(
        { type: 'descriptor', descriptorId },
        hasDescriptorValues ? 'Descriptor variables *' : 'Descriptor variables',
        vscode.TreeItemCollapsibleState.None
      );

      const linterNodes = linterIds.map((linterId) => {
        const shortLabel = linterId.replace(`${descriptorId}_`, '');
        const hasValues = hasAnyKeySet(
          this._groups!.linterKeys[descriptorId]?.[linterId] || [],
          this._configKeys
        );
        const label = hasValues ? `${shortLabel} *` : shortLabel;
        return new SectionNode(
          {
            type: 'linter',
            descriptorId,
            linterId
          },
          label,
          vscode.TreeItemCollapsibleState.None
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
        'src',
        'schema',
        'megalinter-configuration.jsonschema.json'
      );

      const schemaContent = fs.readFileSync(schemaPath, 'utf8');
      const schema = JSON.parse(schemaContent);
      this._groups = extractGroups(schema);
      this._loadConfigKeys();
    } catch (error) {
      console.error('Failed to load MegaLinter schema for tree view', error);
      this._groups = {
        generalKeys: [],
        descriptorKeys: {},
        linterKeys: {}
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
      const content = fs.readFileSync(this._configPath, 'utf8');
      const doc = YAML.parse(content);
      if (doc && typeof doc === 'object') {
        Object.keys(doc).forEach((k) => this._configKeys.add(k));
      }
    } catch (err) {
      console.warn('Failed to parse config for tree highlights', err);
    }
  }
}

const isDescriptorTarget = (
  target: NavigationTarget
): target is Extract<NavigationTarget, { type: 'descriptor' }> => target.type === 'descriptor';
