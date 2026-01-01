import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigurationPanel } from './configurationPanel';

export function activate(context: vscode.ExtensionContext) {
  console.log('MegaLinter Configuration extension is now active');

  // Register the command to open the configuration
  let disposable = vscode.commands.registerCommand(
    'megalinter.openConfiguration',
    async (uri?: vscode.Uri) => {
      // If called from context menu, uri will be the file path
      let configPath: string | undefined;

      if (uri) {
        configPath = uri.fsPath;
      } else {
        // Try to find .mega-linter.yml in workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          const possiblePaths = [
            path.join(workspaceFolders[0].uri.fsPath, '.mega-linter.yml'),
            path.join(workspaceFolders[0].uri.fsPath, '.megalinter.yml'),
          ];

          for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
              configPath = p;
              break;
            }
          }

          // If no config file exists, create one in the workspace root
          if (!configPath) {
            configPath = path.join(workspaceFolders[0].uri.fsPath, '.mega-linter.yml');
          }
        }
      }

      if (!configPath) {
        vscode.window.showErrorMessage(
          'Please open a workspace folder to configure MegaLinter'
        );
        return;
      }

      ConfigurationPanel.createOrShow(context.extensionUri, configPath);
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
