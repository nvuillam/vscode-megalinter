import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getGitOriginRepositoryName, isGitRepository } from './gitUtils';
import type { FlavorPanelInboundMessage, FlavorPanelOutboundMessage } from './shared/webviewMessages';
import {
  buildWebviewHtml,
  createMegalinterWebviewPanel,
  disposeAll,
  openExternalHttpUrl
} from './panelUtils';

const FLAVOR_FILE_CANDIDATES = [
  'megalinter-custom-flavor.yml',
  'megalinter-custom-flavor.yaml',
  'mega-linter-flavor.yml',
  'mega-linter-flavor.yaml'
] as const;

const DEFAULT_FLAVOR_FILE = FLAVOR_FILE_CANDIDATES[0];

const NOT_A_GIT_REPO_MESSAGE =
  'Selected folder is not a Git repository.\n\n' +
  'Create a blank repository on GitHub (for example: megalinter-custom-flavor-<your-name>) and clone it into another folder, then select that cloned folder here.';

const NOT_A_CUSTOM_FLAVOR_REPO_MESSAGE =
  "This generator must be run in a repository whose name includes 'megalinter-custom-flavor'.\n\n" +
  "Create a blank repository on GitHub whose name starts with 'megalinter-custom-flavor' (for example: megalinter-custom-flavor-my-stack), clone it locally, then select that cloned folder.";

