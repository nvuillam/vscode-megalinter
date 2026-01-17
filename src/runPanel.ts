/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import Koa from "koa";
import * as http from "http";
import * as os from "os";
import { spawn } from "child_process";
import {
  appendMegaLinterOutput,
  getMegaLinterOutputChannel,
  logMegaLinter,
  showMegaLinterOutput,
} from "./outputChannel";
import { getConfiguredRunnerVersion } from "./runnerVersion";
import {
  buildWebviewHtml,
  createMegalinterWebviewPanel,
  disposeAll,
  openExternalHttpUrl,
} from "./panelUtils";
import type {
  RunPanelInboundMessage,
  RunPanelOutboundMessage,
  RunResult,
  ConfigNavigationTarget,
  RunPreferences,
  RunRecommendation,
} from "./shared/webviewMessages";
import type { NavigationTarget } from "./extension";
import { EngineStatusService, type Engine, type EngineStatus } from "./run/engineStatus";
import { RunnerVersionService, isValidSemver } from "./run/runnerVersions";
import { RecommendationsService } from "./run/recommendations";

function buildOnlyLinterImage(linterKey: string, release: string): string {
  const tag = release || "latest";
  return `ghcr.io/oxsecurity/megalinter-only-${linterKey.toLowerCase()}:${tag}`;
}

export class RunPanel {
  public static currentPanel: RunPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _webviewReady = false;
  private _disposables: vscode.Disposable[] = [];

  private _runningChild:
    | {
        runId: string;
        reportFolderPath: string;
        child: ReturnType<typeof spawn>;
        engine: Engine;
        containerImage?: string;
      }
    | undefined;

  private _webhook:
    | {
        runId: string;
        engine: Engine;
        reportFolderPath: string;
        server: http.Server;
        port: number;
        token: string;
        path: string;
        resultsByKey: Map<string, RunResult>;
        flushTimer: NodeJS.Timeout | null;
        initStage:
          | "runner"
          | "pull"
          | "startImage"
          | "analyzeConfig"
          | "preCommands"
          | "activation"
          | "collectFiles"
          | null;
      }
    | undefined;

  private _flavorEnumCache: string[] | null = null;
  private _linterEnumCache: string[] | null = null;
  private readonly _engineStatusService = new EngineStatusService();
  private readonly _runnerVersionService = new RunnerVersionService();
  private readonly _recommendationsService = new RecommendationsService();

  public static createOrShow(extensionUri: vscode.Uri): RunPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (RunPanel.currentPanel) {
      RunPanel.currentPanel._panel.reveal(column);
      RunPanel.currentPanel._update();
      return RunPanel.currentPanel;
    }

    const panel = createMegalinterWebviewPanel({
      viewType: "megalinterRun",
      title: "MegaLinter Run",
      extensionUri,
      column,
    });

