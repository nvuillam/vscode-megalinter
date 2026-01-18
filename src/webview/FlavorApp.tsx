/* eslint-disable @typescript-eslint/naming-convention */
import React, { useEffect, useMemo, useState } from 'react';
import '@vscode/codicons/dist/codicon.css';
import type { RJSFSchema } from '@rjsf/utils';
import * as YAML from 'yaml';
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
const DEFAULT_FLAVOR_FILE = 'megalinter-custom-flavor.yml';

function basename(filePath: string): string {
  if (!filePath) {
    return '';
  }
  const parts = filePath.split(/\\|\//g);
  return parts[parts.length - 1] || filePath;
}

function parseLintersFromFlavorYaml(content: string): string[] {
  try {
    const parsed = YAML.parse(content) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return [];
    }

    const linters = (parsed as any).linters;
    if (!Array.isArray(linters)) {
      return [];
    }

    const normalized = linters
      .filter((v: unknown): v is string => typeof v === 'string')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.toUpperCase());

    return Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export const FlavorApp: React.FC = () => {
  const { state: persistedState, updateState, postMessage } = useVSCodeApi();

  const initialFolder = persistedState?.flavorBuilder?.folderPath || '';
  const initialSelected = persistedState?.flavorBuilder?.selectedLinters || [];

  const [folderPath, setFolderPath] = useState<string>(initialFolder);
  const [selectedLinters, setSelectedLinters] = useState<string[]>(initialSelected);
  const [search, setSearch] = useState<string>('');
  const [flavorFilePath, setFlavorFilePath] = useState<string>('');
  const [flavorFileName, setFlavorFileName] = useState<string>(DEFAULT_FLAVOR_FILE);
  const [flavorExists, setFlavorExists] = useState<boolean>(false);
  const [flavorContent, setFlavorContent] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isWorkspaceFlavorRepo, setIsWorkspaceFlavorRepo] = useState<boolean>(false);

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
        setFlavorFileName(basename(message.filePath) || DEFAULT_FLAVOR_FILE);
        setFlavorExists(message.exists);
        setFlavorContent(message.content || '');
        if (message.exists) {
          const parsedLinters = parseLintersFromFlavorYaml(message.content || '');
          if (parsedLinters.length) {
            setSelectedLinters(parsedLinters);
          }
          setStatus(`Loaded ${basename(message.filePath) || DEFAULT_FLAVOR_FILE}`);
        } else {
          setStatus(`${basename(message.filePath) || DEFAULT_FLAVOR_FILE} not found yet (run generator first).`);
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
        setIsWorkspaceFlavorRepo(Boolean(message.isWorkspaceFlavorRepo));
        if (message.defaultFolderPath) {
          setFolderPath((current) => {
            if (message.isWorkspaceFlavorRepo) {
              return message.defaultFolderPath as string;
            }
            return current || (message.defaultFolderPath as string);
          });
          setStatus(`Selected folder: ${message.defaultFolderPath}`);
          setError('');
        }
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
    ? `npx --yes mega-linter-runner --custom-flavor-setup --custom-flavor-linters "${selectedLinters.join(',')}"`
    : 'npx --yes mega-linter-runner --custom-flavor-setup';

  const hasFolder = Boolean(folderPath);
  const controlsDisabled = !hasFolder;

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
            {!isWorkspaceFlavorRepo && (
              <button className="pill-button pill-button--solid" onClick={pickFolder}>
                Select Custom Flavor Repository
              </button>
            )}
            <button className="pill-button pill-button--primary" onClick={runGenerator} disabled={controlsDisabled}>
              Run generator
            </button>
          </div>
        </header>

        <div className="home__grid">
          <div className="home__card">
            <p className="home__card-label">Repository folder</p>
            <p className="home__card-note">{folderPath || 'No folder selected yet.'}</p>
            <div className="home__actions" style={{ marginTop: 10 }}>
              <button className="pill-button pill-button--ghost" onClick={refreshDefinition} disabled={controlsDisabled}>
                Refresh {flavorFileName}
              </button>
              <button className="pill-button pill-button--ghost" onClick={openFlavorFile} disabled={!flavorExists || controlsDisabled}>
                Open {flavorFileName}
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
                disabled={controlsDisabled}
              />
            </div>
            <div className="home__actions" style={{ marginTop: 10 }}>
              <button className="pill-button pill-button--ghost" onClick={selectAllFiltered} disabled={!filteredLinters.length || controlsDisabled}>
                Select all filtered
              </button>
              <button className="pill-button pill-button--ghost" onClick={clearSelection} disabled={!selectedLinters.length || controlsDisabled}>
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
                    <input type="checkbox" checked={checked} onChange={() => toggleLinter(id)} disabled={controlsDisabled} />
                    <span style={{ fontWeight: 600 }}>{id}</span>
                  </label>
                );
              })}
              {!filteredLinters.length && <p className="muted" style={{ padding: 10 }}>No matching linters.</p>}
            </div>
          </div>

          <div className="home__card">
            <p className="home__card-label">{flavorFileName} preview</p>
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
