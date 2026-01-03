import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigurationPanel } from './configurationPanel';

export type NavigationTarget =
  | { type: 'general' }
  | { type: 'descriptor'; descriptorId: string }
  | { type: 'linter'; descriptorId: string; linterId: string };

export function activate(context: vscode.ExtensionContext) {
  console.log('MegaLinter Configuration extension is now active');

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.text = '$(tools) MegaLinter';
  statusBarItem.command = 'megalinter.openConfiguration';
  statusBarItem.tooltip = 'Open MegaLinter configuration';
  statusBarItem.show();

  context.subscriptions.push(statusBarItem);

  // Register the command to open the configuration
  let disposable = vscode.commands.registerCommand(
    'megalinter.openConfiguration',
    async (uri?: vscode.Uri) => {
      const configPath = await resolveConfigPath(uri);

      if (!configPath) {
        vscode.window.showErrorMessage(
          'Please open a workspace folder to configure MegaLinter'
        );
        return;
      }

      ConfigurationPanel.createOrShow(context.extensionUri, configPath);
    }
  );

  const revealSection = vscode.commands.registerCommand(
    'megalinter.revealSection',
    async (target: NavigationTarget, uri?: vscode.Uri) => {
      const configPath = await resolveConfigPath(uri);

      if (!configPath) {
        vscode.window.showErrorMessage(
          'Please open a workspace folder to configure MegaLinter'
        );
        return;
      }

      const panel = ConfigurationPanel.createOrShow(context.extensionUri, configPath);
      panel.revealSection(target);
    }
  );

  context.subscriptions.push(disposable, revealSection);
}

export function deactivate() {}

async function resolveConfigPath(uri?: vscode.Uri): Promise<string | undefined> {
  let configPath: string | undefined;

  if (uri) {
    configPath = uri.fsPath;
  } else {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const possiblePaths = [
        path.join(workspaceFolders[0].uri.fsPath, '.mega-linter.yml'),
        path.join(workspaceFolders[0].uri.fsPath, '.megalinter.yml')
      ];

      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          configPath = p;
          break;
        }
      }

      if (!configPath) {
        configPath = path.join(workspaceFolders[0].uri.fsPath, '.mega-linter.yml');
      }
    }
  }

  return configPath;
}