    RunPanel.currentPanel = new RunPanel(panel, extensionUri);
    return RunPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message: RunPanelInboundMessage) => {
        try {
          switch (message.type) {
            case "ready":
              this._webviewReady = true;
              await this._sendRunContext();
              break;
            case "getRunContext":
              await this._sendRunContext(message.force);
              break;
            case "runMegalinter":
              await this._runMegalinter(
                message.engine,
                message.flavor,
                message.runnerVersion,
                message.parallelCores,
              );
              break;
            case "cancelRun":
              await this._cancelRun();
              break;
            case "updateRunSetting":
              await this._updateRunSetting(message.key, message.value);
              break;
            case "showOutput":
              showMegaLinterOutput(false);
              break;
            case "openConfigSection":
              await this._navigateToConfig(message.target);
              break;
            case "revealPath":
              await this._revealPath(message.path);
              break;
            case "openFile":
              await this._openFile(message.filePath);
              break;
            case "openExtension":
              await this._openExtension(message.extensionId);
              break;
            case "openExternal":
              await openExternalHttpUrl(message.url);
              break;
            case "info":
              void vscode.window.showInformationMessage(message.message);
              break;
            case "error":
              vscode.window.showErrorMessage(message.message);
              break;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this._postMessage({ type: "runError", message: msg });
        }
      },
      null,
      this._disposables,
    );
  }

  public dispose() {
    RunPanel.currentPanel = undefined;

    if (this._runningChild) {
      try {
        this._runningChild.child.kill();
      } catch {
        // ignore
      }
      this._runningChild = undefined;
    }

    this._stopWebhookServer();

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
      title: "MegaLinter Run",
      view: "run",
    });
  }

  private _postMessage(message: RunPanelOutboundMessage) {
    this._panel.webview.postMessage(message);
  }

  private _debugEnabled(): boolean {
    const config = vscode.workspace.getConfiguration("megalinter");
    return config.get<boolean>("debug") === true;
  }

  private _recommendationsEnabled(): boolean {
    const config = vscode.workspace.getConfiguration("megalinter.run");
    const flag = config.get<boolean>("recommendVsCodeExtensions");
    return flag !== false;
  }

  private _getRunPreferences(): RunPreferences {
    const config = vscode.workspace.getConfiguration("megalinter.run");

    const engineRaw = config.get<string>("engine");
    const engine = engineRaw === "docker" || engineRaw === "podman" ? engineRaw : undefined;

    const flavorRaw = config.get<string>("flavor");
    const flavor = typeof flavorRaw === "string" && flavorRaw.trim() ? flavorRaw.trim() : undefined;

    const versionRaw = config.get<string>("version");
    const runnerVersion = typeof versionRaw === "string" && versionRaw.trim() ? versionRaw.trim() : undefined;

    const parallelCoresRaw = config.get<number>("parallelCores");
    const parallelCores = typeof parallelCoresRaw === "number" && parallelCoresRaw > 0 ? parallelCoresRaw : undefined;

    return { engine, flavor, runnerVersion, parallelCores };
  }

  private _getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders || [];
    if (folders.length === 0) {
      throw new Error("Please open a workspace folder to run MegaLinter");
    }
    return folders[0].uri.fsPath;
  }

  private async _sendRunContext(force?: boolean) {
    if (!this._webviewReady) {
      return;
    }

    const start = Date.now();
    logMegaLinter(`Run view: loading context${force ? " (forced)" : ""}…`);

    const flavorsPromise = Promise.resolve().then(() => {
      const t0 = Date.now();
      const cached = Boolean(this._flavorEnumCache);
      const v = this._readFlavorEnum();
      logMegaLinter(
        `Run view: init flavors in ${Date.now() - t0}ms` +
          (cached ? " (cached)" : "") +
          ` | count=${v.length}`,
      );
      return v;
    });

    const lintersPromise = Promise.resolve().then(() => {
      const t0 = Date.now();
      const cached = Boolean(this._linterEnumCache);
      const v = this._readLinterEnum();
      logMegaLinter(
        `Run view: init linters in ${Date.now() - t0}ms` +
          (cached ? " (cached)" : "") +
          ` | count=${v.length}`,
      );
      return v;
    });

    const runnerPromise = Promise.resolve().then(async () => {
      const t0 = Date.now();
      const v = await this._getRunnerVersions();
      logMegaLinter(
        `Run view: init versions in ${Date.now() - t0}ms | count=${v.versions.length}`,
      );
      return v;
    });

    const enginesPromise = Promise.resolve().then(async () => {
      const t0 = Date.now();
      const v = await this._detectEngines(force);
      logMegaLinter(`Run view: init engines in ${Date.now() - t0}ms`);
      return v;
    });

    const runPreferences = this._getRunPreferences();

    const [flavors, linters, runnerInfo, engineStatuses] = await Promise.all([
      flavorsPromise,
      lintersPromise,
      runnerPromise,
      enginesPromise,
    ]);

    const { versions, latest } = runnerInfo;
    const availableCores = Math.max(1, (os.cpus()?.length ?? 1));

    const preferredEngine = runPreferences.engine;

    const defaultEngine: Engine | undefined = preferredEngine && engineStatuses[preferredEngine]?.available
      ? preferredEngine
      : engineStatuses.docker.running
          ? "docker"
          : engineStatuses.podman.running
            ? "podman"
            : engineStatuses.docker.available
              ? "docker"
              : engineStatuses.podman.available
                ? "podman"
                : undefined;

    logMegaLinter(
      `Run view: context loaded in ${Date.now() - start}ms | ` +
        `flavors=${flavors.length} versions=${versions.length} ` +
        `docker=${engineStatuses.docker.available ? (engineStatuses.docker.running ? "available" : "not started") : "not installed"} ` +
        `podman=${engineStatuses.podman.available ? (engineStatuses.podman.running ? "available" : "not started") : "not installed"}`,
    );

    this._postMessage({
      type: "runContext",
      workspaceRoot: this._getWorkspaceRoot(),
      flavors,
      linters,
      runnerVersions: versions,
      latestRunnerVersion: latest || undefined,
      engines: engineStatuses,
      defaultEngine,
      maxParallelCores: availableCores,
      runPreferences,
    });
  }

  private _readFlavorEnum(): string[] {
    if (this._flavorEnumCache) {
      return this._flavorEnumCache;
    }

    const schemaPath = path.join(
      this._extensionUri.fsPath,
      "src",
      "descriptors",
      "schemas",
      "megalinter-descriptor.jsonschema.json",
    );

    const raw = fs.readFileSync(schemaPath, "utf8");
    const parsed = JSON.parse(raw) as any;
    const enumValues = parsed?.definitions?.enum_flavors?.enum;

    const uniqueFlavors: string[] = [];
    if (Array.isArray(enumValues)) {
      for (const v of enumValues) {
        if (typeof v !== "string") {
          continue;
        }
        if (v === "all" || v === "all_flavors") {
          continue;
        }
        if (uniqueFlavors.includes(v)) {
          continue;
        }
        uniqueFlavors.push(v);
      }
    }

    const withFull = ["full", ...uniqueFlavors.filter((v) => v !== "full")];

    this._flavorEnumCache = withFull.length > 0 ? withFull : ["full"];
    return this._flavorEnumCache;
  }

  private async _getRunnerVersions(): Promise<{ versions: string[]; latest: string | null }> {
    return this._runnerVersionService.getRunnerVersions();
  }

  private async _detectEngines(force?: boolean): Promise<Record<Engine, EngineStatus>> {
    return this._engineStatusService.detect(force);
  }

  private _readLinterEnum(): string[] {
    if (this._linterEnumCache) {
      return this._linterEnumCache;
    }

    const schemaPath = path.join(
      this._extensionUri.fsPath,
      "src",
      "descriptors",
      "schemas",
      "megalinter-configuration.jsonschema.json",
    );

    const raw = fs.readFileSync(schemaPath, "utf8");
    const parsed = JSON.parse(raw) as any;
    const enumValues = parsed?.definitions?.enum_linter_keys?.enum;

    const linters: string[] = Array.isArray(enumValues)
      ? enumValues.filter((v: unknown): v is string => typeof v === "string")
      : [];

    this._linterEnumCache = linters;
    return this._linterEnumCache;
  }

  private async _updateRunSetting(
    key: "engine" | "flavor" | "version" | "parallelCores" | "recommendVsCodeExtensions",
    value: string,
  ) {
    const config = vscode.workspace.getConfiguration("megalinter.run");

    if (key === "engine") {
      const normalized = value === "docker" || value === "podman" ? value : undefined;
      if (!normalized) {
        return;
      }
      logMegaLinter(`Run view: setting updated | key=engine value=${normalized}`);
      await config.update("engine", normalized, vscode.ConfigurationTarget.Workspace);
      return;
    }

    if (key === "flavor") {
      const trimmed = typeof value === "string" ? value.trim() : "";
      if (!trimmed) {
        return;
      }
      logMegaLinter(`Run view: setting updated | key=flavor value=${trimmed}`);
      await config.update("flavor", trimmed, vscode.ConfigurationTarget.Workspace);
      return;
    }

    if (key === "version") {
      const trimmed = typeof value === "string" ? value.trim() : "";
      if (!trimmed) {
        return;
      }
      logMegaLinter(`Run view: setting updated | key=version value=${trimmed}`);
      await config.update("version", trimmed, vscode.ConfigurationTarget.Workspace);
    }

    if (key === "parallelCores") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return;
      }
      logMegaLinter(`Run view: setting updated | key=parallelCores value=${parsed}`);
      await config.update("parallelCores", parsed, vscode.ConfigurationTarget.Workspace);
    }

    if (key === "recommendVsCodeExtensions") {
      const boolValue = value === "true";
      logMegaLinter(`Run view: setting updated | key=recommendVsCodeExtensions value=${boolValue}`);
      await config.update("recommendVsCodeExtensions", boolValue, vscode.ConfigurationTarget.Workspace);
    }
  }

  private async _runMegalinter(
    engine: Engine,
    flavor: string,
    runnerVersion: string,
    parallelCores: number,
  ) {
    if (this._runningChild) {
      throw new Error("MegaLinter is already running");
    }

    // Ensure any previous webhook server is stopped before starting a new run.
    this._stopWebhookServer();

    const workspaceRoot = this._getWorkspaceRoot();

    const engineStatuses = await this._detectEngines(true);
    const selectedStatus = engineStatuses[engine];
    if (!selectedStatus.available) {
      throw new Error(`${engine} is not available. Please install it and try again.`);
    }
    if (!selectedStatus.running) {
      throw new Error(
        `${engine} is installed but does not appear to be running. Please start the daemon and try again.`,
      );
    }

    const linterKeys = this._readLinterEnum();
    const safeFlavor = /^[a-z0-9_\-]+$/i.test(flavor) ? flavor : "full";
    const isLinterSelection = linterKeys.includes(safeFlavor);
    const allowedChannels = new Set(["latest", "beta", "alpha"]);
    const safeRelease = allowedChannels.has(runnerVersion) || isValidSemver(runnerVersion)
      ? runnerVersion
      : "latest";
    const cpuCount = Math.max(1, (os.cpus()?.length ?? 1));
    const safeParallel = Math.min(cpuCount, Math.max(1, Math.floor(parallelCores || 4)));
    const runnerPackageVersion = getConfiguredRunnerVersion();

    const runId = createRunId();
    const runFolderName = `${formatRunFolderTimestamp(new Date())}_${safeFlavor}`;

    const reportFolderPath = path.join(workspaceRoot, "megalinter-reports", runFolderName);
    fs.mkdirSync(reportFolderPath, { recursive: true });

    const reportFolderRel = `megalinter-reports/${runFolderName}`;

    const webhook = await this._startWebhookServer({ runId, engine, reportFolderPath });
    const { webhookUrl, webhookToken } = webhook;

    const envFromDotenv = loadDotenvEnv(workspaceRoot);

    // On Windows, spawning a .cmd directly with shell:false frequently fails with spawn EINVAL.
    // Use the shell so VS Code/Node can resolve npx.cmd correctly.
    const npxCmd = "npx";
    const flavorArgs = safeFlavor === "full" ? [] : ["--flavor", safeFlavor];

    const args = [
      "--yes",
      `mega-linter-runner@${runnerPackageVersion}`,
      ...(isLinterSelection ? [] : flavorArgs),
      "--container-engine",
      engine,
      ...(isLinterSelection
        ? ["--image", buildOnlyLinterImage(safeFlavor, safeRelease)]
        : ["--release", safeRelease]),
      "--path",
      workspaceRoot,
      // "--remove-container",
      ...
        (isLinterSelection
          ? ["-e", `ENABLE_LINTERS=${safeFlavor}`]
          : []),
      "-e",
      `REPORT_OUTPUT_FOLDER=/tmp/lint/${reportFolderRel}`,
      "-e",
      "OUTPUT_DETAIL=detailed",
      "-e",
      "WEBHOOK_REPORTER=true",
      "-e",
      `WEBHOOK_REPORTER_URL=${webhookUrl}`,
      "-e",
      `WEBHOOK_REPORTER_BEARER_TOKEN=${webhookToken}`,
      "-e",
      `PARALLEL_PROCESS_NUMBER=${safeParallel}`,
    ];

    const commandLine = formatCommandLine(npxCmd, redactArgs(args));

    logMegaLinter(
      `Run ${runId}: starting | engine=${engine} flavor=${safeFlavor} runnerPackage=${runnerPackageVersion} ${
        isLinterSelection
          ? `image=${buildOnlyLinterImage(safeFlavor, safeRelease)}`
          : `release=${safeRelease}`
      } cores=${safeParallel}/${cpuCount}`,
    );
    logMegaLinter(`Run ${runId}: report folder ${reportFolderPath}`);
    logMegaLinter(`Run ${runId}: command ${commandLine}`);

    this._postMessage({
      type: "runStatus",
      status: "running",
      runId,
      reportFolderPath,
      reportFolderRel,
    });

    this._postMessage({
      type: "runRecommendations",
      runId,
      recommendations: [],
    });

    logMegaLinter(
      `Run ${runId}: spawn | platform=${process.platform} node=${process.version} cwd=${workspaceRoot}`,
    );

    const child = spawn(npxCmd, args, {
      cwd: workspaceRoot,
      env: {
        ...envFromDotenv,
        ...process.env,
      },
      shell: process.platform === "win32",
      windowsHide: true,
    });

    this._runningChild = {
      runId,
      reportFolderPath,
      child,
      engine,
      containerImage: isLinterSelection ? buildOnlyLinterImage(safeFlavor, safeRelease) : undefined,
    };

    const forward = (chunk: Buffer) => {
      // Mirror process output to VS Code Output panel.
      const text = chunk.toString("utf8");
      appendMegaLinterOutput(text);
      this._maybeCaptureContainerImage(text, runId);
      this._maybeUpdateInitStageFromLog(text, runId);
    };

    child.stdout.on("data", forward);
    child.stderr.on("data", forward);

    child.on("error", (err) => {
      if (this._runningChild?.runId === runId) {
        this._runningChild = undefined;
      }

      // Ensure we don't leave the webhook server running if spawn fails.
      this._stopWebhookServer();

      logMegaLinter(`Run ${runId}: spawn error: ${err instanceof Error ? err.message : String(err)}`);
      if (process.platform === "win32") {
        void logWhereNpxDiagnostics();
      }
      this._postMessage({
        type: "runError",
        message: err instanceof Error ? err.message : String(err),
        commandLine,
      });
      this._postMessage({
        type: "runStatus",
        status: "error",
        runId,
        reportFolderPath,
        reportFolderRel,
      });
    });

    child.on("close", async (code) => {
      if (this._runningChild?.runId === runId) {
        this._runningChild = undefined;
      }

      // Stop webhook server as early as possible once the run is done.
      const webhookResults = this._collectWebhookResults(runId);
      this._stopWebhookServer();

      logMegaLinter(`Run ${runId}: completed with exitCode=${typeof code === "number" ? code : "unknown"}`);
      logMegaLinter(`Run ${runId}: webhook results=${webhookResults.length}`);

      try {
        const results = webhookResults;

        this._postMessage({
          type: "runResults",
          runId,
          reportFolderPath,
          results,
          exitCode: typeof code === "number" ? code : null,
        });

        this._postMessage({
          type: "runStatus",
          status: "completed",
          runId,
          reportFolderPath,
          reportFolderRel,
        });

        await this._sendRecommendedExtensions(runId, reportFolderPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this._postMessage({ type: "runError", message: msg });
        this._postMessage({
          type: "runStatus",
          status: "error",
          runId,
          reportFolderPath,
          reportFolderRel,
        });
      }
    });
  }

  private async _cancelRun() {
    if (!this._runningChild) {
      return;
    }

    const { runId, reportFolderPath, child, engine, containerImage } = this._runningChild;
    try {
      child.kill();
    } catch {
      // ignore
    }

    this._runningChild = undefined;

    await this._killRunningContainerIfAny(runId, engine, containerImage);

    this._stopWebhookServer();

    this._postMessage({
      type: "runStatus",
      status: "idle",
      runId,
      reportFolderPath,
      reportFolderRel: "",
    });

    this._postMessage({ type: "runRecommendations", runId, recommendations: [] });
  }

  private async _sendRecommendedExtensions(runId: string, reportFolderPath: string) {
    if (!this._recommendationsEnabled()) {
      this._postMessage({ type: "runRecommendations", runId, recommendations: [] });
      return;
    }

    try {
      const recommendations = await this._loadExtensionRecommendations(reportFolderPath);
      this._postMessage({ type: "runRecommendations", runId, recommendations });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logMegaLinter(`Run ${runId}: unable to load recommended extensions | ${msg}`);
    }
  }

  private async _loadExtensionRecommendations(reportFolderPath: string): Promise<RunRecommendation[]> {
    return this._recommendationsService.load(reportFolderPath);
  }

  private async _killRunningContainerIfAny(
    runId: string,
    engine: Engine,
    containerImage?: string,
  ) {
    if (!containerImage) {
      return;
    }

    try {
      const ids = await listContainersByImage(engine, containerImage);
      if (!ids.length) {
        logMegaLinter(`Run ${runId}: no running containers found for ${containerImage}`);
        return;
      }

      await killContainers(engine, ids);
      logMegaLinter(
        `Run ${runId}: killed ${ids.length} container(s) for image ${containerImage} -> ${ids.join(",")}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logMegaLinter(`Run ${runId}: failed to stop containers for ${containerImage} | ${msg}`);
    }
  }

  private async _startWebhookServer(params: {
    runId: string;
    engine: Engine;
    reportFolderPath: string;
  }): Promise<{ webhookUrl: string; webhookToken: string }> {
    const token = createWebhookToken();
    const hookPath = `/__vscode_megalinter_webhook/${encodeURIComponent(params.runId)}`;

    const resultsByKey = new Map<string, RunResult>();

    const app = new Koa();

    app.use(async (ctx) => {
      const method = (ctx.method || "").toUpperCase();
      const reqPath = ctx.path;

      if (method !== "POST" || reqPath !== hookPath) {
        ctx.status = 404;
        ctx.body = { ok: false };
        return;
      }

      const auth = ctx.req.headers["authorization"];
      if (auth !== `Bearer ${token}`) {
        ctx.status = 401;
        ctx.body = { ok: false };
        return;
      }

      try {
        const raw = await readRequestBody(ctx.req, 2_000_000);
        const payload = JSON.parse(raw) as any;

        this._ingestWebhookPayload(
          { runId: params.runId, reportFolderPath: params.reportFolderPath },
          payload,
        );

        ctx.status = 200;
        ctx.body = { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.status = 500;
        ctx.body = { ok: false, error: msg };
      }
    });

    // Bind to all interfaces so host.docker.internal/host.containers.internal can reach us.
    const server = app.listen(0, "0.0.0.0");

    const { port } = await new Promise<{ port: number }>((resolve, reject) => {
      server.on("error", reject);
      server.on("listening", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("Unable to determine webhook server port"));
          return;
        }
        resolve({ port: addr.port });
      });
    });

    this._webhook = {
      runId: params.runId,
      engine: params.engine,
      reportFolderPath: params.reportFolderPath,
      server,
      port,
      token,
      path: hookPath,
      resultsByKey,
      flushTimer: null,
      initStage: null,
    };

    const host = await resolveWebhookHost(params.engine);
    const webhookUrl = `http://${host}:${port}${hookPath}`;
    logMegaLinter(
      `Run ${params.runId}: webhook server on port ${port} | engine=${params.engine} host=${host}`,
    );

    return { webhookUrl, webhookToken: token };
  }

  private _stopWebhookServer() {
    if (!this._webhook) {
      return;
    }

    const { server, flushTimer } = this._webhook;
    if (flushTimer) {
      clearTimeout(flushTimer);
    }

    try {
      server.close();
    } catch {
      // ignore
    }

    this._webhook = undefined;
  }

  private _collectWebhookResults(runId: string): RunResult[] {
    if (!this._webhook || this._webhook.runId !== runId) {
      return [];
    }
    return this._sortedResults(Array.from(this._webhook.resultsByKey.values()));
  }

  private _scheduleWebhookFlush(runId: string) {
    if (!this._webhook || this._webhook.runId !== runId) {
      return;
    }
    if (this._webhook.flushTimer) {
      return;
    }

    this._webhook.flushTimer = setTimeout(() => {
      if (!this._webhook || this._webhook.runId !== runId) {
        return;
      }

      this._webhook.flushTimer = null;

      const results = this._collectWebhookResults(runId);
      if (results.length === 0) {
        return;
      }

      this._postMessage({
        type: "runResults",
        runId,
        reportFolderPath: this._webhook.reportFolderPath,
        results,
        exitCode: null,
      });
    }, 200);
  }

  private _ingestWebhookPayload(
    ctx: { runId: string; reportFolderPath: string },
    payload: any,
  ) {
    if (!this._webhook || this._webhook.runId !== ctx.runId) {
      return;
    }

    const messageType = typeof payload?.messageType === "string" ? payload.messageType : "";

    if (this._debugEnabled()) {
      try {
        const raw = JSON.stringify(payload);
        const trimmed = raw.length > 5000 ? `${raw.slice(0, 5000)}... (truncated)` : raw;
        logMegaLinter(`Run ${ctx.runId}: webhook ${messageType} received -> ${trimmed}`);
      } catch {
        logMegaLinter(`Run ${ctx.runId}: webhook ${messageType} received -> [unserializable]`);
      }
    }


    if (messageType === "megalinterStart" && Array.isArray(payload?.linters)) {
      for (const l of payload.linters) {
        this._upsertLinterFromWebhook(ctx, l, "PENDING");
      }
      // No init stage change here; we surface detailed stages via log parsing.
      this._scheduleWebhookFlush(ctx.runId);
      return;
    }

    if (messageType === "linterStart") {
      this._upsertLinterFromWebhook(ctx, payload, "RUNNING");
      this._scheduleWebhookFlush(ctx.runId);
      return;
    }

    if (messageType === "linterComplete") {
      const linterStatus = typeof payload?.linterStatus === "string" ? payload.linterStatus : "";
      const status: RunResult["status"] = linterStatus === "success" ? "SUCCESS" : "ERROR";
      this._upsertLinterFromWebhook(ctx, payload, status);

      const key = typeof payload?.linterKey === "string" ? payload.linterKey : "";
      if (key) {
        logMegaLinter(`Run ${ctx.runId}: ${key} -> ${status}`);
      }

      this._scheduleWebhookFlush(ctx.runId);
      return;
    }
  }

  private _upsertLinterFromWebhook(
    ctx: { runId: string; reportFolderPath: string },
    payload: any,
    statusOverride: RunResult["status"] | undefined,
  ) {
    if (!this._webhook || this._webhook.runId !== ctx.runId) {
      return;
    }

    const keyRaw =
      typeof payload?.linterKey === "string"
        ? payload.linterKey
        : typeof payload?.linterId === "string" && typeof payload?.descriptorId === "string"
          ? `${payload.descriptorId}_${payload.linterId}`
          : "";

    if (!keyRaw) {
      return;
    }

    const descriptorId = typeof payload?.descriptorId === "string" ? payload.descriptorId : "";
    const linterId = typeof payload?.linterId === "string" ? payload.linterId : "";

    const existing = this._webhook.resultsByKey.get(keyRaw);

    const filesNumber = typeof payload?.filesNumber === "number" ? payload.filesNumber : undefined;
    const elapsedSeconds =
      typeof payload?.linterElapsedTime === "number" ? payload.linterElapsedTime : existing?.elapsedSeconds;
    const errors =
      typeof payload?.linterErrorNumber === "number" ? payload.linterErrorNumber : existing?.errors;
    const linterVersion =
      typeof payload?.linterVersion === "string" && payload.linterVersion.trim() !== ""
        ? payload.linterVersion
        : existing?.linterVersion;

    const status: RunResult["status"] = statusOverride ?? existing?.status ?? "UNKNOWN";

    const inferredLogPath = path.join(ctx.reportFolderPath, "linters_logs", `${keyRaw}-${status}.log`);
    const logFilePath = fs.existsSync(inferredLogPath) ? inferredLogPath : existing?.logFilePath;

    const next: RunResult = {
      key: keyRaw,
      descriptor: existing?.descriptor || descriptorId || (keyRaw.includes("_") ? keyRaw.split("_")[0] : keyRaw),
      linter: existing?.linter || linterId || (keyRaw.includes("_") ? keyRaw.substring(keyRaw.indexOf("_") + 1) : keyRaw),
      linterVersion,
      status,
      logFilePath,
      files: filesNumber ?? existing?.files,
      elapsedSeconds,
      errors,
      warnings: existing?.warnings,
    };

    this._webhook.resultsByKey.set(keyRaw, next);
  }

  private _sortedResults(results: RunResult[]): RunResult[] {
    const order: Record<string, number> = {
      ERROR: 0,
      WARNING: 1,
      RUNNING: 2,
      PENDING: 3,
      SUCCESS: 4,
      UNKNOWN: 5,
    };

    return results.slice().sort((a, b) => {
      const oa = order[a.status] ?? 99;
      const ob = order[b.status] ?? 99;
      if (oa !== ob) {
        return oa - ob;
      }
      return a.key.localeCompare(b.key);
    });
  }

  private _maybeUpdateInitStageFromLog(text: string, runId: string) {
    if (!this._webhook || this._webhook.runId !== runId) {
      return;
    }

    const lowered = text.toLowerCase();

    if (lowered.includes("pulling docker image")) {
      this._setInitStage("pull", runId);
      return;
    }

    if (lowered.includes("docker run")) {
      this._setInitStage("startImage", runId);
      return;
    }

    if (lowered.includes("[megalinter init] one-shot run")) {
      this._setInitStage("analyzeConfig", runId);
      return;
    }

    if (lowered.includes("[pre] run")) {
      this._setInitStage("preCommands", runId);
      return;
    }

    if (lowered.includes("[activation]")) {
      this._setInitStage("activation", runId);
      return;
    }

    if (lowered.includes("megalinter now collects the files")) {
      this._setInitStage("collectFiles", runId);
      return;
    }

    if (lowered.includes("mega-linter-runner") || lowered.includes("initializing")) {
      this._setInitStage("runner", runId);
    }
  }

  private _maybeCaptureContainerImage(text: string, runId: string) {
    if (!this._runningChild || this._runningChild.runId !== runId) {
      return;
    }
    if (this._runningChild.containerImage) {
      return;
    }

    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const image = extractContainerImageFromLine(line);
      if (image) {
        this._runningChild.containerImage = image;
        logMegaLinter(`Run ${runId}: detected container image ${image}`);
        break;
      }
    }
  }

  private _setInitStage(
    stage:
      | "runner"
      | "pull"
      | "startImage"
      | "analyzeConfig"
      | "preCommands"
      | "activation"
      | "collectFiles",
    runId: string,
  ) {
    if (!this._webhook || this._webhook.runId !== runId) {
      return;
    }

    const current = this._webhook.initStage;
    const order: Record<typeof stage, number> = {
      runner: 0,
      pull: 1,
      startImage: 2,
      analyzeConfig: 3,
      preCommands: 4,
      activation: 5,
      collectFiles: 6,
    };
    if (current && order[current] >= order[stage]) {
      return;
    }

    this._webhook.initStage = stage;
    this._postMessage({ type: "runInitStatus", runId, stage });
  }

  private async _navigateToConfig(target: ConfigNavigationTarget) {
    const normalize = (value?: string) =>
      typeof value === "string" && value.trim() ? value.trim().toUpperCase() : "";

    const descriptorId = normalize(target.descriptorId);
    if (!descriptorId) {
      return;
    }

    const linterId = target.type === "linter" ? normalize(target.linterId) : "";

    const navTarget: NavigationTarget =
      target.type === "linter" && linterId
        ? { type: "linter", descriptorId, linterId }
        : { type: "descriptor", descriptorId };

    logMegaLinter(
      `Run view: opening config section | descriptor=${descriptorId}` +
        (navTarget.type === "linter" ? ` linter=${linterId}` : ""),
    );

    await vscode.commands.executeCommand("megalinter.revealSection", navTarget);
  }

  private async _openFile(filePath: string) {
    const uri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  private async _openExtension(extensionId: string) {
    const trimmed = typeof extensionId === "string" ? extensionId.trim() : "";
    if (!trimmed) {
      return;
    }

    try {
      await vscode.commands.executeCommand("extension.open", trimmed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logMegaLinter(`Run view: extension.open failed for ${trimmed} | ${msg}`);
      try {
        await vscode.commands.executeCommand("workbench.extensions.search", trimmed);
      } catch {
        // ignore
      }
    }
  }

  private async _revealPath(fileOrFolderPath: string) {
    if (!fileOrFolderPath || typeof fileOrFolderPath !== "string") {
      return;
    }

    try {
      const uri = vscode.Uri.file(fileOrFolderPath);
      await vscode.commands.executeCommand("revealInExplorer", uri);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logMegaLinter(`Run view: failed to reveal path | ${msg}`);
      void vscode.window.showErrorMessage("Unable to open reports folder");
    }
  }
}

function createRunId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function createWebhookToken(): string {
  // URL-safe enough, and fine for a local bearer token.
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

function readRequestBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on("data", (d) => {
      const buf = Buffer.isBuffer(d) ? d : Buffer.from(d);
      total += buf.length;
      if (total > maxBytes) {
        reject(new Error("Webhook payload too large"));
        try {
          req.destroy();
        } catch {
          // ignore
        }
        return;
      }
      chunks.push(buf);
    });

    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function quoteArgForShell(arg: string): string {
  // For display only.
  if (arg === "") {
    return '""';
  }

  // Quote if it contains whitespace or quotes.
  if (!/[\s"]/g.test(arg)) {
    return arg;
  }

  return `"${arg.replace(/"/g, '\\"')}"`;
}

async function listContainersByImage(engine: Engine, image: string): Promise<string[]> {
  const cmd = process.platform === "win32" ? `${engine}.exe` : engine;
  const args = ["ps", "--filter", `ancestor=${image}`, "--format", "{{.ID}}"]; // ancestor matches by image
  const { stdout } = await execCaptureWithTimeout(cmd, args, 8000);
  return stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function killContainers(engine: Engine, containerIds: string[]): Promise<void> {
  if (!containerIds.length) {
    return;
  }

  const cmd = process.platform === "win32" ? `${engine}.exe` : engine;
  const args = ["kill", ...containerIds];
  await execCaptureWithTimeout(cmd, args, 8000);
}

function execCaptureWithTimeout(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
    });

    let settled = false;
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve({ stdout, stderr });
    }, timeoutMs);

    child.stdout.on("data", (b: Buffer) => {
      stdout += b.toString("utf8");
    });

    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString("utf8");
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (settled) {
        return;
      }
      settled = true;
      reject(err);
    });

    child.on("close", () => {
      clearTimeout(timer);
      if (settled) {
        return;
      }
      settled = true;
      resolve({ stdout, stderr });
    });
  });
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatRunFolderTimestamp(d: Date): string {
  // YYYYMMDD-HHMMSS for predictable report folder naming.
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(
    d.getHours(),
  )}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

