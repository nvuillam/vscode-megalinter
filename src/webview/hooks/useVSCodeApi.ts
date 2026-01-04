import { useEffect, useState } from 'react';
import type { VSCodeAPI, PersistedState, ExtensionMessage } from '../types';

const vscode = window.acquireVsCodeApi();

export const useVSCodeApi = () => {
  const [state, setState] = useState<PersistedState | undefined>(vscode.getState());

  const updateState = (newState: Partial<PersistedState>) => {
    const updated = { ...state, ...newState } as PersistedState;
    vscode.setState(updated);
    setState(updated);
  };

  const postMessage = (message: ExtensionMessage) => {
    vscode.postMessage(message);
  };

  return {
    state,
    updateState,
    postMessage
  };
};
