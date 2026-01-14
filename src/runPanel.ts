/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import Koa from "koa";
import * as http from "http";
import * as net from "net";
import { spawn } from "child_process";
import {
  appendMegaLinterOutput,
  getMegaLinterOutputChannel,
  logMegaLinter,
  showMegaLinterOutput,
} from "./outputChannel";
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
} from "./shared/webviewMessages";

type Engine = "docker" | "podman";

type EngineStatus = {
  available: boolean;
  running: boolean;
  details?: string;
};

type RunnerVersionsCache = {
  timestamp: number;
  versions: string[];
  latest: string | null;
};

const RUNNER_VERSIONS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ENGINE_STATUS_CACHE_TTL_MS = 10 * 1000;

export class RunPanel {
  public static currentPanel: RunPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _webviewReady = false;
  private _disposables: vscode.Disposable[] = [];

  private _runningChild:
    | { runId: string; reportFolderPath: string; child: ReturnType<typeof spawn> }
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
        initStage: "runner" | "pull" | "linters" | null;
      }
    | undefined;

  private _runnerVersionsCache: RunnerVersionsCache | null = null;
  private _flavorEnumCache: string[] | null = null;
  private _engineStatusCache:
    | {
        timestamp: number;
        statuses: Record<Engine, EngineStatus>;
      }
    | null = null;

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
              await this._runMegalinter(message.engine, message.flavor, message.runnerVersion);
              break;
            case "cancelRun":
              await this._cancelRun();
              break;
            case "showOutput":
              showMegaLinterOutput(false);
              break;
            case "openFile":
              await this._openFile(message.filePath);
              break;
            case "openExternal":
              await openExternalHttpUrl(message.url);
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

    const runnerPromise = Promise.resolve().then(async () => {
      const t0 = Date.now();
      const cached =
        this._runnerVersionsCache &&
        Date.now() - this._runnerVersionsCache.timestamp < RUNNER_VERSIONS_CACHE_TTL_MS;
      const v = await this._getRunnerVersions();
      logMegaLinter(
        `Run view: init versions in ${Date.now() - t0}ms` +
          (cached ? " (cached)" : "") +
          ` | count=${v.versions.length}`,
      );
      return v;
    });

    const enginesPromise = Promise.resolve().then(async () => {
      const t0 = Date.now();
      const cached =
        !force &&
        this._engineStatusCache &&
        Date.now() - this._engineStatusCache.timestamp < ENGINE_STATUS_CACHE_TTL_MS;
      const v = await this._detectEngines(force);
      logMegaLinter(
        `Run view: init engines in ${Date.now() - t0}ms` + (cached ? " (cached)" : ""),
      );
      return v;
    });

    const [flavors, runnerInfo, engineStatuses] = await Promise.all([
      flavorsPromise,
      runnerPromise,
      enginesPromise,
    ]);

    const { versions, latest } = runnerInfo;

    const defaultEngine: Engine | undefined =
      engineStatuses.docker.running
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
      runnerVersions: versions,
      latestRunnerVersion: latest || undefined,
      engines: engineStatuses,
      defaultEngine,
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

    if (!Array.isArray(enumValues)) {
      this._flavorEnumCache = ["all"];
      return this._flavorEnumCache;
    }

    this._flavorEnumCache = enumValues.filter((v: unknown) => typeof v === "string");
    return this._flavorEnumCache;
  }

  private async _getRunnerVersions(): Promise<{ versions: string[]; latest: string | null }> {
    const now = Date.now();
    if (
      this._runnerVersionsCache &&
      now - this._runnerVersionsCache.timestamp < RUNNER_VERSIONS_CACHE_TTL_MS
    ) {
      const ageMs = now - this._runnerVersionsCache.timestamp;
      logMegaLinter(
        `Run view: versions cache hit | age=${ageMs}ms size=${this._runnerVersionsCache.versions.length}`,
      );
      return {
        versions: this._runnerVersionsCache.versions,
        latest: this._runnerVersionsCache.latest,
      };
    }

    let versions: string[] = [];
    let latest: string | null = "latest";

    const fetchStart = Date.now();
    try {
      logMegaLinter("Run view: fetching MegaLinter versions from GitHub releases…");
      const tags = await fetchMegalinterGithubReleaseTags();
      logMegaLinter(
        `Run view: GitHub releases fetched in ${Date.now() - fetchStart}ms | tags=${tags.length}`,
      );
      const normalized = tags
        .map(normalizeReleaseTag)
        .filter((v): v is string => !!v)
        .filter((v) => isAtLeastSemver(v, "9.0.0"))
        .sort(compareSemverDesc)
        .slice(0, 10);

      versions = ["latest", "beta", ...normalized];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logMegaLinter(
        `Run view: GitHub releases fetch failed in ${Date.now() - fetchStart}ms | ${msg}`,
      );
      // If GitHub is unreachable (offline, rate limited, etc.), show only channels.
      versions = ["latest", "beta"];
    }

    if (versions.length === 0) {
      versions = ["latest", "beta"];
    }

    versions = Array.from(new Set(versions));

    logMegaLinter(`Run view: versions resolved (${versions.length}) [${versions.join(", ")}]`);

    this._runnerVersionsCache = {
      timestamp: now,
      versions,
      latest,
    };

    return { versions, latest };
  }

  private async _detectEngines(force?: boolean): Promise<Record<Engine, EngineStatus>> {
    const now = Date.now();
    if (
      !force &&
      this._engineStatusCache &&
      now - this._engineStatusCache.timestamp < ENGINE_STATUS_CACHE_TTL_MS
    ) {
      const ageMs = now - this._engineStatusCache.timestamp;
      logMegaLinter(`Run view: using cached engine status | age=${ageMs}ms`);
      return this._engineStatusCache.statuses;
    }

    const dockerPromise = (async () => {
      const t0 = Date.now();
      const v = await detectEngine("docker");
      logMegaLinter(`Run view: detect docker in ${Date.now() - t0}ms`);
      return v;
    })();

    const podmanPromise = (async () => {
      const t0 = Date.now();
      const v = await detectEngine("podman");
      logMegaLinter(`Run view: detect podman in ${Date.now() - t0}ms`);
      return v;
    })();

    const [docker, podman] = await Promise.all([dockerPromise, podmanPromise]);
    const statuses: Record<Engine, EngineStatus> = { docker, podman };
    this._engineStatusCache = { timestamp: now, statuses };

    logMegaLinter(
      `Run view: engine status | ` +
        `docker=${docker.available ? (docker.running ? "available" : "not started") : "not installed"} ` +
        `podman=${podman.available ? (podman.running ? "available" : "not started") : "not installed"}`,
    );
    return statuses;
  }

  private async _runMegalinter(engine: Engine, flavor: string, runnerVersion: string) {
    if (this._runningChild) {
      throw new Error("MegaLinter is already running");
    }

    // Ensure any previous webhook server is stopped before starting a new run.
    this._stopWebhookServer();

    const workspaceRoot = this._getWorkspaceRoot();

    const engineStatuses = await this._detectEngines(true);
    const selectedStatus = engineStatuses[engine];
    if (!selectedStatus.available) {
      throw new Error(
        `${engine} is not available. Please install it and try again.`,
      );
    }
    if (!selectedStatus.running) {
      throw new Error(
        `${engine} is installed but does not appear to be running. Please start the daemon and try again.`,
      );
    }

    const safeFlavor = /^[a-z0-9_\-]+$/i.test(flavor) ? flavor : "all";
    const safeRelease =
      runnerVersion === "latest" || runnerVersion === "beta" || isValidSemver(runnerVersion)
        ? runnerVersion
        : "latest";
    const runnerPackageVersion = "latest";

    const runId = createRunId();
    const runFolderName = `${formatRunFolderTimestamp(new Date())}_${safeFlavor}`;

    const reportFolderPath = path.join(workspaceRoot, "megalinter-reports", runFolderName);
    fs.mkdirSync(reportFolderPath, { recursive: true });

    const reportFolderRel = `megalinter-reports/${runFolderName}`;

    const webhook = await this._startWebhookServer({ runId, engine, reportFolderPath });
    const { webhookUrl, webhookToken } = webhook;

    // On Windows, spawning a .cmd directly with shell:false frequently fails with spawn EINVAL.
    // Use the shell so VS Code/Node can resolve npx.cmd correctly.
    const npxCmd = "npx";
    const args = [
      "--yes",
      `mega-linter-runner@${runnerPackageVersion}`,
      "--flavor",
      safeFlavor,
      "--container-engine",
      engine,
      "--release",
      safeRelease,
      "--path",
      workspaceRoot,
      "--remove-container",
      "-e",
      `REPORT_OUTPUT_FOLDER=${reportFolderRel}`,
      "-e",
      "WEBHOOK_REPORTER=true",
      "-e",
      `WEBHOOK_REPORTER_URL=${webhookUrl}`,
      "-e",
      `WEBHOOK_REPORTER_BEARER_TOKEN=${webhookToken}`,
    ];

    const commandLine = formatCommandLine(npxCmd, redactArgs(args));

    logMegaLinter(
      `Run ${runId}: starting | engine=${engine} flavor=${safeFlavor} runnerPackage=${runnerPackageVersion} release=${safeRelease}`,
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

    logMegaLinter(
      `Run ${runId}: spawn | platform=${process.platform} node=${process.version} cwd=${workspaceRoot}`,
    );

    const child = spawn(npxCmd, args, {
      cwd: workspaceRoot,
      env: {
        ...process.env,
      },
      shell: process.platform === "win32",
      windowsHide: true,
    });

    this._runningChild = { runId, reportFolderPath, child };

    const forward = (chunk: Buffer) => {
      // Mirror process output to VS Code Output panel.
      const text = chunk.toString("utf8");
      appendMegaLinterOutput(text);
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

    const { runId, reportFolderPath, child } = this._runningChild;
    try {
      child.kill();
    } catch {
      // ignore
    }

    this._runningChild = undefined;

    this._stopWebhookServer();

    this._postMessage({
      type: "runStatus",
      status: "idle",
      runId,
      reportFolderPath,
      reportFolderRel: "",
    });
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

    if (messageType === "megalinterStart" && Array.isArray(payload?.linters)) {
      for (const l of payload.linters) {
        this._upsertLinterFromWebhook(ctx, l, "PENDING");
      }
      this._setInitStage("linters", ctx.runId);
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

    const status: RunResult["status"] = statusOverride ?? existing?.status ?? "UNKNOWN";

    const inferredLogPath = path.join(ctx.reportFolderPath, "linters_logs", `${keyRaw}-${status}.log`);
    const logFilePath = fs.existsSync(inferredLogPath) ? inferredLogPath : existing?.logFilePath;

    const next: RunResult = {
      key: keyRaw,
      descriptor: existing?.descriptor || descriptorId || (keyRaw.includes("_") ? keyRaw.split("_")[0] : keyRaw),
      linter: existing?.linter || linterId || (keyRaw.includes("_") ? keyRaw.substring(keyRaw.indexOf("_") + 1) : keyRaw),
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

    if (lowered.includes("[megalinter init] one-shot run")) {
      this._setInitStage("linters", runId);
      return;
    }

    if (lowered.includes("mega-linter-runner") || lowered.includes("initializing")) {
      this._setInitStage("runner", runId);
    }
  }

  private _setInitStage(stage: "runner" | "pull" | "linters", runId: string) {
    if (!this._webhook || this._webhook.runId !== runId) {
      return;
    }

    const current = this._webhook.initStage;
    const order: Record<typeof stage, number> = { runner: 0, pull: 1, linters: 2 };
    if (current && order[current] >= order[stage]) {
      return;
    }

    this._webhook.initStage = stage;
    this._postMessage({ type: "runInitStatus", runId, stage });
  }

  private async _openFile(filePath: string) {
    const uri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: true });
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

function formatCommandLine(command: string, args: string[]): string {
  return [command, ...args.map(quoteArgForShell)].join(" ");
}

function redactArgs(args: string[]): string[] {
  return args.map((a) => {
    if (typeof a !== "string") {
      return a;
    }
    if (a.startsWith("WEBHOOK_REPORTER_BEARER_TOKEN=")) {
      return "WEBHOOK_REPORTER_BEARER_TOKEN=***";
    }
    return a;
  });
}

async function logWhereNpxDiagnostics(): Promise<void> {
  try {
    const comspec = process.env.COMSPEC || "cmd.exe";
    const child = spawn(comspec, ["/d", "/s", "/c", "where", "npx"], {
      shell: false,
      windowsHide: true,
    });

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

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatRunFolderTimestamp(d: Date): string {
  // YYYYMMDD-HHMMSS
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(
    d.getHours(),
  )}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
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

async function detectEngine(engine: Engine): Promise<EngineStatus> {
  const cmd = process.platform === "win32" ? `${engine}.exe` : engine;

  try {
    const ok = await execWithTimeout(cmd, ["info"], 10000);
    return { available: true, running: ok, details: ok ? "running" : "not running" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // If executable is missing, mark unavailable
    if (/ENOENT/i.test(msg) || /not found/i.test(msg)) {
      return { available: false, running: false, details: "not installed" };
    }

    // Executable exists but info failed -> treat as installed but not running
    return { available: true, running: false, details: "not running" };
  }
}

function execWithTimeout(command: string, args: string[], timeoutMs: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
    });

    let settled = false;

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
      resolve(false);
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      if (settled) {
        return;
      }
      settled = true;
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) {
        return;
      }
      settled = true;
      resolve(code === 0);
    });
  });
}

