/* eslint-disable @typescript-eslint/naming-convention */
import React, { useEffect, useMemo, useState } from 'react';
import type { RJSFSchema } from '@rjsf/utils';
import bundledSchema from '../descriptors/schemas/megalinter-configuration.jsonschema.json';
import { extractGroups, filterRemovedLintersFromSchema } from '../shared/schemaUtils';
import { useVSCodeApi } from './hooks';
import './styles.css';

import type {
  FlavorDefinitionMessage,
  FlavorFolderSelectedMessage,
  FlavorContextMessage,
  PersistedState
} from './types';

type FlavorWebviewMessage = FlavorContextMessage | FlavorFolderSelectedMessage | FlavorDefinitionMessage | { type: 'info'; message: string } | { type: 'error'; message: string };

const CUSTOM_FLAVOR_DOC_URL = 'https://megalinter.io/latest/custom-flavors/';

export const FlavorApp: React.FC = () => {
  const { state: persistedState, updateState, postMessage } = useVSCodeApi();

  const initialFolder = persistedState?.flavorBuilder?.folderPath || '';
  const initialSelected = persistedState?.flavorBuilder?.selectedLinters || [];

  const [folderPath, setFolderPath] = useState<string>(initialFolder);
  const [selectedLinters, setSelectedLinters] = useState<string[]>(initialSelected);
  const [search, setSearch] = useState<string>('');
  const [flavorFilePath, setFlavorFilePath] = useState<string>('');
  const [flavorExists, setFlavorExists] = useState<boolean>(false);
  const [flavorContent, setFlavorContent] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const nextState: Partial<PersistedState> = {
      flavorBuilder: {
        folderPath,
        selectedLinters
      }
    };
    updateState(nextState);
  }, [folderPath, selectedLinters, updateState]);

  const allLinters = useMemo(() => {
    const schema = filterRemovedLintersFromSchema(bundledSchema as RJSFSchema);
    const groups = extractGroups(schema);
    const linterIds = Object.values(groups.linterKeys)
      .flatMap((linters) => Object.keys(linters || {}))
      .filter(Boolean);
    return Array.from(new Set(linterIds)).sort((a, b) => a.localeCompare(b));
  }, []);

  const filteredLinters = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) {
      return allLinters;
    }
    return allLinters.filter((l) => l.includes(q));
  }, [allLinters, search]);

  const selectedSet = useMemo(() => new Set(selectedLinters), [selectedLinters]);

  const toggleLinter = (id: string) => {
    setSelectedLinters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return Array.from(next).sort((a, b) => a.localeCompare(b));
    });
  };

  const selectAllFiltered = () => {
    setSelectedLinters((prev) => {
      const next = new Set(prev);
      filteredLinters.forEach((id) => next.add(id));
      return Array.from(next).sort((a, b) => a.localeCompare(b));
    });
  };

  const clearSelection = () => setSelectedLinters([]);

  const pickFolder = () => {
    setError('');
    setStatus('');
    postMessage({ type: 'pickFlavorFolder' });
  };

  const refreshDefinition = () => {
    if (!folderPath) {
      return;
    }
    postMessage({ type: 'loadFlavorDefinition', folderPath });
  };

  const runGenerator = () => {
    if (!folderPath) {
      setError('Select a repository folder first.');
      return;
    }
    setError('');
    setStatus('Starting MegaLinter custom flavor generator in a terminal...');
    postMessage({
      type: 'runCustomFlavorSetup',
      folderPath,
      linters: selectedLinters.length ? selectedLinters : undefined
    });
  };

  const openFlavorFile = () => {
    if (!flavorFilePath) {
      return;
    }
    postMessage({ type: 'openFile', filePath: flavorFilePath });
  };

  useEffect(() => {
    postMessage({ type: 'ready' });
    postMessage({ type: 'getFlavorContext' });

    const handler = (event: MessageEvent) => {
      const message = event.data as FlavorWebviewMessage;

      if (message.type === 'flavorFolderSelected') {
        setFolderPath(message.folderPath);
        setStatus(`Selected folder: ${message.folderPath}`);
        setError('');
        return;
      }

      if (message.type === 'flavorDefinition') {
        setFlavorFilePath(message.filePath);
        setFlavorExists(message.exists);
        setFlavorContent(message.content || '');
        if (message.exists) {
          setStatus('Loaded mega-linter-flavor.yml');
        } else {
          setStatus('mega-linter-flavor.yml not found yet (run generator first).');
        }
        return;
      }

      if (message.type === 'info') {
        setStatus(message.message);
        return;
      }

      if (message.type === 'error') {
        setError(message.message);
        return;
      }

      if (message.type === 'flavorContext') {
        // Currently unused (placeholder for future enhancements like opening the workspace root)
        return;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [postMessage]);

  useEffect(() => {
    if (folderPath) {
      refreshDefinition();
    }
  }, [folderPath]);

  const commandPreview = selectedLinters.length
    ? `npx --yes mega-linter-runner@beta --custom-flavor-setup --custom-flavor-linters "${selectedLinters.join(',')}"`
    : 'npx --yes mega-linter-runner@beta --custom-flavor-setup';

  return (
    <div className="container">
      <div className="page">
        <header className="page__header">
          <div>
            <p className="eyebrow">MegaLinter</p>
            <h1 className="page__title">Custom Flavor Builder</h1>
            <p className="muted">
              Visually pick linters and generate a custom flavor using the official generator.
              <br />
              <a className="linter-description__link" href={CUSTOM_FLAVOR_DOC_URL} target="_blank" rel="noreferrer">
                Documentation: {CUSTOM_FLAVOR_DOC_URL}
              </a>
            </p>
          </div>
          <div className="home__actions">
            <button className="pill-button pill-button--solid" onClick={pickFolder}>
              Select folder
            </button>
            <button className="pill-button pill-button--primary" onClick={runGenerator}>
              Run generator
            </button>
          </div>
        </header>

        <div className="home__grid">
          <div className="home__card">
            <p className="home__card-label">Repository folder</p>
            <p className="home__card-note">{folderPath || 'No folder selected yet.'}</p>
            <div className="home__actions" style={{ marginTop: 10 }}>
              <button className="pill-button pill-button--ghost" onClick={refreshDefinition} disabled={!folderPath}>
                Refresh mega-linter-flavor.yml
              </button>
              <button className="pill-button pill-button--ghost" onClick={openFlavorFile} disabled={!flavorExists}>
                Open mega-linter-flavor.yml
              </button>
            </div>
          </div>

          <div className="home__card">
            <p className="home__card-label">Command preview</p>
            <p className="home__card-note">{commandPreview}</p>
            <p className="muted" style={{ marginTop: 8 }}>
              If no linters are selected, the generator will prompt interactively in the terminal.
            </p>
          </div>
        </div>

        {(status || error) && (
          <div className="home__card" style={{ borderColor: error ? 'var(--vscode-errorForeground)' : undefined }}>
            {status && <p className="home__card-note">{status}</p>}
            {error && <p className="home__card-note" style={{ color: 'var(--vscode-errorForeground)' }}>{error}</p>}
          </div>
        )}

        <div className="home__grid">
          <div className="home__card">
            <p className="home__card-label">Linters</p>
            <div className="home__search-container">
              <input
                className="home__search-input"
                placeholder="Search linters (e.g. PYTHON_RUFF, REPOSITORY_TRIVY)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="home__actions" style={{ marginTop: 10 }}>
              <button className="pill-button pill-button--ghost" onClick={selectAllFiltered} disabled={!filteredLinters.length}>
                Select all filtered
              </button>
              <button className="pill-button pill-button--ghost" onClick={clearSelection} disabled={!selectedLinters.length}>
                Clear
              </button>
              <span className="pill-chip pill-chip--muted">Selected: {selectedLinters.length}</span>
            </div>

            <div style={{ marginTop: 12, maxHeight: 320, overflow: 'auto', border: '1px solid var(--vscode-panel-border)', borderRadius: 8 }}>
              {filteredLinters.map((id) => {
                const checked = selectedSet.has(id);
                return (
                  <label
                    key={id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                      borderBottom: '1px solid var(--vscode-panel-border)'
                    }}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleLinter(id)} />
                    <span style={{ fontWeight: 600 }}>{id}</span>
                  </label>
                );
              })}
              {!filteredLinters.length && <p className="muted" style={{ padding: 10 }}>No matching linters.</p>}
            </div>
          </div>

          <div className="home__card">
            <p className="home__card-label">mega-linter-flavor.yml preview</p>
            {!flavorExists ? (
              <p className="muted">Run the generator to create this file.</p>
            ) : (
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  borderRadius: 8,
                  border: '1px solid var(--vscode-panel-border)',
                  background: 'var(--vscode-editor-inactiveSelectionBackground)',
                  maxHeight: 420,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap'
                }}
              >
                {flavorContent}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
