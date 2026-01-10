import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { resolveMegalinterPanelIcon } from './panelIcon';

type FlavorPanelInboundMessage =
  | { type: 'ready' }
  | { type: 'getFlavorContext' }
  | { type: 'pickFlavorFolder' }
  | { type: 'runCustomFlavorSetup'; folderPath: string; linters?: string[] }
  | { type: 'loadFlavorDefinition'; folderPath: string }
  | { type: 'openFile'; filePath: string };

type FlavorPanelOutboundMessage =
  | {
      type: 'flavorContext';
      workspaceFolders: Array<{ name: string; path: string }>;
    }
  | { type: 'flavorFolderSelected'; folderPath: string }
  | { type: 'flavorDefinition'; folderPath: string; exists: boolean; filePath: string; content?: string }
  | { type: 'info'; message: string }
  | { type: 'error'; message: string };

const DEFAULT_FLAVOR_YML = 'mega-linter-flavor.yml';

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
  private _webviewReady = false;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri): CustomFlavorPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (CustomFlavorPanel.currentPanel) {
      CustomFlavorPanel.currentPanel._panel.reveal(column);
      CustomFlavorPanel.currentPanel._update();
      return CustomFlavorPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'megalinterCustomFlavor',
      'MegaLinter Custom Flavor Builder',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')]
      }
    );

    const iconPath = resolveMegalinterPanelIcon(extensionUri);
    if (iconPath) {
      panel.iconPath = iconPath;
    }

    CustomFlavorPanel.currentPanel = new CustomFlavorPanel(panel, extensionUri);
    return CustomFlavorPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message: FlavorPanelInboundMessage) => {
        try {
          switch (message.type) {
            case 'ready':
              this._webviewReady = true;
              await this._sendFlavorContext();
              break;
            case 'getFlavorContext':
              await this._sendFlavorContext();
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

    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }

  private _update() {
    const webview = this._panel.webview;
    this._webviewReady = false;
    this._panel.webview.html = this._getHtmlForWebview(webview);
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js'));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-eval';">
  <title>MegaLinter Custom Flavor Builder</title>
  <style>
    body {
      padding: 0;
      margin: 0;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">window.__MEGALINTER_VIEW__ = 'flavor';</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private _postMessage(message: FlavorPanelOutboundMessage) {
    this._panel.webview.postMessage(message);
  }

  private async _sendFlavorContext() {
    const folders = vscode.workspace.workspaceFolders || [];
    this._postMessage({
      type: 'flavorContext',
      workspaceFolders: folders.map((f) => ({ name: f.name, path: f.uri.fsPath }))
    });
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

    if (!isGitRepository(folderPath)) {
      vscode.window.showWarningMessage(NOT_A_GIT_REPO_MESSAGE);
      this._postMessage({ type: 'error', message: NOT_A_GIT_REPO_MESSAGE });
      return;
    }

    if (!isCustomFlavorRepositoryNameValid(folderPath)) {
      vscode.window.showWarningMessage(NOT_A_CUSTOM_FLAVOR_REPO_MESSAGE);
      this._postMessage({ type: 'error', message: NOT_A_CUSTOM_FLAVOR_REPO_MESSAGE });
      return;
    }

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

    if (!isGitRepository(folderPath)) {
      vscode.window.showWarningMessage(NOT_A_GIT_REPO_MESSAGE);
      this._postMessage({ type: 'error', message: NOT_A_GIT_REPO_MESSAGE });
      return;
    }

    if (!isCustomFlavorRepositoryNameValid(folderPath)) {
      vscode.window.showWarningMessage(NOT_A_CUSTOM_FLAVOR_REPO_MESSAGE);
      this._postMessage({ type: 'error', message: NOT_A_CUSTOM_FLAVOR_REPO_MESSAGE });
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
    const filePath = path.join(folderPath, DEFAULT_FLAVOR_YML);
    const exists = fs.existsSync(filePath);

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
      this._postMessage({ type: 'error', message: `Failed to read ${DEFAULT_FLAVOR_YML}: ${msg}` });
    }
  }

  private async _openFile(filePath: string) {
    if (!filePath) {
      return;
    }
    const uri = vscode.Uri.file(filePath);
    await vscode.window.showTextDocument(uri, { preview: false });
  }
}

function isGitRepository(folderPath: string): boolean {
  return getGitDir(folderPath) !== null;
}

function getGitDir(folderPath: string): string | null {
  try {
    const dotGitPath = path.join(folderPath, '.git');
    if (!fs.existsSync(dotGitPath)) {
      return null;
    }

    const stat = fs.lstatSync(dotGitPath);
    if (stat.isDirectory()) {
      return dotGitPath;
    }

    if (stat.isFile()) {
      const content = fs.readFileSync(dotGitPath, 'utf8');
      const match = content.match(/^gitdir:\s*(.+)\s*$/m);
      if (!match || !match[1]) {
        return null;
      }

      const gitDirRaw = match[1].trim();
      const gitDirPath = path.isAbsolute(gitDirRaw) ? gitDirRaw : path.resolve(folderPath, gitDirRaw);
      if (!fs.existsSync(gitDirPath)) {
        return null;
      }
      const dirStat = fs.lstatSync(gitDirPath);
      return dirStat.isDirectory() ? gitDirPath : null;
    }

    return null;
  } catch {
    return null;
  }
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

function getGitOriginRepositoryName(folderPath: string): string | null {
  try {
    const gitDir = getGitDir(folderPath);
    if (!gitDir) {
      return null;
    }

    const configPath = path.join(gitDir, 'config');
    if (!fs.existsSync(configPath)) {
      return null;
    }

    const configText = fs.readFileSync(configPath, 'utf8');
    const lines = configText.split(/\r?\n/);

    let inOrigin = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const sectionMatch = trimmed.match(/^\[(.+?)\]$/);
      if (sectionMatch) {
        inOrigin = sectionMatch[1] === 'remote "origin"';
        continue;
      }

      if (!inOrigin) {
        continue;
      }

      const urlMatch = trimmed.match(/^url\s*=\s*(.+)$/);
      if (!urlMatch || !urlMatch[1]) {
        continue;
      }

      const url = urlMatch[1].trim();
      const withoutGit = url.replace(/\.git$/i, '');
      const slashParts = withoutGit.split('/');
      const lastSegment = slashParts[slashParts.length - 1] || '';
      const colonParts = lastSegment.split(':');
      const repo = colonParts[colonParts.length - 1];
      return repo || null;
    }

    return null;
  } catch {
    return null;
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
