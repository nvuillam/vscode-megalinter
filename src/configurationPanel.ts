/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import type { NavigationTarget } from './extension';
import { CustomFlavorPanel } from './customFlavorPanel';
import { resolveMegalinterPanelIcon } from './panelIcon';

type LinterDescriptorMetadata = {
  descriptorId?: string;
  name?: string;
  linterName?: string;
  url?: string;
  repo?: string;
  imageUrl?: string;
  bannerImageUrl?: string;
  text?: string;
  urls?: Array<{ label: string; href: string }>;
};

type CachedDescriptorMetadata = {
  timestamp: number;
  data: Record<string, LinterDescriptorMetadata>;
};

const DESCRIPTOR_CACHE_KEY = 'megalinter.descriptorMetadataCache.v3';
const DESCRIPTOR_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export class ConfigurationPanel {
  public static currentPanel: ConfigurationPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _state: vscode.Memento;
  private _configPath: string;
  private _webviewReady = false;
  private _pendingNavigation: NavigationTarget | null = null;
  private _statusMessage?: vscode.Disposable;
  private _disposables: vscode.Disposable[] = [];
  private _linterMetadataCache: Record<string, LinterDescriptorMetadata> | null = null;

  public static createOrShow(
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
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
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist')
        ]
      }
    );

    const iconPath = resolveMegalinterPanelIcon(extensionUri);
    if (iconPath) {
      panel.iconPath = iconPath;
    }

    ConfigurationPanel.currentPanel = new ConfigurationPanel(
      panel,
      extensionUri,
      context.globalState,
      configPath
    );

    return ConfigurationPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    state: vscode.Memento,
    configPath: string
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._state = state;
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
            await this._sendConfig();
            if (this._pendingNavigation) {
              this._panel.webview.postMessage({
                type: 'navigate',
                target: this._pendingNavigation
              });
              this._pendingNavigation = null;
            }
            break;
          case 'getConfig':
            await this._sendConfig();
            break;
          case 'saveConfig':
            await this._saveConfig(message.config);
            break;
          case 'installMegaLinter':
            await this._runCommand('npx --yes mega-linter-runner@latest --install');
            break;
          case 'upgradeMegaLinter':
            await this._runCommand('npx --yes mega-linter-runner@latest --upgrade');
            break;
          case 'openCustomFlavorBuilder':
            CustomFlavorPanel.createOrShow(this._extensionUri);
            break;
          case 'openExternal':
            if (typeof message.url === 'string' && /^https?:\/\//i.test(message.url)) {
              await vscode.env.openExternal(vscode.Uri.parse(message.url));
            } else {
              vscode.window.showErrorMessage('Invalid external URL');
            }
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

  private _ingestDescriptorContent(
    fileName: string,
    content: string,
    metadata: Record<string, LinterDescriptorMetadata>
  ) {
    try {
      const parsed = YAML.parse(content) as any;
      const descriptorId = typeof parsed?.descriptor_id === 'string' ? parsed.descriptor_id : undefined;
      const linters = Array.isArray(parsed?.linters) ? parsed.linters : [];

      linters.forEach((linter: any) => {
        const nameField = typeof linter?.name === 'string' ? linter.name : undefined;
        const linterName = typeof linter?.linter_name === 'string' ? linter.linter_name : undefined;

        const seenLinks = new Set<string>();
        const labelFromKey = (key: string): string => {
          const lower = key.toLowerCase();
          const explicit: Record<string, string> = {
            linter_rules_url: 'Rules',
            linter_rules_configuration_url: 'Rules Configuration',
            linter_rules_inline_disable_url: 'Inline disable',
            linter_rules_ignore_config_url: 'Ignoring files',
            linter_megalinter_ref_url: 'Link to MegaLinter'
          };

          if (explicit[lower]) {
            return explicit[lower];
          }

          if (lower.includes('rules_configuration')) {
            return 'Rules Configuration';
          }
          const withoutLinter = key.replace(/linter/gi, '');
          const withoutUrl = withoutLinter.replace(/url/gi, '');
          const cleaned = withoutUrl.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
          if (!cleaned) {
            return 'Link';
          }
          return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
        };

        const imagePattern = /(\.)(png|jpe?g|gif|webp|svg|ico|bmp|avif)(\?|#|$)/i;

        const addLink = (label: string, href?: string) => {
          if (!href || typeof href !== 'string' || !href.startsWith('http')) {
            return;
          }
          if (imagePattern.test(href)) {
            return;
          }
          const normalized = href.trim();
          if (!normalized || seenLinks.has(normalized)) {
            return;
          }
          seenLinks.add(normalized);
          urls.push({ label: label || normalized, href: normalized });
        };

        const urls: Array<{ label: string; href: string }> = [];

        const deriveKey = (): string | undefined => {
          if (nameField) {
            return nameField;
          }
          if (descriptorId && linterName) {
            const normalized = `${descriptorId}_${linterName}`
              .replace(/[^A-Za-z0-9_]+/g, '_')
              .replace(/_{2,}/g, '_')
              .replace(/_+$/, '')
              .toUpperCase();
            return normalized;
          }
          return undefined;
        };

        const primaryKey = deriveKey();
        if (!primaryKey) {
          return;
        }

        const meta: LinterDescriptorMetadata = {
          descriptorId,
          name: primaryKey,
          linterName,
          url: typeof linter?.linter_url === 'string' ? linter.linter_url : undefined,
          repo: typeof linter?.linter_repo === 'string' ? linter.linter_repo : undefined,
          imageUrl: typeof linter?.linter_image_url === 'string' ? linter.linter_image_url : undefined,
          bannerImageUrl:
            typeof linter?.linter_banner_image_url === 'string' ? linter.linter_banner_image_url : undefined,
          text: typeof linter?.linter_text === 'string' ? linter.linter_text : undefined
        };

        addLink('Homepage', meta.url);
        addLink('Repository', meta.repo);

        Object.entries(linter).forEach(([key, value]) => {
          if (typeof value !== 'string') {
            return;
          }
          const lowerKey = key.toLowerCase();
          if (lowerKey.includes('banner_image_url') || lowerKey.includes('image_url')) {
            return;
          }
          if (value.startsWith('http')) {
            addLink(labelFromKey(key), value);
          }
        });

        if (urls.length) {
          meta.urls = urls;
        }

        metadata[primaryKey] = meta;

        // Also index by descriptor-linter combination when a name field was present, to cover both forms
        if (nameField && descriptorId && linterName) {
          const aliasKey = `${descriptorId}_${linterName}`
            .replace(/[^A-Za-z0-9_]+/g, '_')
            .replace(/_{2,}/g, '_')
            .replace(/_+$/, '')
            .toUpperCase();
          metadata[aliasKey] = meta;
        }
      });
    } catch (err) {
      console.warn(`Failed to parse descriptor metadata from ${fileName}`, err);
    }
  }

  private _loadLocalDescriptorMetadata(
    metadata: Record<string, LinterDescriptorMetadata>
  ): boolean {
    const descriptorDir = path.join(this._extensionUri.fsPath, 'src', 'descriptors');

    if (!fs.existsSync(descriptorDir)) {
      return false;
    }

    const descriptorFiles = fs
      .readdirSync(descriptorDir)
      .filter((file) => file.toLowerCase().endsWith('.megalinter-descriptor.yml'));

    descriptorFiles.forEach((file) => {
      const fullPath = path.join(descriptorDir, file);
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        this._ingestDescriptorContent(file, content, metadata);
      } catch (err) {
        console.warn(`Failed to read descriptor metadata from ${file}`, err);
      }
    });

    return descriptorFiles.length > 0;
  }

  private async _loadRemoteDescriptorMetadata(
    metadata: Record<string, LinterDescriptorMetadata>
  ): Promise<boolean> {
    const apiUrl = 'https://api.github.com/repos/oxsecurity/megalinter/contents/megalinter/descriptors';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(apiUrl, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'vscode-megalinter-extension'
        },
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const files = (await response.json()) as Array<{ name: string; download_url?: string; type?: string }>;
      const descriptorFiles = files.filter(
        (item) => item.type === 'file' && item.name.toLowerCase().endsWith('.megalinter-descriptor.yml')
      );

      for (const file of descriptorFiles) {
        if (!file.download_url) {
          continue;
        }
        try {
          const fileController = new AbortController();
          const fileTimeout = setTimeout(() => fileController.abort(), 8000);
          const descriptorResponse = await fetch(file.download_url, { signal: fileController.signal });
          clearTimeout(fileTimeout);

          if (!descriptorResponse.ok) {
            continue;
          }

          const content = await descriptorResponse.text();
          this._ingestDescriptorContent(file.name, content, metadata);
        } catch (fileErr) {
          console.warn(`Failed to download descriptor ${file.name}`, fileErr);
        }
      }

      return descriptorFiles.length > 0 && Object.keys(metadata).length > 0;
    } catch (err) {
      console.warn('Remote descriptor metadata fetch failed', err);
      return false;
    }
  }

  private async _loadDescriptorMetadata(): Promise<Record<string, LinterDescriptorMetadata>> {
    if (this._linterMetadataCache) {
      return this._linterMetadataCache;
    }

    const cached = this._state.get<CachedDescriptorMetadata>(DESCRIPTOR_CACHE_KEY);
    const now = Date.now();
    const cacheIsFresh =
      cached && typeof cached.timestamp === 'number' && now - cached.timestamp < DESCRIPTOR_CACHE_TTL_MS;
    const cacheHasLinks = cached?.data
      ? Object.values(cached.data).some((meta) => Array.isArray(meta?.urls) && meta.urls.length > 0)
      : false;

    if (cacheIsFresh && cacheHasLinks && cached?.data && Object.keys(cached.data).length > 0) {
      this._linterMetadataCache = cached.data;
      return cached.data;
    }

    const metadata: Record<string, LinterDescriptorMetadata> = {};

    const loadedRemotely = await this._loadRemoteDescriptorMetadata(metadata);
    if (!loadedRemotely) {
      this._loadLocalDescriptorMetadata(metadata);
    }

    if (loadedRemotely && Object.keys(metadata).length > 0) {
      await this._state.update(DESCRIPTOR_CACHE_KEY, {
        data: metadata,
        timestamp: Date.now()
      } satisfies CachedDescriptorMetadata);
    }

    this._linterMetadataCache = metadata;
    return metadata;
  }

  private async _sendConfig() {
    let config: any = {};
    const configExists = fs.existsSync(this._configPath);

    if (configExists) {
      try {
        const content = fs.readFileSync(this._configPath, 'utf8');
        const doc = YAML.parseDocument(content);
        config = (doc.toJS() as any) || {};
      } catch (error) {
        console.error('Error reading config file:', error);
        config = {};
      }
    }

    let linterMetadata: Record<string, LinterDescriptorMetadata> = {};

    try {
      linterMetadata = await this._loadDescriptorMetadata();
    } catch (err) {
      console.warn('Unable to load linter metadata', err);
    }

    this._panel.webview.postMessage({
      type: 'configData',
      config: config,
      configPath: this._configPath,
      configExists,
      linterMetadata
    });
  }

  private async _saveConfig(config: any) {
    try {
      const sanitize = (value: any): any => {
        if (value === null || value === undefined) {
          return value;
        }

        if (Array.isArray(value)) {
          return value
            .map((item) => sanitize(item))
            .filter((item) => item !== null && item !== undefined);
        }

        if (typeof value === 'object') {
          const result: Record<string, any> = {};
          Object.keys(value).forEach((key) => {
            result[key] = sanitize(value[key]);
          });
          return result;
        }

        return value;
      };

      const sanitizedConfig = sanitize(config || {});
      const existingText = fs.existsSync(this._configPath)
        ? fs.readFileSync(this._configPath, 'utf8')
        : '';

      const doc = existingText ? YAML.parseDocument(existingText) : new YAML.Document();

      if (!doc.contents) {
        const empty = YAML.parseDocument('{}');
        doc.contents = empty.contents;
      }

      const configKeys = new Set(Object.keys(sanitizedConfig || {}));

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

      Object.keys(sanitizedConfig || {}).forEach((key) => {
        doc.setIn([key], sanitizedConfig[key]);
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

      await this._sendConfig();
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
    void this._sendConfig();
  }

  private async _runCommand(command: string) {
    const cwd = this._configPath ? path.dirname(this._configPath) : undefined;
    const terminal = vscode.window.createTerminal({ name: 'MegaLinter Setup', cwd });
    terminal.show(true);
    terminal.sendText(command, true);
    vscode.window.showInformationMessage(`Running: ${command}`);
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-eval';">
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
  <script nonce="${nonce}">window.__MEGALINTER_VIEW__ = 'config';</script>
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
