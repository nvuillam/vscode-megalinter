/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import * as YAML from "yaml";
import type { NavigationTarget } from "./extension";
import { CustomFlavorPanel } from "./customFlavorPanel";
import { logMegaLinter } from "./outputChannel";
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
  | { type: "openRunPanel" }
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

  private readonly _httpClient = axios.create({
    headers: { "User-Agent": "vscode-megalinter" },
    maxRedirects: 5,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

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
      logMegaLinter(`Config view: reveal existing panel | configPath=${configPath}`);
      ConfigurationPanel.currentPanel._panel.reveal(column);
      ConfigurationPanel.currentPanel._configPath = configPath;
      ConfigurationPanel.currentPanel._update();
      return ConfigurationPanel.currentPanel;
    }

    // Otherwise, create a new panel
    const panel = createMegalinterWebviewPanel({
      viewType: "megalinterConfig",
      title: "MegaLinter Config",
      extensionUri,
      column,
    });

    logMegaLinter(`Config view: create panel | configPath=${configPath}`);

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
        const msgStart = Date.now();
        switch (message.type) {
          case "ready":
            logMegaLinter("Config view: webview ready");
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
            logMegaLinter("Config view: getConfig");
            await this._sendConfig();
            break;
          case "saveConfig":
            logMegaLinter("Config view: saveConfig");
            await this._saveConfig(message.config);
            break;
          case "installMegaLinter":
            logMegaLinter("Config view: installMegaLinter");
            await this._runCommand(
              "npx --yes mega-linter-runner@latest --install",
            );
            break;
          case "upgradeMegaLinter":
            logMegaLinter("Config view: upgradeMegaLinter");
            await this._runCommand(
              "npx --yes mega-linter-runner@latest --upgrade",
            );
            break;
          case "openRunPanel": {
            logMegaLinter("Config view: openRunPanel");
            const { RunPanel } = await import("./runPanel");
            RunPanel.createOrShow(this._extensionUri);
            break;
          }
          case "openCustomFlavorBuilder":
            logMegaLinter("Config view: openCustomFlavorBuilder");
            CustomFlavorPanel.createOrShow(this._extensionUri);
            break;
          case "openFile":
            logMegaLinter(`Config view: openFile | path=${message.filePath}`);
            await this._openFile(message.filePath);
            break;
          case "resolveLinterConfigFile":
            logMegaLinter(`Config view: resolveLinterConfigFile | linterKey=${message.linterKey}`);
            await this._resolveAndSendLinterConfigFile(
              message.linterKey,
              message.overrides,
            );
            break;
          case "createLinterConfigFileFromDefault":
            logMegaLinter(`Config view: createLinterConfigFileFromDefault | linterKey=${message.linterKey}`);
            await this._createLinterConfigFileFromDefault(
              message.linterKey,
              message.destination,
              message.mode,
            );
            break;
          case "openExternal":
            logMegaLinter(`Config view: openExternal | url=${message.url}`);
            await openExternalHttpUrl(message.url);
            break;
          case "error":
            logMegaLinter(`Config view: webview error | ${message.message}`);
            vscode.window.showErrorMessage(message.message);
            break;
        }

        logMegaLinter(`Config view: handled ${message.type} in ${Date.now() - msgStart}ms`);
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
    const start = Date.now();
    try {
      logMegaLinter("Config view: fetching descriptor metadata (remote)…");
      const response = await this._httpClient.get(apiUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "vscode-megalinter-extension",
        },
        timeout: 8000,
      });

      const files = response.data as Array<{
        name: string;
        download_url?: string;
        type?: string;
      }>;
      const descriptorFiles = files.filter(
        (item) =>
          item.type === "file" &&
          item.name.toLowerCase().endsWith(".megalinter-descriptor.yml"),
      );

      logMegaLinter(
        `Config view: remote descriptor list in ${Date.now() - start}ms | files=${descriptorFiles.length}`,
      );

      let okCount = 0;
      let failCount = 0;

      for (const file of descriptorFiles) {
        if (!file.download_url) {
          continue;
        }
        try {
          const descriptorResponse = await this._httpClient.get<string>(
            file.download_url,
            {
              timeout: 8000,
              responseType: "text",
            },
          );

          const content = descriptorResponse.data;
          this._ingestDescriptorContent(file.name, content, metadata);
          okCount += 1;
        } catch (fileErr) {
          failCount += 1;
          console.warn(`Failed to download descriptor ${file.name}`, fileErr);
        }
      }

      logMegaLinter(
        `Config view: remote descriptor download in ${Date.now() - start}ms | ok=${okCount} failed=${failCount} metaKeys=${Object.keys(metadata).length}`,
      );

      return descriptorFiles.length > 0 && Object.keys(metadata).length > 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logMegaLinter(
        `Config view: remote descriptor metadata fetch failed in ${Date.now() - start}ms | ${msg}`,
      );
      console.warn("Remote descriptor metadata fetch failed", err);
      return false;
    }
  }

  private async _loadDescriptorMetadata(): Promise<
    Record<string, LinterDescriptorMetadata>
  > {
    if (this._linterMetadataCache) {
      logMegaLinter(
        `Config view: descriptor metadata cache hit (memory) | keys=${Object.keys(this._linterMetadataCache).length}`,
      );
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
      logMegaLinter(
        `Config view: descriptor metadata cache hit (globalState) | keys=${Object.keys(cached.data).length}`,
      );
      return cached.data;
    }

    const metadata: Record<string, LinterDescriptorMetadata> = {};

    const start = Date.now();

    const loadedRemotely = await this._loadRemoteDescriptorMetadata(metadata);
    if (!loadedRemotely) {
      const localStart = Date.now();
      this._loadLocalDescriptorMetadata(metadata);
      logMegaLinter(
        `Config view: local descriptor load in ${Date.now() - localStart}ms | keys=${Object.keys(metadata).length}`,
      );
    }

    if (loadedRemotely && Object.keys(metadata).length > 0) {
      await this._state.update(DESCRIPTOR_CACHE_KEY, {
        data: metadata,
        timestamp: Date.now(),
      } satisfies CachedDescriptorMetadata);
    }

    this._linterMetadataCache = metadata;
    logMegaLinter(
      `Config view: descriptor metadata ready in ${Date.now() - start}ms | keys=${Object.keys(metadata).length} source=${loadedRemotely ? "remote" : "local"}`,
    );
    return metadata;
  }

  private async _sendConfig() {
    const start = Date.now();
    logMegaLinter(`Config view: loading config | path=${this._configPath}`);
    let config: any = {};
    let localConfig: any = {};
    let inheritedConfig: any = {};
    let inheritedKeySources: Record<string, string> = {};
    let extendsItems: string[] = [];
    let extendsErrors: string[] = [];
    const configExists = fs.existsSync(this._configPath);

    logMegaLinter(`Config view: config exists=${configExists}`);

    if (configExists) {
      try {
        const t0 = Date.now();
        const content = fs.readFileSync(this._configPath, "utf8");

        const t1 = Date.now();
        const doc = YAML.parseDocument(content);
        localConfig = (doc.toJS() as any) || {};

        const t2 = Date.now();
        const resolved = await this._resolveExtends(localConfig);
        logMegaLinter(
          `Config view: resolve EXTENDS in ${Date.now() - t2}ms | extendsItems=${resolved.extendsItems.length} errors=${resolved.extendsErrors.length}`,
        );
        config = resolved.effectiveConfig;
        inheritedConfig = resolved.inheritedConfig;
        inheritedKeySources = resolved.inheritedKeySources;
        extendsItems = resolved.extendsItems;
        extendsErrors = resolved.extendsErrors;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logMegaLinter(`Config view: failed to read config | ${msg}`);
        console.error("Error reading config file:", error);
        config = {};
        localConfig = {};
      }
    }

    let linterMetadata: Record<string, LinterDescriptorMetadata> = {};

    try {
      const t0 = Date.now();
      linterMetadata = await this._loadDescriptorMetadata();
      logMegaLinter(
        `Config view: load linter metadata in ${Date.now() - t0}ms | keys=${Object.keys(linterMetadata).length}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logMegaLinter(`Config view: unable to load linter metadata | ${msg}`);
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

    logMegaLinter(
      `Config view: config sent to webview in ${Date.now() - start}ms | effectiveKeys=${Object.keys(config || {}).length} localKeys=${Object.keys(localConfig || {}).length}`,
    );
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
      logMegaLinter(`Config view: EXTENDS cache hit | ${url}`);
      return cached.parsed;
    }

    const t0 = Date.now();
    const text = await this._fetchText(url, 10_000);
    logMegaLinter(
      `Config view: EXTENDS fetched in ${Date.now() - t0}ms | ${url} | bytes=${Buffer.byteLength(
        text,
        "utf8",
      )}`,
    );
    const parsed = (YAML.parse(text) as any) || {};
    this._extendsYamlCache.set(url, { timestamp: Date.now(), parsed });
    return parsed;
  }

  private _fetchText(
    url: string,
    timeoutMs: number,
  ): Promise<string> {
    return this._httpClient
      .get<string>(url, {
        timeout: timeoutMs,
        responseType: "text",
        maxRedirects: 5,
        headers: {
          Accept: "text/yaml, text/plain, */*",
        },
        validateStatus: (status) => status >= 200 && status < 300,
      })
      .then((response) => {
        return response.data ?? "";
      })
      .catch((err: unknown) => {
        if (axios.isAxiosError(err)) {
          if (err.code === "ECONNABORTED") {
            throw new Error(`Timeout fetching ${url}`);
          }
          const status = err.response?.status;
          if (status) {
            throw new Error(`Failed to fetch ${url} (HTTP ${status})`);
          }
        }
        throw err instanceof Error ? err : new Error(String(err));
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
      logMegaLinter("Config view: EXTENDS not present");
      return {
        localConfig,
        effectiveConfig: localConfig,
        inheritedConfig: {},
        inheritedKeySources: {},
        extendsItems: [],
        extendsErrors: [],
      };
    }

    logMegaLinter(`Config view: EXTENDS detected | items=${extendsItems.length}`);

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
          const t0 = Date.now();
          const loaded = await this._loadExtendsItem(item);
          logMegaLinter(
            `Config view: EXTENDS loaded in ${Date.now() - t0}ms | ${loaded.sourceId}`,
          );
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
          logMegaLinter(`Config view: EXTENDS error | ${item} | ${msg}`);
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

    // Try remote first
    try {
      const url = `https://raw.githubusercontent.com/oxsecurity/megalinter/main/TEMPLATES/${normalized}`;
      const response = await this._httpClient.get<string>(url, {
        timeout: 6000,
        responseType: "text",
      });
      const text = response.data ?? "";
      return {
        exists: true,
        source: "remote",
        content: text,
        truncated: false,
      };
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
          undefined,
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
    const start = Date.now();
    try {
      logMegaLinter(`Config view: saving config | path=${this._configPath}`);
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

      logMegaLinter(
        `Config view: saved in ${Date.now() - start}ms | bytes=${Buffer.byteLength(yamlContent, "utf8")} keys=${Object.keys(sanitizedConfig || {}).length}`,
      );

      if (this._statusMessage) {
        this._statusMessage.dispose();
      }

      this._statusMessage = vscode.window.setStatusBarMessage(
        `MegaLinter configuration saved (${path.basename(this._configPath)})`,
        2000,
      );

      await this._sendConfig();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logMegaLinter(`Config view: save failed in ${Date.now() - start}ms | ${msg}`);
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
    logMegaLinter(`Config view: run command | cwd=${cwd ?? ""} | ${command}`);
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
      title: "MegaLinter Config",
      view: "config",
    });
  }
}
