// Shared message types between extension host and webview.

export type ReadyMessage = { type: 'ready' };

export type OpenExternalMessage = { type: 'openExternal'; url: string };

export type OpenFileMessage = { type: 'openFile'; filePath: string };

export type CommonWebviewToExtensionMessage = ReadyMessage | OpenExternalMessage | OpenFileMessage;

// --- Custom Flavor Builder (Webview -> Extension) ---

export type FlavorWebviewToExtensionMessage =
  | { type: 'getFlavorContext' }
  | { type: 'pickFlavorFolder' }
  | { type: 'runCustomFlavorSetup'; folderPath: string; linters?: string[] }
  | { type: 'loadFlavorDefinition'; folderPath: string };

export type FlavorPanelInboundMessage = CommonWebviewToExtensionMessage | FlavorWebviewToExtensionMessage;

// --- Custom Flavor Builder (Extension -> Webview) ---

export type FlavorContextMessage = {
  type: 'flavorContext';
  workspaceFolders: Array<{ name: string; path: string }>;
  defaultFolderPath?: string;
  isWorkspaceFlavorRepo?: boolean;
};

export type FlavorFolderSelectedMessage = {
  type: 'flavorFolderSelected';
  folderPath: string;
};

export type FlavorDefinitionMessage = {
  type: 'flavorDefinition';
  folderPath: string;
  exists: boolean;
  filePath: string;
  content?: string;
};

export type InfoMessage = { type: 'info'; message: string };

export type ErrorMessage = { type: 'error'; message: string };

export type FlavorPanelOutboundMessage =
  | FlavorContextMessage
  | FlavorFolderSelectedMessage
  | FlavorDefinitionMessage
  | InfoMessage
  | ErrorMessage;
