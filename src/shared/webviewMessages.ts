// Shared message types between extension host and webview.

export type ReadyMessage = { type: "ready" };

export type OpenExternalMessage = { type: "openExternal"; url: string };

export type OpenFileMessage = { type: "openFile"; filePath: string };

export type CommonWebviewToExtensionMessage =
  | ReadyMessage
  | OpenExternalMessage
  | OpenFileMessage;

// --- Custom Flavor Builder (Webview -> Extension) ---

export type FlavorWebviewToExtensionMessage =
  | { type: "getFlavorContext" }
  | { type: "pickFlavorFolder" }
  | { type: "runCustomFlavorSetup"; folderPath: string; linters?: string[] }
  | { type: "loadFlavorDefinition"; folderPath: string };

export type FlavorPanelInboundMessage =
  | CommonWebviewToExtensionMessage
  | FlavorWebviewToExtensionMessage;

// --- Custom Flavor Builder (Extension -> Webview) ---

export type FlavorContextMessage = {
  type: "flavorContext";
  workspaceFolders: Array<{ name: string; path: string }>;
  defaultFolderPath?: string;
  isWorkspaceFlavorRepo?: boolean;
};

export type FlavorFolderSelectedMessage = {
  type: "flavorFolderSelected";
  folderPath: string;
};

export type FlavorDefinitionMessage = {
  type: "flavorDefinition";
  folderPath: string;
  exists: boolean;
  filePath: string;
  content?: string;
};

export type InfoMessage = { type: "info"; message: string };

export type ErrorMessage = { type: "error"; message: string };

// --- MegaLinter Run (Webview -> Extension) ---

export type ConfigNavigationTarget =
  | { type: "descriptor"; descriptorId: string }
  | { type: "linter"; descriptorId: string; linterId: string };

export type RunPreferences = {
  engine?: "docker" | "podman";
  flavor?: string;
  runnerVersion?: string;
  parallelCores?: number;
  applyFixes?: boolean;
};

export type RunRecommendation = {
  extensionId: string;
  installed: boolean;
  label: string;
  author: string;
};

export type RunWebviewToExtensionMessage =
  | { type: "getRunContext"; force?: boolean }
  | {
      type: "runMegalinter";
      engine: "docker" | "podman";
      flavor: string;
      runnerVersion: string;
      parallelCores: number;
      applyFixes: boolean;
    }
  | { type: "cancelRun" }
  | { type: "openConfigSection"; target: ConfigNavigationTarget }
  | { type: "revealPath"; path: string }
  | { type: "showOutput" }
  | { type: "updateRunSetting"; key: "engine" | "flavor" | "version" | "parallelCores" | "recommendVsCodeExtensions" | "applyFixes"; value: string }
  | { type: "openExtension"; extensionId: string }
  | InfoMessage;

export type RunPanelInboundMessage =
  | CommonWebviewToExtensionMessage
  | RunWebviewToExtensionMessage
  | InfoMessage
  | { type: "error"; message: string };

// --- MegaLinter Run (Extension -> Webview) ---

export type RunEngineStatus = {
  available: boolean;
  running: boolean;
  details?: string;
};

export type RunResult = {
  key: string;
  descriptor: string;
  linter: string;
  linterVersion?: string;
  status: "SUCCESS" | "WARNING" | "ERROR" | "RUNNING" | "PENDING" | "UNKNOWN";
  logFilePath?: string;
  files?: number;
  elapsedSeconds?: number;
  errors?: number;
  warnings?: number;
};

export type RunContextMessage = {
  type: "runContext";
  workspaceRoot: string;
  flavors: string[];
  linters: string[];
  runnerVersions: string[];
  latestRunnerVersion?: string;
  maxParallelCores: number;
  engines: {
    docker: RunEngineStatus;
    podman: RunEngineStatus;
  };
  defaultEngine?: "docker" | "podman";
  runPreferences?: RunPreferences;
};

export type RunStatusMessage = {
  type: "runStatus";
  status: "idle" | "running" | "completed" | "error";
  runId: string;
  reportFolderPath: string;
  reportFolderRel: string;
  containerImage?: string;
};

export type RunOutputMessage = {
  type: "runOutput";
  runId: string;
  chunk: string;
};

export type RunResultsMessage = {
  type: "runResults";
  runId: string;
  reportFolderPath: string;
  results: RunResult[];
  exitCode: number | null;
};

export type RunRecommendationsMessage = {
  type: "runRecommendations";
  runId: string;
  recommendations: RunRecommendation[];
};

export type RunInitStatusMessage = {
  type: "runInitStatus";
  runId: string;
  stage:
    | "runner"
    | "pull"
    | "startImage"
    | "analyzeConfig"
    | "preCommands"
    | "activation"
    | "collectFiles";
  containerImage?: string;
};

export type RunErrorMessage = { type: "runError"; message: string; commandLine?: string };

export type RunPanelOutboundMessage =
  | RunContextMessage
  | RunStatusMessage
  | RunOutputMessage
  | RunResultsMessage
  | RunInitStatusMessage
  | RunRecommendationsMessage
  | RunErrorMessage;

export type FlavorPanelOutboundMessage =
  | FlavorContextMessage
  | FlavorFolderSelectedMessage
  | FlavorDefinitionMessage
  | InfoMessage
  | ErrorMessage;