function fetchMegalinterGithubReleaseTags(): Promise<string[]> {
  // Use the GitHub API to list releases. Unauthenticated access is rate limited.
  // If unreachable, caller falls back to "latest".
  const url = "https://api.github.com/repos/oxsecurity/megalinter/releases?per_page=10";

  return axios
    .get(url, {
      headers: {
        "User-Agent": "vscode-megalinter",
        Accept: "application/vnd.github+json",
      },
      timeout: 8000,
    })
    .then((response) => {
      const json = response.data as any;
      if (!Array.isArray(json)) {
        return [];
      }

      const tags = json
        .map((r: any) => (typeof r?.tag_name === "string" ? r.tag_name : null))
        .filter((t: any): t is string => typeof t === "string");
      return tags;
    });
}

function normalizeReleaseTag(tag: string): string | null {
  const trimmed = String(tag || "").trim();
  const withoutV = trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
  // Only keep semver-ish tags; ignore other release naming.
  return /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(withoutV) ? withoutV : null;
}

function compareSemverDesc(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);

  // Unknown versions go last
  if (!pa && !pb) {
    return b.localeCompare(a);
  }
  if (!pa) {
    return 1;
  }
  if (!pb) {
    return -1;
  }

  if (pa.major !== pb.major) {
    return pb.major - pa.major;
  }
  if (pa.minor !== pb.minor) {
    return pb.minor - pa.minor;
  }
  if (pa.patch !== pb.patch) {
    return pb.patch - pa.patch;
  }

  // Stable releases should come before prereleases
  if (pa.prerelease && !pb.prerelease) {
    return 1;
  }
  if (!pa.prerelease && pb.prerelease) {
    return -1;
  }

  return (pb.prerelease || "").localeCompare(pa.prerelease || "");
}

function parseSemver(v: string):
  | { major: number; minor: number; patch: number; prerelease?: string }
  | null {
  const m = /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z.-]+))?$/.exec(v);
  if (!m) {
    return null;
  }
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] || undefined,
  };
}

function isValidSemver(v: string): boolean {
  return parseSemver(v) !== null;
}

function isAtLeastSemver(v: string, min: string): boolean {
  const pv = parseSemver(v);
  const pm = parseSemver(min);
  if (!pv || !pm) {
    return false;
  }

  if (pv.major !== pm.major) {
    return pv.major > pm.major;
  }
  if (pv.minor !== pm.minor) {
    return pv.minor > pm.minor;
  }
  return pv.patch >= pm.patch;
}

