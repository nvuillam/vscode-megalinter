import * as vscode from "vscode";

const SEMVER_REGEX = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const DEFAULT_RUNNER_VERSION = "latest";

export function getConfiguredRunnerVersion(): string {
  const config = vscode.workspace.getConfiguration("megalinter");
  const raw = config.get<string>("megaLinterRunnerVersion");
  return normalizeRunnerVersion(raw);
}

function normalizeRunnerVersion(raw: unknown): string {
  if (typeof raw !== "string") {
    return DEFAULT_RUNNER_VERSION;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return DEFAULT_RUNNER_VERSION;
  }

  const lowered = trimmed.toLowerCase();
  if (lowered === "latest" || lowered === "beta" || lowered === "alpha") {
    return lowered;
  }

  if (SEMVER_REGEX.test(trimmed)) {
    return trimmed;
  }

  return DEFAULT_RUNNER_VERSION;
}
