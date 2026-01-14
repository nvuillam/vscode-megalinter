/* eslint-disable @typescript-eslint/naming-convention */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import '@vscode/codicons/dist/codicon.css';
import './styles.css';

import { useVSCodeApi } from './hooks';
import type {
  RunWebViewMessage,
  RunResult
} from './types';

type Engine = 'docker' | 'podman';

type EnginesState = {
  docker: { available: boolean; running: boolean; details?: string };
  podman: { available: boolean; running: boolean; details?: string };
};

const DEFAULT_ENGINES: EnginesState = {
  docker: { available: false, running: false },
  podman: { available: false, running: false }
};

export const RunApp: React.FC = () => {
  const { postMessage } = useVSCodeApi();

  const [isLoadingContext, setIsLoadingContext] = useState<boolean>(true);

  const [workspaceRoot, setWorkspaceRoot] = useState<string>('');
  const [flavors, setFlavors] = useState<string[]>([]);
  const [runnerVersions, setRunnerVersions] = useState<string[]>([]);
  const [latestRunnerVersion, setLatestRunnerVersion] = useState<string>('latest');
  const [engines, setEngines] = useState<EnginesState>(DEFAULT_ENGINES);
  const [engine, setEngine] = useState<Engine>('docker');
  const [flavor, setFlavor] = useState<string>('all');
  const [runnerVersion, setRunnerVersion] = useState<string>('latest');

  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'completed' | 'error'>('idle');
  const [reportFolderPath, setReportFolderPath] = useState<string>('');
  const [results, setResults] = useState<RunResult[]>([]);
  const [error, setError] = useState<{ message: string; commandLine?: string } | null>(null);

  const engineHelp = useMemo(() => {
    if (isLoadingContext) {
      return null;
    }

    const dockerOk = engines.docker.available && engines.docker.running;
    const podmanOk = engines.podman.available && engines.podman.running;

    if (dockerOk || podmanOk) {
      return null;
    }

    if (!engines.docker.available && !engines.podman.available) {
      return 'No container engine detected. Install Docker Desktop or Podman Desktop, then start the daemon.';
    }

    if (
      (engines.docker.available && !engines.docker.running) ||
      (engines.podman.available && !engines.podman.running)
    ) {
      return 'A container engine is detected but not started. Please start Docker/Podman and try again.';
    }

    return null;
  }, [engines]);

  const noEngineRunning = useMemo(() => {
    if (isLoadingContext) {
      return false;
    }
    return !(engines.docker.running || engines.podman.running);
  }, [isLoadingContext, engines]);

  const canRun = useMemo(() => {
    if (runStatus === 'running') {
      return false;
    }
    if (isLoadingContext) {
      return false;
    }
    if (engineHelp) {
      return false;
    }
    if (!engine || !flavor || !runnerVersion) {
      return false;
    }
    const selected = engines[engine];
    return Boolean(selected?.available && selected?.running);
  }, [runStatus, isLoadingContext, engineHelp, engine, flavor, runnerVersion, engines]);

  useEffect(() => {
    postMessage({ type: 'ready' });
  }, [postMessage]);

  useEffect(() => {
    const handler = (event: MessageEvent<RunWebViewMessage>) => {
      const message = event.data;
      switch (message.type) {
        case 'runContext':
          setIsLoadingContext(false);
          setWorkspaceRoot(message.workspaceRoot);
          setFlavors(message.flavors || []);
          setRunnerVersions(message.runnerVersions || []);
          setLatestRunnerVersion(message.latestRunnerVersion || 'latest');
          setEngines(message.engines);
          if (message.defaultEngine) {
            setEngine(message.defaultEngine);
          }
          if (message.latestRunnerVersion) {
            setRunnerVersion(message.latestRunnerVersion);
          }
          break;
        case 'runStatus':
          setRunId(message.runId);
          setRunStatus(message.status);
          setReportFolderPath(message.reportFolderPath);
          if (message.status === 'running') {
            setError(null);
            setResults([]);
          }
          break;
        case 'runResults':
          setRunId(message.runId);
          setReportFolderPath(message.reportFolderPath);
          setResults(message.results || []);
          break;
        case 'runError':
          setError({ message: message.message, commandLine: (message as any).commandLine });
          setRunStatus('error');
          break;
      }
    };

    window.addEventListener('message', handler as unknown as EventListener);
    return () => window.removeEventListener('message', handler as unknown as EventListener);
  }, []);

  const onRun = () => {
    setResults([]);
    setError(null);
    // Optimistic UX: reflect running state immediately.
    setRunStatus('running');
    setRunId(null);
    setReportFolderPath('');
    postMessage({
      type: 'runMegalinter',
      engine,
      flavor,
      runnerVersion
    });
  };

  const onCancel = () => {
    postMessage({ type: 'cancelRun' });
  };

  const onRefreshEngines = () => {
    setIsLoadingContext(true);
    postMessage({ type: 'getRunContext', force: true });
  };

  const openLog = (r: RunResult) => {
    if (!r.logFilePath) {
      return;
    }
    postMessage({ type: 'openFile', filePath: r.logFilePath });
  };

  const onViewLogs = () => {
    postMessage({ type: 'showOutput' });
  };

  return (
    <div className="run">
      <div className="run__header">
        <div>
          <h1 className="run__title">Run MegaLinter</h1>
          <div className="run__subtitle">
            Run <span className="run__mono">mega-linter-runner</span> via <span className="run__mono">npx</span> and view live logs + per-linter results.
          </div>
        </div>
        <div className="run__header-actions">
          <button
            type="button"
            className="pill-button pill-button--ghost"
            onClick={() => postMessage({ type: 'openExternal', url: 'https://www.npmjs.com/package/mega-linter-runner' })}
          >
            <span className="codicon codicon-link-external pill-button__icon" aria-hidden="true" />
            Runner docs
          </button>
        </div>
      </div>

      <div className="run__section">
        <div className="run__section-title">
          <span className="codicon codicon-settings-gear" aria-hidden="true" />
          Parameters
          {isLoadingContext && (
            <span className="run__badge">
              <span
                className="codicon codicon-loading codicon-modifier-spin run__spinner"
                aria-hidden="true"
              />
              Loading…
            </span>
          )}
        </div>

        {isLoadingContext && (
          <div className="run__callout" role="status" aria-live="polite">
            <span
              className="codicon codicon-loading codicon-modifier-spin run__spinner"
              aria-hidden="true"
            />
            <span>Fetching flavors, versions, and engine status…</span>
          </div>
        )}

        {engineHelp && (
          <div className="run__callout run__callout--warning" role="status" aria-live="polite">
            <span className="codicon codicon-warning" aria-hidden="true" />
            <span>{engineHelp}</span>
            {noEngineRunning && (
              <button
                type="button"
                className="pill-button pill-button--ghost run__refresh"
                onClick={onRefreshEngines}
                disabled={runStatus === 'running' || isLoadingContext}
                title="Refresh engine status"
              >
                <span className="codicon codicon-refresh pill-button__icon" aria-hidden="true" />
                Refresh
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="run__callout run__callout--error" role="alert">
            <span className="codicon codicon-error" aria-hidden="true" />
            <span>
              <div>{error.message}</div>
              {error.commandLine && (
                <div className="run__hint">
                  Command: <span className="run__mono">{error.commandLine}</span>
                </div>
              )}
            </span>
          </div>
        )}

        <div className="run__grid">
          <label className="run__field">
            <span className="run__label">Container engine</span>
            <select
              className="run__select"
              value={engine}
              onChange={(e) => setEngine(e.target.value as Engine)}
              disabled={runStatus === 'running' || isLoadingContext}
            >
              {isLoadingContext ? (
                <option value={engine}>Loading…</option>
              ) : (
                <>
                  <option value="docker" disabled={!engines.docker.available}>
                    docker{engines.docker.available ? (engines.docker.running ? ' (available)' : ' (not started)') : ' (not installed)'}
                  </option>
                  <option value="podman" disabled={!engines.podman.available}>
                    podman{engines.podman.available ? (engines.podman.running ? ' (available)' : ' (not started)') : ' (not installed)'}
                  </option>
                </>
              )}
            </select>
          </label>

          <label className="run__field">
            <span className="run__label">Flavor</span>
            <select
              className="run__select"
              value={flavor}
              onChange={(e) => setFlavor(e.target.value)}
              disabled={runStatus === 'running' || isLoadingContext}
            >
              {isLoadingContext ? (
                <option value={flavor}>Loading…</option>
              ) : (
                (flavors.length ? flavors : ['all']).map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="run__field">
            <span className="run__label">MegaLinter version</span>
            <select
              className="run__select"
              value={runnerVersion}
              onChange={(e) => setRunnerVersion(e.target.value)}
              disabled={runStatus === 'running' || isLoadingContext}
            >
              {isLoadingContext ? (
                <option value={runnerVersion}>Loading…</option>
              ) : (
                <>
                  {runnerVersions.length === 0 && <option value={latestRunnerVersion}>{latestRunnerVersion}</option>}
                  {runnerVersions.slice(0, 200).map((v) => (
                    <option key={v} value={v}>
                      {v}{v !== 'latest' && v === latestRunnerVersion ? ' (latest)' : ''}
                    </option>
                  ))}
                </>
              )}
            </select>
          </label>

          <div className="run__field run__actions">
            <span className="run__label">&nbsp;</span>
            <div className="run__buttons">
              <button
                type="button"
                className="pill-button pill-button--primary"
                onClick={onRun}
                disabled={!canRun}
                title={runStatus === 'running' ? 'Running' : 'Run MegaLinter'}
              >
                {runStatus === 'running' ? (
                  <span
                    className="codicon codicon-loading codicon-modifier-spin pill-button__icon"
                    aria-hidden="true"
                  />
                ) : (
                  <span className="codicon codicon-play pill-button__icon" aria-hidden="true" />
                )}
                {runStatus === 'running' ? 'Running' : 'Run MegaLinter'}
              </button>
              <button
                type="button"
                className="pill-button pill-button--ghost"
                onClick={onCancel}
                disabled={runStatus !== 'running'}
              >
                <span className="codicon codicon-debug-stop pill-button__icon" aria-hidden="true" />
                Stop
              </button>
            </div>
          </div>
        </div>

        {workspaceRoot && (
          <div className="run__hint">
            Workspace: <span className="run__mono">{workspaceRoot}</span>
          </div>
        )}
        {reportFolderPath && (
          <div className="run__hint">
            Reports: <span className="run__mono">{reportFolderPath}</span>
          </div>
        )}
      </div>

      <div className="run__section">
        <div className="run__section-title">
          <span className="codicon codicon-checklist" aria-hidden="true" />
          Results
          <div className="run__section-actions">
            <button
              type="button"
              className="pill-button pill-button--ghost"
              onClick={onViewLogs}
              title="Open the MegaLinter Output channel"
            >
              <span className="codicon codicon-output pill-button__icon" aria-hidden="true" />
              View logs
            </button>
            {runStatus === 'running' && (
              <span className="run__badge run__badge--running">running</span>
            )}
            {runId && results.length > 0 && (
              <span className="run__badge">{results.length} linters</span>
            )}
          </div>
        </div>

        {results.length === 0 ? (
          <div className="run__empty">No results yet.</div>
        ) : (
          <div className="run__table-wrap">
            <table className="run__table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Descriptor</th>
                  <th>Linter</th>
                  <th>Files</th>
                  <th>Errors</th>
                  <th>Warnings</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr
                    key={r.key}
                    className={`run__row run__row--${r.status.toLowerCase()}`}
                    onClick={() => openLog(r)}
                    title={r.logFilePath ? 'Click to open linter log' : ''}
                    role={r.logFilePath ? 'button' : undefined}
                  >
                    <td className="run__status">
                      <span className={`run__status-pill run__status-pill--${r.status.toLowerCase()}`}>{r.status}</span>
                    </td>
                    <td>{r.descriptor}</td>
                    <td className="run__mono">{r.key}</td>
                    <td>{typeof r.files === 'number' ? r.files : ''}</td>
                    <td>{typeof r.errors === 'number' ? r.errors : ''}</td>
                    <td>{typeof r.warnings === 'number' ? r.warnings : ''}</td>
                    <td>{typeof r.elapsedSeconds === 'number' ? `${r.elapsedSeconds.toFixed(2)}s` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
