import { useCallback, useState } from "react";
import type { VSCodeAPI, PersistedState, ExtensionMessage } from "../types";

const vscode = window.acquireVsCodeApi();

export const useVSCodeApi = () => {
  const [state, setState] = useState<PersistedState | undefined>(
    vscode.getState(),
  );

  const updateState = useCallback((newState: Partial<PersistedState>) => {
    setState((prev) => {
      const updated = { ...(prev || {}), ...newState } as PersistedState;
      vscode.setState(updated);
      return updated;
    });
  }, []);

  const postMessage = useCallback((message: ExtensionMessage) => {
    vscode.postMessage(message);
  }, []);

  return {
    state,
    updateState,
    postMessage,
  };
};
