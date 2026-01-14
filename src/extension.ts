import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  disposeMegaLinterOutputChannel,
  getMegaLinterOutputChannel,
} from "./outputChannel";

export type NavigationTarget =
  | { type: "general" }
  | { type: "category"; categoryId: string }
  | { type: "descriptor"; descriptorId: string }
  | { type: "linter"; descriptorId: string; linterId: string };

export function activate(context: vscode.ExtensionContext) {
  console.log("MegaLinter Configuration extension is now active");

  // Register shared output channel lifecycle (dispose on deactivation).
  getMegaLinterOutputChannel();
  context.subscriptions.push(
    new vscode.Disposable(() => {
      disposeMegaLinterOutputChannel();
    }),
  );

  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.text = "$(tools) MegaLinter";
  statusBarItem.command = "megalinter.openConfiguration";
  statusBarItem.tooltip = "Open MegaLinter configuration";
  statusBarItem.show();

  context.subscriptions.push(statusBarItem);

  const customFlavorStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    99,
  );
  customFlavorStatusBarItem.text = "$(package) MegaLinter Custom Flavor";
  customFlavorStatusBarItem.command = "megalinter.openCustomFlavorBuilder";
  customFlavorStatusBarItem.tooltip = "Open MegaLinter Custom Flavor Builder";

  const updateCustomFlavorStatusVisibility = () => {
    if (hasCustomFlavorFileInWorkspaceRoot()) {
      customFlavorStatusBarItem.show();
    } else {
      customFlavorStatusBarItem.hide();
    }
  };

  updateCustomFlavorStatusVisibility();

  const watcher = vscode.workspace.createFileSystemWatcher(
    "**/{mega-linter-flavor.yml,mega-linter-flavor.yaml,megalinter-custom-flavor.yml,megalinter-custom-flavor.yaml}",
  );
  watcher.onDidCreate(updateCustomFlavorStatusVisibility);
  watcher.onDidDelete(updateCustomFlavorStatusVisibility);
  watcher.onDidChange(updateCustomFlavorStatusVisibility);

  context.subscriptions.push(watcher);

  context.subscriptions.push(customFlavorStatusBarItem);

  // Register the command to open the configuration
  let disposable = vscode.commands.registerCommand(
    "megalinter.openConfiguration",
    async (uri?: vscode.Uri) => {
      const configPath = await resolveConfigPath(uri);

      if (!configPath) {
        vscode.window.showErrorMessage(
          "Please open a workspace folder to configure MegaLinter",
        );
        return;
      }

      const { ConfigurationPanel } = await import("./configurationPanel");
      ConfigurationPanel.createOrShow(
        context.extensionUri,
        context,
        configPath,
      );
    },
  );

  const openCustomFlavorBuilder = vscode.commands.registerCommand(
    "megalinter.openCustomFlavorBuilder",
    async (uri?: vscode.Uri) => {
      const { CustomFlavorPanel } = await import("./customFlavorPanel");
      CustomFlavorPanel.createOrShow(context.extensionUri, uri);
    },
  );

  const openRunPanel = vscode.commands.registerCommand(
    "megalinter.openRun",
    async () => {
      const { RunPanel } = await import("./runPanel");
      RunPanel.createOrShow(context.extensionUri);
    },
  );

  const revealSection = vscode.commands.registerCommand(
    "megalinter.revealSection",
    async (target: NavigationTarget, uri?: vscode.Uri) => {
      const configPath = await resolveConfigPath(uri);

      if (!configPath) {
        vscode.window.showErrorMessage(
          "Please open a workspace folder to configure MegaLinter",
        );
        return;
      }

      const { ConfigurationPanel } = await import("./configurationPanel");
      const panel = ConfigurationPanel.createOrShow(
        context.extensionUri,
        context,
        configPath,
      );
      panel.revealSection(target);
    },
  );

  context.subscriptions.push(
    disposable,
    revealSection,
    openCustomFlavorBuilder,
    openRunPanel,
  );
}

export function deactivate() {}

function hasCustomFlavorFileInWorkspaceRoot(): boolean {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return false;
  }

  const candidateNames = [
    "megalinter-custom-flavor.yml",
    "megalinter-custom-flavor.yaml",
    "mega-linter-flavor.yml",
    "mega-linter-flavor.yaml",
  ];

  return workspaceFolders.some((folder) => {
    return candidateNames.some((name) =>
      fs.existsSync(path.join(folder.uri.fsPath, name)),
    );
  });
}

async function resolveConfigPath(
  uri?: vscode.Uri,
): Promise<string | undefined> {
  let configPath: string | undefined;

  if (uri) {
    configPath = uri.fsPath;
  } else {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const possiblePaths = [
        path.join(workspaceFolders[0].uri.fsPath, ".mega-linter.yml"),
        path.join(workspaceFolders[0].uri.fsPath, ".megalinter.yml"),
      ];

      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          configPath = p;
          break;
        }
      }

      if (!configPath) {
        configPath = path.join(
          workspaceFolders[0].uri.fsPath,
          ".mega-linter.yml",
        );
      }
    }
  }

  return configPath;
}
