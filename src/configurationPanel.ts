/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as https from "https";
import * as YAML from "yaml";
import type { NavigationTarget } from "./extension";
import { CustomFlavorPanel } from "./customFlavorPanel";
import type { LinterDescriptorMetadata } from "./shared/linterMetadata";
import { sanitizeConfigForSave } from "./shared/sanitizeConfigForSave";
import {
  buildWebviewHtml,
  createMegalinterWebviewPanel,
  disposeAll,
  openExternalHttpUrl,
} from "./panelUtils";

type ResolveLinterConfigRequest = {
  type: "resolveLinterConfigFile";
  linterKey: string;
  overrides?: {
    linterRulesPath?: string;
    configFile?: string;
  };
};

type CreateLinterConfigRequest = {
  type: "createLinterConfigFileFromDefault";
  linterKey: string;
  mode?: "default" | "blank";
  destination?: {
    linterRulesPath?: string;
    configFile?: string;
  };
};

type ConfigurationPanelInboundMessage =
  | { type: "ready" }
  | { type: "getConfig" }
  | { type: "saveConfig"; config: any }
  | { type: "installMegaLinter" }
  | { type: "upgradeMegaLinter" }
  | { type: "openCustomFlavorBuilder" }
  | { type: "openExternal"; url: string }
  | { type: "openFile"; filePath: string }
  | ResolveLinterConfigRequest
  | CreateLinterConfigRequest
  | { type: "error"; message: string };

type LinterConfigFileInfoMessage = {
  type: "linterConfigFileInfo";
  linterKey: string;
  resolved: boolean;
  configFileName?: string;
  rulesPath?: string;
  local?: {
    exists: boolean;
    filePath?: string;
    content?: string;
    truncated?: boolean;
  };
  defaultTemplate?: {
    exists: boolean;
    source?: "remote" | "local";
    content?: string;
    truncated?: boolean;
  };
};

type CachedDescriptorMetadata = {
  timestamp: number;
  data: Record<string, LinterDescriptorMetadata>;
};

type ExtendsResolution = {
  localConfig: any;
  effectiveConfig: any;
  inheritedConfig: any;
  inheritedKeySources: Record<string, string>;
  extendsItems: string[];
  extendsErrors: string[];
};