export class CustomFlavorPanel {
  public static currentPanel: CustomFlavorPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _preferredFolderPath: string | undefined;
  private _webviewReady = false;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri, initialUri?: vscode.Uri): CustomFlavorPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (CustomFlavorPanel.currentPanel) {
      CustomFlavorPanel.currentPanel._panel.reveal(column);
      CustomFlavorPanel.currentPanel._setPreferredFolderFromUri(initialUri);
      CustomFlavorPanel.currentPanel._tryAutoSelectPreferredFolder();
      CustomFlavorPanel.currentPanel._update();
      return CustomFlavorPanel.currentPanel;
    }

    const panel = createMegalinterWebviewPanel({
      viewType: 'megalinterCustomFlavor',
      title: 'MegaLinter Custom Flavor Builder',
      extensionUri,
      column
    });

    CustomFlavorPanel.currentPanel = new CustomFlavorPanel(panel, extensionUri, initialUri);
    return CustomFlavorPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, initialUri?: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._setPreferredFolderFromUri(initialUri);

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message: FlavorPanelInboundMessage) => {
        try {
          switch (message.type) {
            case 'ready':
              this._webviewReady = true;
              await this._sendFlavorContext();
              this._tryAutoSelectPreferredFolder();
              break;
            case 'getFlavorContext':
              await this._sendFlavorContext();
              this._tryAutoSelectPreferredFolder();
              break;
            case 'pickFlavorFolder':
              await this._pickFlavorFolder();
              break;
            case 'runCustomFlavorSetup':
              await this._runCustomFlavorSetup(message.folderPath, message.linters);
              break;
            case 'loadFlavorDefinition':
              await this._sendFlavorDefinition(message.folderPath);
              break;
            case 'openFile':
              await this._openFile(message.filePath);
              break;
            case 'openExternal':
              await openExternalHttpUrl(message.url);
              break;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this._postMessage({ type: 'error', message: msg });
        }
      },
      null,
      this._disposables
    );
  }

  public dispose() {
    CustomFlavorPanel.currentPanel = undefined;
    this._panel.dispose();

    disposeAll(this._disposables);
  }

  private _update() {
    const webview = this._panel.webview;
    this._webviewReady = false;
    this._panel.webview.html = this._getHtmlForWebview(webview);
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    return buildWebviewHtml({
      webview,
      extensionUri: this._extensionUri,
      title: 'MegaLinter Custom Flavor Builder',
      view: 'flavor'
    });
  }

  private _postMessage(message: FlavorPanelOutboundMessage) {
    this._panel.webview.postMessage(message);
  }

  private async _sendFlavorContext() {
    const folders = vscode.workspace.workspaceFolders || [];

    const workspaceRootPaths = folders.map((f) => f.uri.fsPath);
    const workspaceFlavorRoot = findWorkspaceRootWithFlavorFile(workspaceRootPaths);
    const isWorkspaceFlavorRepo = workspaceFlavorRoot !== null;

    const defaultFolderPath = this._preferredFolderPath
      ? this._preferredFolderPath
      : workspaceFlavorRoot;

    this._postMessage({
      type: 'flavorContext',
      workspaceFolders: folders.map((f) => ({ name: f.name, path: f.uri.fsPath })),
      defaultFolderPath: defaultFolderPath || undefined,
      isWorkspaceFlavorRepo
    });
  }

  private _setPreferredFolderFromUri(initialUri?: vscode.Uri) {
    if (!initialUri) {
      return;
    }

    const fsPath = initialUri.fsPath;
    if (!fsPath) {
      return;
    }

    try {
      if (fs.existsSync(fsPath) && fs.lstatSync(fsPath).isDirectory()) {
        this._preferredFolderPath = fsPath;
        return;
      }

      // Invoked from a file context menu: use its parent folder.
      this._preferredFolderPath = path.dirname(fsPath);
    } catch {
      // ignore
    }
  }

  private _tryAutoSelectPreferredFolder() {
    if (!this._webviewReady) {
      return;
    }

    // Prefer explicit folder (e.g. invoked from right-click).
    if (this._preferredFolderPath) {
      this._postMessage({ type: 'flavorFolderSelected', folderPath: this._preferredFolderPath });
      void this._sendFlavorDefinition(this._preferredFolderPath);
      return;
    }

    // Otherwise, if the current workspace is already a flavor repo, select it.
    const folders = vscode.workspace.workspaceFolders || [];
    const workspaceFlavorRoot = findWorkspaceRootWithFlavorFile(folders.map((f) => f.uri.fsPath));
    if (workspaceFlavorRoot) {
      this._preferredFolderPath = workspaceFlavorRoot;
      this._postMessage({ type: 'flavorFolderSelected', folderPath: workspaceFlavorRoot });
      void this._sendFlavorDefinition(workspaceFlavorRoot);
    }
  }

  private async _pickFlavorFolder() {
    const selection = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select Custom Flavor Repository Folder'
    });

    if (!selection || !selection.length) {
      return;
    }

    const folderPath = selection[0].fsPath;

    if (!this._ensureValidFlavorRepository(folderPath)) {
      return;
    }

    // If the current workspace is not already a custom flavor repo, reload VS Code
    // with the selected folder as the workspace root.
    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    const workspaceFlavorRoot = findWorkspaceRootWithFlavorFile(workspaceFolders.map((f) => f.uri.fsPath));
    if (!workspaceFlavorRoot) {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folderPath), false);
      return;
    }

    // Otherwise, just use it within the current window.
    this._preferredFolderPath = folderPath;
    this._postMessage({ type: 'flavorFolderSelected', folderPath });
    await this._sendFlavorDefinition(folderPath);
  }

  private _validateLinters(linters: string[] | undefined): string[] {
    if (!linters || !Array.isArray(linters)) {
      return [];
    }

    const cleaned = linters
      .map((l) => (typeof l === 'string' ? l.trim().toUpperCase() : ''))
      .filter((l) => l.length > 0);

    const invalid = cleaned.filter((l) => !/^[A-Z0-9_]+$/.test(l));
    if (invalid.length) {
      throw new Error(`Invalid linter IDs: ${invalid.join(', ')}`);
    }

    return Array.from(new Set(cleaned));
  }

  private async _runCustomFlavorSetup(folderPath: string, linters?: string[]) {
    if (!folderPath || typeof folderPath !== 'string') {
      throw new Error('Missing folderPath');
    }

    if (!fs.existsSync(folderPath)) {
      throw new Error(`Folder does not exist: ${folderPath}`);
    }

    if (!this._ensureValidFlavorRepository(folderPath)) {
      return;
    }

    const normalizedFolder = path.resolve(folderPath);
    const safeLinters = this._validateLinters(linters);

    const baseCommand = 'npx --yes mega-linter-runner@beta --custom-flavor-setup';
    const command = safeLinters.length
      ? `${baseCommand} --custom-flavor-linters "${safeLinters.join(',')}"`
      : baseCommand;

    const terminal = vscode.window.createTerminal({
      name: 'MegaLinter Custom Flavor',
      cwd: normalizedFolder
    });
    terminal.show(true);
    terminal.sendText(command, true);

    vscode.window.showInformationMessage(`Running: ${command}`);
    this._postMessage({ type: 'info', message: `Started generator in ${normalizedFolder}` });
  }

  private async _sendFlavorDefinition(folderPath: string) {
    const resolvedPath = resolveFlavorFilePath(folderPath);
    const filePath = resolvedPath ?? path.join(folderPath, DEFAULT_FLAVOR_FILE);
    const exists = resolvedPath !== null;

    if (!exists) {
      this._postMessage({ type: 'flavorDefinition', folderPath, exists: false, filePath });
      return;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      this._postMessage({
        type: 'flavorDefinition',
        folderPath,
        exists: true,
        filePath,
        content
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._postMessage({ type: 'error', message: `Failed to read ${path.basename(filePath)}: ${msg}` });
    }
  }

  private async _openFile(filePath: string) {
    if (!filePath) {
      return;
    }
    const uri = vscode.Uri.file(filePath);
    await vscode.window.showTextDocument(uri, { preview: false });
  }

  private _ensureValidFlavorRepository(folderPath: string): boolean {
    if (!isGitRepository(folderPath)) {
      vscode.window.showWarningMessage(NOT_A_GIT_REPO_MESSAGE);
      this._postMessage({ type: 'error', message: NOT_A_GIT_REPO_MESSAGE });
      return false;
    }

    if (!isCustomFlavorRepositoryNameValid(folderPath)) {
      vscode.window.showWarningMessage(NOT_A_CUSTOM_FLAVOR_REPO_MESSAGE);
      this._postMessage({ type: 'error', message: NOT_A_CUSTOM_FLAVOR_REPO_MESSAGE });
      return false;
    }

    return true;
  }
}

function resolveFlavorFilePath(folderPath: string): string | null {
  for (const name of FLAVOR_FILE_CANDIDATES) {
    const candidate = path.join(folderPath, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function findWorkspaceRootWithFlavorFile(workspaceFolderPaths: string[]): string | null {
  for (const folderPath of workspaceFolderPaths) {
    if (resolveFlavorFilePath(folderPath)) {
      return folderPath;
    }
  }
  return null;
}

function isCustomFlavorRepositoryNameValid(folderPath: string): boolean {
  const requiredToken = 'megalinter-custom-flavor';

  const folderName = path.basename(folderPath).toLowerCase();
  if (folderName.includes(requiredToken)) {
    return true;
  }

  const originName = getGitOriginRepositoryName(folderPath);
  if (originName && originName.toLowerCase().includes(requiredToken)) {
    return true;
  }

  return false;
}
