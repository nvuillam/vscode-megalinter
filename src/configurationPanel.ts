import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { NavigationTarget } from './configTreeProvider';

export class ConfigurationPanel {
  public static currentPanel: ConfigurationPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _configPath: string;
  private _webviewReady = false;
  private _pendingNavigation: NavigationTarget | null = null;
  private _statusMessage?: vscode.Disposable;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionUri: vscode.Uri,
    configPath: string
  ): ConfigurationPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it
    if (ConfigurationPanel.currentPanel) {
      ConfigurationPanel.currentPanel._panel.reveal(column);
      ConfigurationPanel.currentPanel._configPath = configPath;
      ConfigurationPanel.currentPanel._update();
      return ConfigurationPanel.currentPanel;
    }

    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      'megalinterConfig',
      'MegaLinter Configuration',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist')
        ]
      }
    );

    ConfigurationPanel.currentPanel = new ConfigurationPanel(
      panel,
      extensionUri,
      configPath
    );

    return ConfigurationPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    configPath: string
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._configPath = configPath;

    // Set the webview's initial html content
    this._update();

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'ready':
            this._webviewReady = true;
            this._sendConfig();
            if (this._pendingNavigation) {
              this._panel.webview.postMessage({
                type: 'navigate',
                target: this._pendingNavigation
              });
              this._pendingNavigation = null;
            }
            break;
          case 'getConfig':
            this._sendConfig();
            break;
          case 'saveConfig':
            await this._saveConfig(message.config);
            break;
          case 'error':
            vscode.window.showErrorMessage(message.message);
            break;
        }
      },
      null,
      this._disposables
    );
  }

  public revealSection(target: NavigationTarget) {
    this._pendingNavigation = target;
    this._panel.reveal(undefined, true);

    if (this._webviewReady) {
      this._panel.webview.postMessage({ type: 'navigate', target });
      this._pendingNavigation = null;
    }
  }

  private _sendConfig() {
    let config: any = {};

    if (fs.existsSync(this._configPath)) {
      try {
        const content = fs.readFileSync(this._configPath, 'utf8');
        const doc = YAML.parseDocument(content);
        config = (doc.toJS() as any) || {};
      } catch (error) {
        console.error('Error reading config file:', error);
        config = {};
      }
    }

    this._panel.webview.postMessage({
      type: 'configData',
      config: config,
      configPath: this._configPath
    });
  }

  private async _saveConfig(config: any) {
    try {
      const existingText = fs.existsSync(this._configPath)
        ? fs.readFileSync(this._configPath, 'utf8')
        : '';

      const doc = existingText ? YAML.parseDocument(existingText) : new YAML.Document();

      if (!doc.contents) {
        const empty = YAML.parseDocument('{}');
        doc.contents = empty.contents;
      }

      const configKeys = new Set(Object.keys(config || {}));

      // Guard against accidental empty payloads wiping the file
      if (configKeys.size === 0) {
        return;
      }

      // Remove keys that are no longer present in the incoming config
      const existingKeys: string[] = [];
      if (doc.contents && 'items' in (doc.contents as any)) {
        const items = (doc.contents as any).items || [];
        items.forEach((item: any) => {
          if (item && item.key && typeof item.key.value === 'string') {
            existingKeys.push(item.key.value);
          }
        });
      }

      existingKeys
        .filter((key) => !configKeys.has(key))
        .forEach((key) => {
          doc.deleteIn([key]);
        });

      Object.keys(config || {}).forEach((key) => {
        doc.setIn([key], config[key]);
      });

      const yamlContent = doc.toString();

      // Ensure directory exists
      const dir = path.dirname(this._configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this._configPath, yamlContent, 'utf8');

      if (this._statusMessage) {
        this._statusMessage.dispose();
      }

      this._statusMessage = vscode.window.setStatusBarMessage(
        `MegaLinter configuration saved (${path.basename(this._configPath)})`,
        2000
      );

      this._sendConfig();
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to save configuration: ${error}`
      );
    }
  }

  public dispose() {
    ConfigurationPanel.currentPanel = undefined;

    // Clean up our resources
    this._panel.dispose();

    if (this._statusMessage) {
      this._statusMessage.dispose();
    }

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _update() {
    const webview = this._panel.webview;
    this._webviewReady = false;
    this._panel.webview.html = this._getHtmlForWebview(webview);
    this._sendConfig();
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    // Get the local path to the webview script
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js')
    );

    // Use a nonce to only allow specific scripts to be run
    const nonce = getNonce();

    // Note: 'unsafe-inline' for styles is required because we use style-loader
    // which dynamically injects styles. This is a standard pattern for React apps
    // in VS Code WebViews. The script-src uses nonce for security.
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-eval';">
  <title>MegaLinter Configuration</title>
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
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce() {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