const DESCRIPTOR_CACHE_KEY = "megalinter.descriptorMetadataCache.v5";
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
  private _linterMetadataCache: Record<
    string,
    LinterDescriptorMetadata
  > | null = null;

  private _extendsYamlCache = new Map<
    string,
    { timestamp: number; parsed: any }
  >();

  public static createOrShow(
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
    configPath: string,
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
    const panel = createMegalinterWebviewPanel({
      viewType: "megalinterConfig",
      title: "MegaLinter Configuration",
      extensionUri,
      column,
    });

    ConfigurationPanel.currentPanel = new ConfigurationPanel(
      panel,
      extensionUri,
      context.globalState,
      configPath,
    );

    return ConfigurationPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    state: vscode.Memento,
    configPath: string,
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
      async (message: ConfigurationPanelInboundMessage) => {
        switch (message.type) {
          case "ready":
            this._webviewReady = true;
            await this._sendConfig();
            if (this._pendingNavigation) {
              this._panel.webview.postMessage({
                type: "navigate",
                target: this._pendingNavigation,
              });
              this._pendingNavigation = null;
            }
            break;
          case "getConfig":
            await this._sendConfig();
            break;
          case "saveConfig":
            await this._saveConfig(message.config);
            break;
          case "installMegaLinter":
            await this._runCommand(
              "npx --yes mega-linter-runner@latest --install",
            );
            break;
          case "upgradeMegaLinter":
            await this._runCommand(
              "npx --yes mega-linter-runner@latest --upgrade",
            );
            break;
          case "openCustomFlavorBuilder":
            CustomFlavorPanel.createOrShow(this._extensionUri);
            break;
          case "openFile":
            await this._openFile(message.filePath);
            break;
          case "resolveLinterConfigFile":
            await this._resolveAndSendLinterConfigFile(
              message.linterKey,
              message.overrides,
            );
            break;
          case "createLinterConfigFileFromDefault":
            await this._createLinterConfigFileFromDefault(
              message.linterKey,
              message.destination,
              message.mode,
            );
            break;
          case "openExternal":
            await openExternalHttpUrl(message.url);
            break;
          case "error":
            vscode.window.showErrorMessage(message.message);
            break;
        }
      },
      null,
      this._disposables,
    );
  }

  public revealSection(target: NavigationTarget) {
    this._pendingNavigation = target;
    this._panel.reveal(undefined, true);

    if (this._webviewReady) {
      this._panel.webview.postMessage({ type: "navigate", target });
      this._pendingNavigation = null;
    }
  }

  private _ingestDescriptorContent(
    fileName: string,
    content: string,
    metadata: Record<string, LinterDescriptorMetadata>,
  ) {
    try {
      const parsed = YAML.parse(content) as any;
      const descriptorId =
        typeof parsed?.descriptor_id === "string"
          ? parsed.descriptor_id
          : undefined;
      const linters = Array.isArray(parsed?.linters) ? parsed.linters : [];

      linters.forEach((linter: any) => {
        const nameField =
          typeof linter?.name === "string" ? linter.name : undefined;
        const linterName =
          typeof linter?.linter_name === "string"
            ? linter.linter_name
            : undefined;

        const seenLinks = new Set<string>();
        const labelFromKey = (key: string): string => {
          const lower = key.toLowerCase();
          const explicit: Record<string, string> = {
            linter_rules_url: "Rules",
            linter_rules_configuration_url: "Rules Configuration",
            linter_rules_inline_disable_url: "Inline disable",
            linter_rules_ignore_config_url: "Ignoring files",
            linter_megalinter_ref_url: "Link to MegaLinter",
          };

          if (explicit[lower]) {
            return explicit[lower];
          }

          if (lower.includes("rules_configuration")) {
            return "Rules Configuration";
          }
          const withoutLinter = key.replace(/linter/gi, "");
          const withoutUrl = withoutLinter.replace(/url/gi, "");
          const cleaned = withoutUrl
            .replace(/_/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          if (!cleaned) {
            return "Link";
          }
          return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
        };

        const imagePattern =
          /(\.)(png|jpe?g|gif|webp|svg|ico|bmp|avif)(\?|#|$)/i;

        const addLink = (label: string, href?: string) => {
          if (!href || typeof href !== "string" || !href.startsWith("http")) {
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
              .replace(/[^A-Za-z0-9_]+/g, "_")
              .replace(/_{2,}/g, "_")
              .replace(/_+$/, "")
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
          configFileName:
            typeof linter?.config_file_name === "string"
              ? linter.config_file_name
              : undefined,
          url:
            typeof linter?.linter_url === "string"
              ? linter.linter_url
              : undefined,
          repo:
            typeof linter?.linter_repo === "string"
              ? linter.linter_repo
              : undefined,
          rulesConfigurationUrl:
            typeof linter?.linter_rules_configuration_url === "string"
              ? linter.linter_rules_configuration_url
              : undefined,
          imageUrl:
            typeof linter?.linter_image_url === "string"
              ? linter.linter_image_url
              : undefined,
          bannerImageUrl:
            typeof linter?.linter_banner_image_url === "string"
              ? linter.linter_banner_image_url
              : undefined,
          text:
            typeof linter?.linter_text === "string"
              ? linter.linter_text
              : undefined,
        };

        if (typeof meta.configFileName === "string") {
          const trimmed = meta.configFileName.trim();
          if (!trimmed || trimmed.startsWith("-")) {
            meta.configFileName = undefined;
          } else {
            meta.configFileName = trimmed;
          }
        }

        addLink("Homepage", meta.url);
        addLink("Repository", meta.repo);

        Object.entries(linter).forEach(([key, value]) => {
          if (typeof value !== "string") {
            return;
          }
          const lowerKey = key.toLowerCase();
          if (
            lowerKey.includes("banner_image_url") ||
            lowerKey.includes("image_url")
          ) {
            return;
          }
          if (value.startsWith("http")) {
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
            .replace(/[^A-Za-z0-9_]+/g, "_")
            .replace(/_{2,}/g, "_")
            .replace(/_+$/, "")
            .toUpperCase();
          metadata[aliasKey] = meta;
        }
      });
    } catch (err) {
      console.warn(`Failed to parse descriptor metadata from ${fileName}`, err);
    }
  }

  private _loadLocalDescriptorMetadata(
    metadata: Record<string, LinterDescriptorMetadata>,
  ): boolean {
    const descriptorDir = path.join(
      this._extensionUri.fsPath,
      "src",
      "descriptors",
    );

    if (!fs.existsSync(descriptorDir)) {
      return false;
    }

    const descriptorFiles = fs
      .readdirSync(descriptorDir)
      .filter((file) =>
        file.toLowerCase().endsWith(".megalinter-descriptor.yml"),
      );

    descriptorFiles.forEach((file) => {
      const fullPath = path.join(descriptorDir, file);
      try {
        const content = fs.readFileSync(fullPath, "utf8");
        this._ingestDescriptorContent(file, content, metadata);
      } catch (err) {
        console.warn(`Failed to read descriptor metadata from ${file}`, err);
      }
    });

    return descriptorFiles.length > 0;
  }

  private async _loadRemoteDescriptorMetadata(
    metadata: Record<string, LinterDescriptorMetadata>,
  ): Promise<boolean> {
    const apiUrl =
      "https://api.github.com/repos/oxsecurity/megalinter/contents/megalinter/descriptors";
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(apiUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "vscode-megalinter-extension",
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const files = (await response.json()) as Array<{
        name: string;
        download_url?: string;
        type?: string;
      }>;
      const descriptorFiles = files.filter(
        (item) =>
          item.type === "file" &&
          item.name.toLowerCase().endsWith(".megalinter-descriptor.yml"),
      );

      for (const file of descriptorFiles) {
        if (!file.download_url) {
          continue;
        }
        try {
          const fileController = new AbortController();
          const fileTimeout = setTimeout(() => fileController.abort(), 8000);
          const descriptorResponse = await fetch(file.download_url, {
            signal: fileController.signal,
          });
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
      console.warn("Remote descriptor metadata fetch failed", err);
      return false;
    }
  }

  private async _loadDescriptorMetadata(): Promise<
    Record<string, LinterDescriptorMetadata>
  > {
    if (this._linterMetadataCache) {
      return this._linterMetadataCache;
    }

    const cached =
      this._state.get<CachedDescriptorMetadata>(DESCRIPTOR_CACHE_KEY);
    const now = Date.now();
    const cacheIsFresh =
      cached &&
      typeof cached.timestamp === "number" &&
      now - cached.timestamp < DESCRIPTOR_CACHE_TTL_MS;
    const cacheHasLinks = cached?.data
      ? Object.values(cached.data).some(
          (meta) => Array.isArray(meta?.urls) && meta.urls.length > 0,
        )
      : false;
    const cacheHasConfigFileNames = cached?.data
      ? Object.values(cached.data).some(
          (meta) =>
            typeof meta?.configFileName === "string" &&
            meta.configFileName.trim(),
        )
      : false;
    const cacheHasText = cached?.data
      ? Object.values(cached.data).some(
          (meta) => typeof meta?.text === "string" && meta.text.trim(),
        )
      : false;

    if (
      cacheIsFresh &&
      cacheHasLinks &&
      cacheHasConfigFileNames &&
      cacheHasText &&
      cached?.data &&
      Object.keys(cached.data).length > 0
    ) {
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
        timestamp: Date.now(),
      } satisfies CachedDescriptorMetadata);
    }

    this._linterMetadataCache = metadata;
    return metadata;
  }

  private async _sendConfig() {
    let config: any = {};
    let localConfig: any = {};
    let inheritedConfig: any = {};
    let inheritedKeySources: Record<string, string> = {};
    let extendsItems: string[] = [];
    let extendsErrors: string[] = [];
    const configExists = fs.existsSync(this._configPath);

    if (configExists) {
      try {
        const content = fs.readFileSync(this._configPath, "utf8");
        const doc = YAML.parseDocument(content);
        localConfig = (doc.toJS() as any) || {};

        const resolved = await this._resolveExtends(localConfig);
        config = resolved.effectiveConfig;
        inheritedConfig = resolved.inheritedConfig;
        inheritedKeySources = resolved.inheritedKeySources;
        extendsItems = resolved.extendsItems;
        extendsErrors = resolved.extendsErrors;
      } catch (error) {
        console.error("Error reading config file:", error);
        config = {};
        localConfig = {};
      }
    }

    let linterMetadata: Record<string, LinterDescriptorMetadata> = {};

    try {
      linterMetadata = await this._loadDescriptorMetadata();
    } catch (err) {
      console.warn("Unable to load linter metadata", err);
    }

    this._panel.webview.postMessage({
      type: "configData",
      config: config,
      localConfig,
      inheritedConfig,
      inheritedKeySources,
      extendsItems,
      extendsErrors,
      configPath: this._configPath,
      configExists,
      linterMetadata,
    });
  }

  private _normalizeExtendsValue(value: unknown): string[] {
    if (typeof value === "string" && value.trim()) {
      return [value.trim()];
    }
    if (Array.isArray(value)) {
      return value
        .filter((v) => typeof v === "string")
        .map((v) => String(v).trim())
        .filter(Boolean);
    }
    return [];
  }

  private _normalizeConfigPropertiesToAppend(value: unknown): Set<string> {
    if (!Array.isArray(value)) {
      return new Set<string>();
    }
    const entries = value
      .filter((v) => typeof v === "string")
      .map((v) => String(v).trim())
      .filter(Boolean);
    return new Set(entries);
  }

  private _mergeDicts(
    target: Record<string, any>,
    source: Record<string, any> | undefined,
    appendKeys: Set<string>,
    sourceId: string | undefined,
    keySources: Record<string, string>,
    options?: { skipKeys?: Set<string> },
  ) {
    if (!source) {
      return;
    }

    const skipKeys = options?.skipKeys;
    Object.entries(source).forEach(([key, value]) => {
      if (skipKeys?.has(key)) {
        return;
      }

      if (!Object.prototype.hasOwnProperty.call(target, key)) {
        target[key] = value;
        if (sourceId) {
          keySources[key] = sourceId;
        }
        return;
      }

      const current = target[key];
      if (
        Array.isArray(current) &&
        Array.isArray(value) &&
        appendKeys.has(key)
      ) {
        target[key] = [...current, ...value];
        if (sourceId) {
          keySources[key] = sourceId;
        }
        return;
      }

      target[key] = value;
      if (sourceId) {
        keySources[key] = sourceId;
      }
    });
  }

  private async _fetchRemoteYaml(url: string): Promise<any> {
    const cached = this._extendsYamlCache.get(url);
    if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) {
      return cached.parsed;
    }

    const text = await this._fetchText(url, 10_000, 1024 * 1024);
    const parsed = (YAML.parse(text) as any) || {};
    this._extendsYamlCache.set(url, { timestamp: Date.now(), parsed });
    return parsed;
  }

  private _fetchText(
    url: string,
    timeoutMs: number,
    maxBytes: number,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const doRequest = (currentUrl: string, redirectsLeft: number) => {
        const isHttps = currentUrl.startsWith("https://");
        const transport = isHttps ? https : http;

        const req = transport.get(
          currentUrl,
          {
            headers: {
              "User-Agent": "vscode-megalinter",
              Accept: "text/yaml, text/plain, */*",
            },
          },
          (res) => {
            const status = res.statusCode || 0;
            const location =
              typeof res.headers.location === "string"
                ? res.headers.location
                : undefined;

            if (
              status >= 300 &&
              status < 400 &&
              location &&
              redirectsLeft > 0
            ) {
              res.resume();
              const nextUrl = location.startsWith("http")
                ? location
                : new URL(location, currentUrl).toString();
              doRequest(nextUrl, redirectsLeft - 1);
              return;
            }

            if (status !== 200) {
              res.resume();
              reject(
                new Error(`Failed to fetch ${currentUrl} (HTTP ${status})`),
              );
              return;
            }

            const chunks: Buffer[] = [];
            let total = 0;
            res.on("data", (chunk: Buffer) => {
              total += chunk.length;
              if (total > maxBytes) {
                req.destroy(
                  new Error(`Remote config too large (> ${maxBytes} bytes)`),
                );
                return;
              }
              chunks.push(chunk);
            });
            res.on("end", () => {
              resolve(Buffer.concat(chunks).toString("utf8"));
            });
          },
        );

        req.on("error", reject);
        req.setTimeout(timeoutMs, () => {
          req.destroy(new Error(`Timeout fetching ${currentUrl}`));
        });
      };

      doRequest(url, 5);
    });
  }

  private async _loadExtendsItem(
    extendsItem: string,
  ): Promise<{ sourceId: string; data: any }> {
    const trimmed = extendsItem.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      const data = await this._fetchRemoteYaml(trimmed);
      return { sourceId: trimmed, data };
    }

    const workspaceRoot = this._resolveWorkspaceRoot();
    const candidate = path.isAbsolute(trimmed)
      ? trimmed
      : path.join(workspaceRoot, trimmed);
    if (!fs.existsSync(candidate)) {
      throw new Error(`EXTENDS file not found: ${trimmed}`);
    }
    const content = fs.readFileSync(candidate, "utf8");
    const data = (YAML.parse(content) as any) || {};
    return { sourceId: trimmed, data };
  }

  private async _resolveExtends(
    localConfigInput: any,
  ): Promise<ExtendsResolution> {
    const localConfig =
      localConfigInput && typeof localConfigInput === "object"
        ? localConfigInput
        : {};

    const extendsItems = this._normalizeExtendsValue(localConfig?.EXTENDS);
    const extendsErrors: string[] = [];
    const inheritedKeySources: Record<string, string> = {};
    const inheritedConfig: Record<string, any> = {};

    if (!extendsItems.length) {
      return {
        localConfig,
        effectiveConfig: localConfig,
        inheritedConfig: {},
        inheritedKeySources: {},
        extendsItems: [],
        extendsErrors: [],
      };
    }

    const appendKeys = this._normalizeConfigPropertiesToAppend(
      localConfig?.CONFIG_PROPERTIES_TO_APPEND,
    );

    const visited = new Set<string>();
    const skipExtendsKey = new Set<string>(["EXTENDS"]);

    const combineConfig = async (configToProcess: any, depth: number) => {
      if (depth > 10) {
        extendsErrors.push("EXTENDS nesting too deep (max 10)");
        return;
      }

      const items = this._normalizeExtendsValue(configToProcess?.EXTENDS);
      for (const item of items) {
        if (!item) {
          continue;
        }
        if (visited.has(item)) {
          extendsErrors.push(`EXTENDS cycle detected: ${item}`);
          continue;
        }
        visited.add(item);

        try {
          const loaded = await this._loadExtendsItem(item);
          const extendsData =
            loaded.data && typeof loaded.data === "object" ? loaded.data : {};

          this._mergeDicts(
            inheritedConfig,
            extendsData,
            appendKeys,
            loaded.sourceId,
            inheritedKeySources,
            { skipKeys: skipExtendsKey },
          );

          if (
            extendsData &&
            typeof extendsData === "object" &&
            extendsData.EXTENDS
          ) {
            await combineConfig(extendsData, depth + 1);
          }

          // Ensure nested EXTENDS configs can override what they extend.
          this._mergeDicts(
            inheritedConfig,
            extendsData,
            appendKeys,
            loaded.sourceId,
            inheritedKeySources,
            { skipKeys: skipExtendsKey },
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          extendsErrors.push(msg);
        }
      }
    };

    await combineConfig(localConfig, 0);

    // Compute the effective config shown in the UI: inherited + local overrides.
    const effectiveConfig: Record<string, any> = { ...inheritedConfig };
    const localWithoutExtends: Record<string, any> = { ...localConfig };
    delete localWithoutExtends.EXTENDS;

    this._mergeDicts(
      effectiveConfig,
      localWithoutExtends,
      appendKeys,
      undefined,
      inheritedKeySources,
    );

    // Keep local EXTENDS visible/editable.
    effectiveConfig.EXTENDS = localConfig.EXTENDS;

    return {
      localConfig,
      effectiveConfig,
      inheritedConfig,
      inheritedKeySources,
      extendsItems,
      extendsErrors,
    };
  }

  private async _openFile(filePath: string) {
    if (!filePath) {
      return;
    }
    const uri = vscode.Uri.file(filePath);
    await vscode.window.showTextDocument(uri, { preview: false });
  }

  private _resolveWorkspaceRoot(): string {
    const configUri = vscode.Uri.file(this._configPath);
    const containing = vscode.workspace.getWorkspaceFolder(configUri);
    if (containing?.uri?.fsPath) {
      return containing.uri.fsPath;
    }
    return path.dirname(this._configPath);
  }

  private _normalizeRelativePath(value: string): string {
    const trimmed = value.trim();
    const noLeading = trimmed.replace(/^\.\//, "");
    return noLeading.replace(/\\/g, "/");
  }

  private _readTextFileSafe(
    filePath: string,
    maxBytes = 512 * 1024,
  ): { content: string; truncated: boolean } {
    const stat = fs.statSync(filePath);
    const truncated = stat.size > maxBytes;
    const content = truncated
      ? fs.readFileSync(filePath, { encoding: "utf8" }).slice(0, maxBytes)
      : fs.readFileSync(filePath, { encoding: "utf8" });
    return { content, truncated };
  }

  private _dedupePaths(paths: string[]): string[] {
    const seen = new Set<string>();
    const results: string[] = [];
    for (const p of paths) {
      const normalized = path.resolve(p);
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      results.push(p);
    }
    return results;
  }

  private async _resolveAndSendLinterConfigFile(
    linterKey: string,
    overrides?: { linterRulesPath?: string; configFile?: string },
  ) {
    const safeKey =
      typeof linterKey === "string" ? linterKey.trim().toUpperCase() : "";
    if (!safeKey) {
      return;
    }

    const configUri = vscode.Uri.file(this._configPath);
    const configRoot = this._resolveWorkspaceRoot();

    let configFromDisk: any = {};
    try {
      if (fs.existsSync(this._configPath)) {
        const content = fs.readFileSync(this._configPath, "utf8");
        const doc = YAML.parseDocument(content);
        configFromDisk = (doc.toJS() as any) || {};
      }
    } catch {
      configFromDisk = {};
    }

    const metadata = await this._loadDescriptorMetadata();
    const metaConfigName = metadata[safeKey]?.configFileName;

    const overrideKey = `${safeKey}_CONFIG_FILE`;
    const overrideValue =
      overrides?.configFile ?? (configFromDisk?.[overrideKey] as unknown);
    const configFileNameRaw =
      typeof overrideValue === "string" && overrideValue.trim()
        ? overrideValue.trim()
        : metaConfigName;

    const rulesPathRaw =
      overrides?.linterRulesPath ??
      (configFromDisk?.LINTER_RULES_PATH as unknown);
    const rulesPath =
      typeof rulesPathRaw === "string" && rulesPathRaw.trim()
        ? rulesPathRaw.trim()
        : ".github/linters";

    if (!configFileNameRaw || typeof configFileNameRaw !== "string") {
      const payload: LinterConfigFileInfoMessage = {
        type: "linterConfigFileInfo",
        linterKey: safeKey,
        resolved: true,
        configFileName: undefined,
        rulesPath,
      };
      this._panel.webview.postMessage(payload);
      return;
    }

    const configFileRelPosix = this._normalizeRelativePath(configFileNameRaw);
    const configFileRelFs = path.normalize(configFileRelPosix);

    const candidates = this._dedupePaths([
      path.join(configRoot, configFileRelFs),
      path.join(configRoot, ".github", "linters", configFileRelFs),
      path.join(
        configRoot,
        path.normalize(rulesPath.replace(/\\/g, path.sep)),
        configFileRelFs,
      ),
    ]);

    let localFilePath: string | undefined;
    for (const candidate of candidates) {
      try {
        const resolvedCandidate = path.resolve(candidate);
        const resolvedRoot = path.resolve(configRoot);
        if (
          !resolvedCandidate.startsWith(resolvedRoot + path.sep) &&
          resolvedCandidate !== resolvedRoot
        ) {
          continue;
        }
        if (
          fs.existsSync(resolvedCandidate) &&
          fs.lstatSync(resolvedCandidate).isFile()
        ) {
          localFilePath = resolvedCandidate;
          break;
        }
      } catch {
        // ignore
      }
    }

    let localInfo: LinterConfigFileInfoMessage["local"] | undefined;
    if (localFilePath) {
      try {
        const { content, truncated } = this._readTextFileSafe(localFilePath);
        localInfo = {
          exists: true,
          filePath: localFilePath,
          content,
          truncated,
        };
      } catch {
        localInfo = { exists: true, filePath: localFilePath };
      }
    } else {
      localInfo = { exists: false };
    }

    const defaultTemplate = await this._loadDefaultTemplate(configFileRelPosix);

    const payload: LinterConfigFileInfoMessage = {
      type: "linterConfigFileInfo",
      linterKey: safeKey,
      resolved: true,
      configFileName: configFileRelPosix,
      rulesPath,
      local: localInfo,
      defaultTemplate,
    };
    this._panel.webview.postMessage(payload);
  }

  private async _loadDefaultTemplate(
    configFileRelPosix: string,
  ): Promise<LinterConfigFileInfoMessage["defaultTemplate"]> {
    const normalized = configFileRelPosix.replace(/^\/+/, "");
    const maxBytes = 512 * 1024;

    // Try remote first
    try {
      const url = `https://raw.githubusercontent.com/oxsecurity/megalinter/main/TEMPLATES/${normalized}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok) {
        const text = await response.text();
        const truncated = Buffer.byteLength(text, "utf8") > maxBytes;
        return {
          exists: true,
          source: "remote",
          content: truncated ? text.slice(0, maxBytes) : text,
          truncated,
        };
      }
    } catch {
      // ignore
    }

    // Fallback to local templates folder
    try {
      const templatesRoot = path.join(
        this._extensionUri.fsPath,
        "src",
        "descriptors",
        "TEMPLATES",
      );
      const localPath = path.join(templatesRoot, path.normalize(normalized));
      if (fs.existsSync(localPath) && fs.lstatSync(localPath).isFile()) {
        const { content, truncated } = this._readTextFileSafe(
          localPath,
          maxBytes,
        );
        return { exists: true, source: "local", content, truncated };
      }
    } catch {
      // ignore
    }

    return { exists: false };
  }

  private _getBlankConfigContent(configFileRelPosix: string): string {
    const lower = configFileRelPosix.toLowerCase();
    if (lower.endsWith(".json")) {
      return "{\n}\n";
    }
    if (lower.endsWith(".yml") || lower.endsWith(".yaml")) {
      return "{}\n";
    }
    return "";
  }

  private async _createLinterConfigFileFromDefault(
    linterKey: string,
    destination?: { linterRulesPath?: string; configFile?: string },
    mode: "default" | "blank" = "default",
  ) {
    const safeKey =
      typeof linterKey === "string" ? linterKey.trim().toUpperCase() : "";
    if (!safeKey) {
      return;
    }

    const configRoot = this._resolveWorkspaceRoot();

    let rulesPathIsExplicitlySet = false;
    try {
      if (fs.existsSync(this._configPath)) {
        const content = fs.readFileSync(this._configPath, "utf8");
        const doc = YAML.parseDocument(content);
        rulesPathIsExplicitlySet = !!(
          doc &&
          typeof (doc as any).hasIn === "function" &&
          (doc as any).hasIn(["LINTER_RULES_PATH"])
        );
      }
    } catch {
      rulesPathIsExplicitlySet = false;
    }

    const metadata = await this._loadDescriptorMetadata();
    const metaConfigName = metadata[safeKey]?.configFileName;
    const configFileNameRaw =
      typeof destination?.configFile === "string" &&
      destination.configFile.trim()
        ? destination.configFile.trim()
        : metaConfigName;
    if (!configFileNameRaw) {
      vscode.window.showErrorMessage(
        "No config file name available for this linter",
      );
      return;
    }

    // Default creation location: repo root.
    // Only create under LINTER_RULES_PATH when it's explicitly set in the local .mega-linter.yml.
    const rulesPath =
      rulesPathIsExplicitlySet &&
      typeof destination?.linterRulesPath === "string" &&
      destination.linterRulesPath.trim()
        ? destination.linterRulesPath.trim()
        : "";

    const configFileRelPosix = this._normalizeRelativePath(configFileNameRaw);
    const configFileRelFs = path.normalize(configFileRelPosix);

    const targetPath = path.resolve(
      path.join(
        configRoot,
        rulesPath ? path.normalize(rulesPath.replace(/\\/g, path.sep)) : "",
        configFileRelFs,
      ),
    );
    const resolvedRoot = path.resolve(configRoot);
    if (
      !targetPath.startsWith(resolvedRoot + path.sep) &&
      targetPath !== resolvedRoot
    ) {
      vscode.window.showErrorMessage(
        "Refusing to create config file outside workspace",
      );
      return;
    }

    const title =
      mode === "blank"
        ? `Creating ${configFileRelPosix}…`
        : `Creating ${configFileRelPosix} from default…`;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: false,
      },
      async (progress) => {
        if (fs.existsSync(targetPath)) {
          progress.report({ message: "Opening existing file…" });
          await this._openFile(targetPath);
          await this._resolveAndSendLinterConfigFile(safeKey, {
            linterRulesPath: rulesPath,
            configFile: configFileRelPosix,
          });
          return;
        }

        let contentToWrite = "";
        if (mode === "blank") {
          contentToWrite = this._getBlankConfigContent(configFileRelPosix);
        } else {
          progress.report({ message: "Loading default template…" });
          const defaultTemplate =
            await this._loadDefaultTemplate(configFileRelPosix);
          if (!defaultTemplate?.exists || !defaultTemplate.content) {
            vscode.window.showErrorMessage(
              "No default template available for this config file",
            );
            return;
          }
          contentToWrite = defaultTemplate.content;
        }

        progress.report({ message: "Writing file…" });
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, contentToWrite, "utf8");

        vscode.window.showInformationMessage(
          `Created config file: ${targetPath}`,
        );
        await this._openFile(targetPath);
        await this._resolveAndSendLinterConfigFile(safeKey, {
          linterRulesPath: rulesPath,
          configFile: configFileRelPosix,
        });
      },
    );
  }

  private async _saveConfig(config: any) {
    try {
      const sanitizedConfig = sanitizeConfigForSave(config || {});
      const existingText = fs.existsSync(this._configPath)
        ? fs.readFileSync(this._configPath, "utf8")
        : "";

      const doc = existingText
        ? YAML.parseDocument(existingText)
        : new YAML.Document();

      if (!doc.contents) {
        const empty = YAML.parseDocument("{}");
        doc.contents = empty.contents;
      }

      const configKeys = new Set(Object.keys(sanitizedConfig || {}));

      // Remove keys that are no longer present in the incoming config
      const existingKeys: string[] = [];
      if (doc.contents && "items" in (doc.contents as any)) {
        const items = (doc.contents as any).items || [];
        items.forEach((item: any) => {
          if (item && item.key && typeof item.key.value === "string") {
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

      fs.writeFileSync(this._configPath, yamlContent, "utf8");

      if (this._statusMessage) {
        this._statusMessage.dispose();
      }

      this._statusMessage = vscode.window.setStatusBarMessage(
        `MegaLinter configuration saved (${path.basename(this._configPath)})`,
        2000,
      );

      await this._sendConfig();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to save configuration: ${error}`);
    }
  }

  public dispose() {
    ConfigurationPanel.currentPanel = undefined;

    // Clean up our resources
    this._panel.dispose();

    if (this._statusMessage) {
      this._statusMessage.dispose();
    }

    disposeAll(this._disposables);
  }

  private _update() {
    const webview = this._panel.webview;
    this._webviewReady = false;
    this._panel.webview.html = this._getHtmlForWebview(webview);
    void this._sendConfig();
  }

  private async _runCommand(command: string) {
    const cwd = this._configPath ? path.dirname(this._configPath) : undefined;
    const terminal = vscode.window.createTerminal({
      name: "MegaLinter Setup",
      cwd,
    });
    terminal.show(true);
    terminal.sendText(command, true);
    vscode.window.showInformationMessage(`Running: ${command}`);
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    return buildWebviewHtml({
      webview,
      extensionUri: this._extensionUri,
      title: "MegaLinter Configuration",
      view: "config",
    });
  }
}
