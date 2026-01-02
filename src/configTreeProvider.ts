import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export type NavigationTarget =
  | { type: 'general' }
  | { type: 'descriptor'; descriptorId: string }
  | { type: 'linter'; descriptorId: string; linterId: string };

type SchemaGroups = {
  generalKeys: string[];
  descriptorKeys: Record<string, string[]>;
  linterKeys: Record<string, Record<string, string[]>>;
};

const REMOVED_LINTERS = new Set([
  'CREDENTIALS_SECRETLINT',
  'DOCKERFILE_DOCKERFILELINT',
  'GIT_GIT_DIFF',
  'PHP_BUILTIN',
  'KUBERNETES_KUBEVAL',
  'REPOSITORY_GOODCHECK',
  'SPELL_MISSPELL',
  'TERRAFORM_CHECKOV',
  'TERRAFORM_KICS',
  'CSS_SCSSLINT',
  'OPENAPI_SPECTRAL',
  'SQL_SQL_LINT',
  'MARKDOWN_MARKDOWN_LINK_CHECK'
]);

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

const extractGroups = (schema: any): SchemaGroups => {
  const properties = (schema.properties as Record<string, any>) || {};
  const descriptorEnums = (schema.definitions as any)?.enum_descriptor_keys?.enum as
    | string[]
    | undefined;
  const linterEnums = (schema.definitions as any)?.enum_linter_keys?.enum as string[] | undefined;

  const descriptorListRaw = Array.isArray(descriptorEnums) ? descriptorEnums : [];
  const linterListRaw = Array.isArray(linterEnums) ? linterEnums : [];
  const linterList = linterListRaw.filter((l) => !REMOVED_LINTERS.has(l));

  const descriptorsWithLinters = new Set<string>();
  linterList.forEach((l) => {
    const [descriptorId] = l.split('_');
    if (descriptorId) {
      descriptorsWithLinters.add(descriptorId);
    }
  });

  const descriptorList = descriptorListRaw.filter((d) => descriptorsWithLinters.has(d));

  const descriptorKeys: Record<string, string[]> = {};
  const linterKeys: Record<string, Record<string, string[]>> = {};
  const generalKeys: string[] = [];

  const linterDescriptorMap: Record<string, string> = {};
  linterList.forEach((l) => {
    const parts = l.split('_');
    const descriptor = parts[0];
    linterDescriptorMap[l] = descriptor;
  });

  const descriptorPrefixes = descriptorList.map((d) => `${d}_`);
  const linterPrefixes = linterList.map((l) => `${l}_`);
  const removedLinterPrefixes = Array.from(REMOVED_LINTERS).map((l) => `${l}_`);

  Object.keys(properties).forEach((propKey) => {
    if (removedLinterPrefixes.some((p) => propKey.startsWith(p))) {
      return;
    }

    const linterPrefix = linterPrefixes.find((p) => propKey.startsWith(p));
    if (linterPrefix) {
      const linterKey = linterPrefix.slice(0, -1);
      const descriptor = linterDescriptorMap[linterKey];
      if (descriptor) {
        if (!linterKeys[descriptor]) {
          linterKeys[descriptor] = {};
        }
        if (!linterKeys[descriptor][linterKey]) {
          linterKeys[descriptor][linterKey] = [];
        }
        linterKeys[descriptor][linterKey].push(propKey);
        return;
      }
    }

    const descriptorPrefix = descriptorPrefixes.find((p) => propKey.startsWith(p));
    if (descriptorPrefix) {
      const descriptor = descriptorPrefix.slice(0, -1);
      if (!descriptorKeys[descriptor]) {
        descriptorKeys[descriptor] = [];
      }
      descriptorKeys[descriptor].push(propKey);
      return;
    }

    generalKeys.push(propKey);
  });

  Object.keys(descriptorKeys).forEach((d) => {
    if (!descriptorList.includes(d)) {
      delete descriptorKeys[d];
    }
  });

  return { generalKeys, descriptorKeys, linterKeys };
};

const isDescriptorTarget = (
  target: NavigationTarget
): target is Extract<NavigationTarget, { type: 'descriptor' }> => target.type === 'descriptor';
