import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { extractGroups, REMOVED_LINTERS, SchemaGroups } from './shared/schemaUtils';

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

  constructor(private readonly context: vscode.ExtensionContext) {}

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

      const descriptorNodes = descriptorIds.map(
        (descriptorId) =>
          new SectionNode(
            { type: 'descriptor', descriptorId },
            descriptorId,
            vscode.TreeItemCollapsibleState.Collapsed,
            false
          )
      );

      return [
        new SectionNode({ type: 'general' }, 'General', vscode.TreeItemCollapsibleState.None),
        ...descriptorNodes
      ];
    }

    if (isDescriptorTarget(element.target)) {
      const descriptorId = element.target.descriptorId;
      const linters = this._groups.linterKeys[descriptorId] || {};
      const linterIds = Object.keys(linters).sort();

       const descriptorEntry = new SectionNode(
        { type: 'descriptor', descriptorId },
        'Descriptor variables',
        vscode.TreeItemCollapsibleState.None
      );

      const linterNodes = linterIds.map((linterId) => {
        const shortLabel = linterId.replace(`${descriptorId}_`, '');
        return new SectionNode(
          {
            type: 'linter',
            descriptorId,
            linterId
          },
          shortLabel,
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
}

const isDescriptorTarget = (
  target: NavigationTarget
): target is Extract<NavigationTarget, { type: 'descriptor' }> => target.type === 'descriptor';