function formatCommandLine(cmd: string, args: string[]): string {
  return [cmd, ...args.map(quoteArgForShell)].join(" ");
}

function redactArgs(args: string[]): string[] {
  return args.map((arg) => {
    if (/WEBHOOK_REPORTER_BEARER_TOKEN=/i.test(arg)) {
      return arg.replace(/(WEBHOOK_REPORTER_BEARER_TOKEN=).*/i, "$1<redacted>");
    }
    if (/TOKEN=|PASSWORD=|SECRET=/i.test(arg)) {
      return arg.replace(/(TOKEN=|PASSWORD=|SECRET=).*/i, "$1<redacted>");
    }
    return arg;
  });
}

async function logWhereNpxDiagnostics(): Promise<void> {
  if (process.platform !== "win32") {
    return;
  }

  try {
    const child = spawn("where", ["npx"], { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (b: Buffer) => {
      stdout += b.toString("utf8");
    });

    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString("utf8");
    });

    await new Promise<void>((resolve) => {
      child.on("close", () => resolve());
      child.on("error", () => resolve());
    });

    const out = stdout.trim();
    const err = stderr.trim();
    if (out) {
      logMegaLinter(`Windows diagnostics: where npx -> ${out}`);
    } else if (err) {
      logMegaLinter(`Windows diagnostics: where npx (stderr) -> ${err}`);
    } else {
      logMegaLinter("Windows diagnostics: where npx -> (no output)");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logMegaLinter(`Windows diagnostics: where npx failed -> ${msg}`);
  }
}

