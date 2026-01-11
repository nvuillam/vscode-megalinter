import * as vscode from 'vscode';
import { resolveMegalinterPanelIcon } from './panelIcon';

export const disposeAll = (disposables: vscode.Disposable[]) => {
  while (disposables.length) {
    const disposable = disposables.pop();
    if (disposable) {
      disposable.dispose();
    }
  }
};

export const openExternalHttpUrl = async (url: unknown): Promise<boolean> => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    await vscode.env.openExternal(vscode.Uri.parse(url));
    return true;
  }

  vscode.window.showErrorMessage('Invalid external URL');
  return false;
};

export const createMegalinterWebviewPanel = (args: {
  viewType: string;
  title: string;
  extensionUri: vscode.Uri;
  column: vscode.ViewColumn | undefined;
}): vscode.WebviewPanel => {
  const panel = vscode.window.createWebviewPanel(
    args.viewType,
    args.title,
    args.column || vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(args.extensionUri, 'dist')]
    }
  );

  const iconPath = resolveMegalinterPanelIcon(args.extensionUri);
  if (iconPath) {
    panel.iconPath = iconPath;
  }

  return panel;
};

export const getNonce = (): string => {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

export const buildWebviewHtml = (args: {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  title: string;
  view: 'config' | 'flavor';
}): string => {
  const scriptUri = args.webview.asWebviewUri(
    vscode.Uri.joinPath(args.extensionUri, 'dist', 'webview.js')
  );

  const nonce = getNonce();

  // Note: 'unsafe-inline' for styles is required because we use style-loader.
  // The script-src uses nonce for security.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${args.webview.cspSource} https: data:; style-src ${args.webview.cspSource} 'unsafe-inline'; font-src ${args.webview.cspSource}; script-src 'nonce-${nonce}' 'unsafe-eval';">
  <title>${args.title}</title>
  <style>
    body {
      padding: 0;
      margin: 0;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">window.__MEGALINTER_VIEW__ = '${args.view}';</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
};
