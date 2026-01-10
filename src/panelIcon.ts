import * as vscode from 'vscode';
import * as fs from 'fs';

export type PanelIconPath = vscode.Uri | { light: vscode.Uri; dark: vscode.Uri };

function exists(extensionUri: vscode.Uri, relativePath: string): boolean {
  return fs.existsSync(vscode.Uri.joinPath(extensionUri, relativePath).fsPath);
}

/**
 * Picks a tab icon for MegaLinter webviews.
 *
 * If you add Ox Security logo files to `media/`, they will be preferred:
 * - media/ox-security-light.svg + media/ox-security-dark.svg (best)
 * - media/ox-security.svg
 * - media/ox-security.png
 *
 * Falls back to `media/megalinter.svg`.
 */
export function resolveMegalinterPanelIcon(extensionUri: vscode.Uri): PanelIconPath | undefined {
  const oxLight = 'media/ox-security-light.svg';
  const oxDark = 'media/ox-security-dark.svg';
  if (exists(extensionUri, oxLight) && exists(extensionUri, oxDark)) {
    return {
      light: vscode.Uri.joinPath(extensionUri, oxLight),
      dark: vscode.Uri.joinPath(extensionUri, oxDark)
    };
  }

  const oxSvg = 'media/ox-security.svg';
  if (exists(extensionUri, oxSvg)) {
    return vscode.Uri.joinPath(extensionUri, oxSvg);
  }

  const oxPng = 'media/ox-security.png';
  if (exists(extensionUri, oxPng)) {
    return vscode.Uri.joinPath(extensionUri, oxPng);
  }

  const fallback = 'media/megalinter.svg';
  if (exists(extensionUri, fallback)) {
    return vscode.Uri.joinPath(extensionUri, fallback);
  }

  return undefined;
}