async function resolveWebhookHost(engine: Engine): Promise<string> {
  const envOverride = process.env.MEGALINTER_WEBHOOK_HOST;
  if (envOverride && typeof envOverride === "string" && envOverride.trim() !== "") {
    return envOverride.trim();
  }
  if (engine === "docker") {
    return "host.docker.internal";
  }

  // podman default
  return "host.containers.internal";
}

function extractContainerImageFromLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const match = /\b(?:docker|podman)\s+run\b[^\n]*$/i.exec(trimmed);
  if (!match) {
    return null;
  }

  const segment = match[0];
  const tokens = segment.split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return null;
  }

  const raw = tokens[tokens.length - 1];
  const unquoted = raw.replace(/^[\'"]|[\'"]$/g, "");

  if (/^[^\s]+(?::[^\s]+|@[^\s]+)?$/.test(unquoted) && /[/:]/.test(unquoted)) {
    return unquoted;
  }

  return null;
}

function loadDotenvEnv(workspaceRoot: string): Record<string, string> {
  const envPath = path.join(workspaceRoot, ".env");
  if (!fs.existsSync(envPath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(envPath, "utf8");
    const vars: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const match = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(trimmed);
      if (!match) {
        continue;
      }

      const key = match[1];
      let value = match[2];
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      vars[key] = value;
    }

    const count = Object.keys(vars).length;
    if (count > 0) {
      logMegaLinter(`Run view: loaded ${count} variables from .env`);
    }

    return vars;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logMegaLinter(`Run view: failed to read .env | ${msg}`);
    return {};
  }
}






