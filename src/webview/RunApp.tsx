/* eslint-disable @typescript-eslint/naming-convention */
import React, { useEffect, useMemo, useState } from 'react';
import '@vscode/codicons/dist/codicon.css';
import './styles.css';
import oxSecurityIconLight from '../../media/ox-security-light.svg';
import oxSecurityIconDark from '../../media/ox-security-dark.svg';

import { useVSCodeApi } from './hooks';
import type {
  RunWebViewMessage,
  RunResult,
  ConfigNavigationTarget,
  RunWebviewToExtensionMessage,
  RunRecommendation
} from './types';

type Engine = 'docker' | 'podman';
type SortColumn = 'status' | 'descriptor' | 'linter' | 'files' | 'errors' | 'warnings' | 'time';

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
  const [flavor, setFlavor] = useState<string>('full');
  const [runnerVersion, setRunnerVersion] = useState<string>('latest');
  const [maxParallelCores, setMaxParallelCores] = useState<number>(4);
  const [parallelCores, setParallelCores] = useState<number>(4);

  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'completed' | 'error'>('idle');
  const [reportFolderPath, setReportFolderPath] = useState<string>('');
  const [results, setResults] = useState<RunResult[]>([]);
  const [hasInitialResults, setHasInitialResults] = useState<boolean>(false);
  const [recommendedExtensions, setRecommendedExtensions] = useState<RunRecommendation[]>([]);
  const [error, setError] = useState<{ message: string; commandLine?: string } | null>(null);
  const [initStage, setInitStage] = useState<
    | 'runner'
    | 'pull'
    | 'startImage'
    | 'analyzeConfig'
    | 'preCommands'
    | 'activation'
    | 'collectFiles'
    | null
  >(null);
  const [sort, setSort] = useState<{ column: SortColumn; direction: 'asc' | 'desc' }>({
    column: 'linter',
    direction: 'asc'
  });

  const STATUS_LABELS: Record<RunResult['status'], string> = {
    SUCCESS: 'Success',
    WARNING: 'Warning',
    ERROR: 'Error',
    RUNNING: 'Running',
    PENDING: 'Pending',
    UNKNOWN: 'Unknown'
  };

  const STATUS_ICONS: Record<RunResult['status'], string> = {
    SUCCESS: 'codicon-check',
    WARNING: 'codicon-warning',
    ERROR: 'codicon-error',
    RUNNING: 'codicon-loading codicon-modifier-spin',
    PENDING: 'codicon-clock',
    UNKNOWN: 'codicon-question'
  };

  const STATUS_ORDER: Record<RunResult['status'], number> = {
    ERROR: 0,
    WARNING: 1,
    RUNNING: 2,
    PENDING: 3,
    SUCCESS: 4,
    UNKNOWN: 5
  };

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
    if (!engine || !flavor || !runnerVersion || !parallelCores) {
      return false;
    }
    const selected = engines[engine];
    return Boolean(selected?.available && selected?.running);
  }, [runStatus, isLoadingContext, engineHelp, engine, flavor, runnerVersion, parallelCores, engines]);

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
          const preferences = message.runPreferences || {};

          const availableCores = Math.max(1, message.maxParallelCores || 1);
          setMaxParallelCores(availableCores);

          const incomingFlavors = message.flavors || [];
          const flavorsWithPref = preferences.flavor && !incomingFlavors.includes(preferences.flavor)
            ? [preferences.flavor, ...incomingFlavors]
            : incomingFlavors;
          setFlavors(flavorsWithPref);

          const incomingRunnerVersions = message.runnerVersions || [];
          const runnerVersionsWithPref = preferences.runnerVersion && !incomingRunnerVersions.includes(preferences.runnerVersion)
            ? [preferences.runnerVersion, ...incomingRunnerVersions]
            : incomingRunnerVersions;
          setRunnerVersions(runnerVersionsWithPref);
          setLatestRunnerVersion(message.latestRunnerVersion || 'latest');
          setEngines(message.engines);
          setFlavor((current) => {
            const list = flavorsWithPref.length ? flavorsWithPref : ['full'];
            if (preferences.flavor && list.includes(preferences.flavor)) {
              return preferences.flavor;
            }
            if (list.includes(current)) {
              return current;
            }
            if (list.includes('full')) {
              return 'full';
            }
            return list[0];
          });
          setRunnerVersion((current) => {
            const list = runnerVersionsWithPref;
            if (preferences.runnerVersion && (list.length === 0 || list.includes(preferences.runnerVersion))) {
              return preferences.runnerVersion;
            }
            if (list.includes(current)) {
              return current;
            }
            if (message.latestRunnerVersion && list.includes(message.latestRunnerVersion)) {
              return message.latestRunnerVersion;
            }
            return list[0] || current;
          });
          const defaultParallel = Math.min(availableCores, availableCores >= 4 ? 4 : availableCores);
          const preferredParallel = typeof preferences.parallelCores === 'number' ? preferences.parallelCores : undefined;
          const nextParallel = preferredParallel && preferredParallel > 0
            ? Math.min(availableCores, Math.max(1, Math.floor(preferredParallel)))
            : defaultParallel;
          setParallelCores((current) => {
            if (current > 0 && current <= availableCores && !preferredParallel) {
              return current;
            }
            return nextParallel;
          });
          const preferredEngine = preferences.engine;
          if (preferredEngine && message.engines[preferredEngine]?.available) {
            setEngine(preferredEngine as Engine);
          } else if (message.defaultEngine) {
            setEngine(message.defaultEngine);
          }
          break;
        case 'runStatus':
          setRunStatus(message.status);
          setReportFolderPath(message.reportFolderPath);
          if (message.status === 'running') {
            setError(null);
            setResults([]);
            setHasInitialResults(false);
            setInitStage('runner');
            setRecommendedExtensions([]);
            setRunId(message.runId);
          } else if (message.status === 'idle') {
            setError(null);
            setResults([]);
            setHasInitialResults(false);
            setInitStage(null);
            setRecommendedExtensions([]);
            setRunId(null);
          } else {
            setRunId(message.runId);
          }
          break;
        case 'runResults':
          setRunId(message.runId);
          setReportFolderPath(message.reportFolderPath);
          setResults(message.results || []);
          setHasInitialResults(true);
          break;
        case 'runRecommendations':
          setRecommendedExtensions(message.recommendations || []);
          break;
        case 'runInitStatus':
          setInitStage(message.stage);
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
    setHasInitialResults(false);
    // Optimistic UX: reflect running state immediately.
    setRunStatus('running');
    setRunId(null);
    setReportFolderPath('');
    postMessage({
      type: 'runMegalinter',
      engine,
      flavor,
      runnerVersion,
      parallelCores
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

  const normalizeId = (value?: string | null) => (typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : '');

  const descriptorIdFromResult = (r: RunResult) => {
    const descriptorId = normalizeId(r.descriptor);
    if (descriptorId) {
      return descriptorId;
    }
    const keyPart = normalizeId((r.key || '').split('_')[0]);
    return keyPart;
  };

  const linterIdFromResult = (r: RunResult) => {
    const key = normalizeId(r.key);
    if (key && key.includes('_')) {
      return key; // Prefer full linter key (e.g., HTML_HTMLHINT)
    }

    const linterId = normalizeId(r.linter);
    if (linterId) {
      return linterId;
    }

    if (key) {
      return key;
    }

    return '';
  };

  const openConfigNavigation = (target: ConfigNavigationTarget | null) => {
    if (!target) {
      return;
    }
    postMessage({ type: 'openConfigSection', target });
  };

  const onViewReports = () => {
    if (!reportFolderPath) {
      return;
    }
    postMessage({ type: 'revealPath', path: reportFolderPath } as RunWebviewToExtensionMessage);
  };

  const onViewLogs = () => {
    postMessage({ type: 'showOutput' });
  };

  const onInstallExtension = (extensionId: string) => {
    if (!extensionId) {
      return;
    }
    postMessage({ type: 'openExtension', extensionId });
  };

  const onHideRecommendations = () => {
    setRecommendedExtensions([]);
    postMessage({ type: 'updateRunSetting', key: 'recommendVsCodeExtensions', value: 'false' });
    postMessage({
      type: 'info',
      message:
        'Recommended extensions hidden. To show them again, enable "MegaLinter: Recommend VS Code Extensions" in VS Code settings.'
    });
  };

  const toggleSort = (column: SortColumn) => {
    setSort((current) => {
      if (current.column === column) {
        return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      }

      const defaultDirection: 'asc' | 'desc' = ['files', 'errors', 'warnings', 'time'].includes(column)
        ? 'desc'
        : 'asc';

      return { column, direction: defaultDirection };
    });
  };

  const sortedResults = useMemo(() => {
    const compareText = (a?: string, b?: string) => {
      const result = (a ?? '').localeCompare(b ?? '');
      return sort.direction === 'asc' ? result : -result;
    };

    const compareNumber = (a?: number, b?: number) => {
      const aNum = typeof a === 'number' ? a : null;
      const bNum = typeof b === 'number' ? b : null;

      const aMissing = aNum === null;
      const bMissing = bNum === null;

      if (aMissing && bMissing) {
        return 0;
      }
      if (aMissing) {
        return 1; // Always push undefined values last.
      }
      if (bMissing) {
        return -1;
      }

      const diff = aNum - bNum;
      return sort.direction === 'asc' ? diff : -diff;
    };

    const comparator = (a: RunResult, b: RunResult) => {
      let result = 0;

      switch (sort.column) {
        case 'status':
          result = compareNumber(STATUS_ORDER[a.status], STATUS_ORDER[b.status]);
          break;
        case 'descriptor':
          result = compareText(a.descriptor, b.descriptor);
          break;
        case 'linter':
          result = compareText(a.key, b.key);
          break;
        case 'files':
          result = compareNumber(a.files, b.files);
          break;
        case 'errors':
          result = compareNumber(a.errors, b.errors);
          break;
        case 'warnings':
          result = compareNumber(a.warnings, b.warnings);
          break;
        case 'time':
          result = compareNumber(a.elapsedSeconds, b.elapsedSeconds);
          break;
      }

      if (result === 0) {
        result = (a.key ?? '').localeCompare(b.key ?? '');
      }

      return result;
    };

    return results.slice().sort(comparator);
  }, [results, sort]);

  const sortIcon = (column: SortColumn) => {
    if (sort.column !== column) {
      return 'codicon-arrow-swap';
    }
    return sort.direction === 'asc' ? 'codicon-arrow-up' : 'codicon-arrow-down';
  };

  const ariaSort = (column: SortColumn): 'ascending' | 'descending' | 'none' => {
    if (sort.column !== column) {
      return 'none';
    }
    return sort.direction === 'asc' ? 'ascending' : 'descending';
  };

  return (
    <div className="run">
      <div className="run__header">
        <div>
          <h1 className="run__title">Run MegaLinter</h1>
          <div className="run__subtitle">
            Runs inside Docker/Podman so local execution is slower; MegaLinter is best for CI/CD, and for local edits prefer the individual linter VS Code extensions.
          </div>
        </div>
        <div className="run__header-actions">
          <a
            className="run__ox-link"
            href="https://www.ox.security/?ref=megalinter-vscode-run"
            target="_blank"
            rel="noreferrer"
            aria-label="Open OX Security website"
          >
            <img className="run__ox-logo run__ox-logo--light" src={oxSecurityIconLight} alt="OX Security" />
            <img className="run__ox-logo run__ox-logo--dark" src={oxSecurityIconDark} alt="OX Security" />
            <span className="run__ox-caption">Powered by OX Security</span>
          </a>
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
              onChange={(e) => {
                const next = e.target.value as Engine;
                setEngine(next);
                postMessage({ type: 'updateRunSetting', key: 'engine', value: next });
              }}
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
              onChange={(e) => {
                const next = e.target.value;
                setFlavor(next);
                postMessage({ type: 'updateRunSetting', key: 'flavor', value: next });
              }}
              disabled={runStatus === 'running' || isLoadingContext}
            >
              {isLoadingContext ? (
                <option value={flavor}>Loading…</option>
              ) : (
                (flavors.length ? flavors : ['full']).map((f) => (
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
              onChange={(e) => {
                const next = e.target.value;
                setRunnerVersion(next);
                postMessage({ type: 'updateRunSetting', key: 'version', value: next });
              }}
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

          <label className="run__field">
            <span className="run__label">Parallel cores</span>
            <select
              className="run__select"
              value={parallelCores}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (!Number.isFinite(next)) {
                  return;
                }
                const clamped = Math.min(maxParallelCores, Math.max(1, Math.floor(next)));
                setParallelCores(clamped);
                postMessage({ type: 'updateRunSetting', key: 'parallelCores', value: String(clamped) });
              }}
              disabled={runStatus === 'running' || isLoadingContext}
            >
              {Array.from({ length: maxParallelCores }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
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
              View Console logs
            </button>
            <button
              type="button"
              className="pill-button pill-button--ghost"
              onClick={onViewReports}
              disabled={!reportFolderPath}
              title="Open reports folder in VS Code"
            >
              <span className="codicon codicon-folder-opened pill-button__icon" aria-hidden="true" />
              View reports
            </button>
            {runId && results.length > 0 && (
              <span className="run__badge">{results.length} linters</span>
            )}
          </div>
        </div>

        {runStatus === 'running' && !hasInitialResults ? (
          <div className="run__callout" role="status" aria-live="polite">
            <span
              className="codicon codicon-loading codicon-modifier-spin run__spinner"
              aria-hidden="true"
            />
            <span>
              {initStage === 'pull'
                ? 'Pulling MegaLinter docker image...'
                : initStage === 'startImage'
                  ? 'Starting MegaLinter docker image...'
                  : initStage === 'analyzeConfig'
                    ? 'Analyzing MegaLinter configuration...'
                    : initStage === 'preCommands'
                      ? 'Running pre-commands...'
                      : initStage === 'activation'
                        ? 'Listing available linters...'
                        : initStage === 'collectFiles'
                          ? 'Collecting files to analyze and match them with available linters...'
                          : 'Initializing mega-linter-runner...'}
            </span>
          </div>
        ) : results.length === 0 ? (
          <div className="run__empty">No results yet.</div>
        ) : (
          <div className="run__table-wrap">
            <table className="run__table">
              <thead>
                <tr>
                  <th aria-sort={ariaSort('status')}>
                    <button
                      type="button"
                      className={`run__sort-button${sort.column === 'status' ? ' run__sort-button--active' : ''}`}
                      onClick={() => toggleSort('status')}
                      aria-label={`Sort by status${sort.column === 'status' ? ` (${sort.direction})` : ''}`}
                    >
                      <span>Status</span>
                      <span className={`codicon ${sortIcon('status')} run__sort-icon`} aria-hidden="true" />
                    </button>
                  </th>
                  <th aria-sort={ariaSort('descriptor')}>
                    <button
                      type="button"
                      className={`run__sort-button${sort.column === 'descriptor' ? ' run__sort-button--active' : ''}`}
                      onClick={() => toggleSort('descriptor')}
                      aria-label={`Sort by descriptor${sort.column === 'descriptor' ? ` (${sort.direction})` : ''}`}
                    >
                      <span>Descriptor</span>
                      <span className={`codicon ${sortIcon('descriptor')} run__sort-icon`} aria-hidden="true" />
                    </button>
                  </th>
                  <th aria-sort={ariaSort('linter')}>
                    <button
                      type="button"
                      className={`run__sort-button${sort.column === 'linter' ? ' run__sort-button--active' : ''}`}
                      onClick={() => toggleSort('linter')}
                      aria-label={`Sort by linter${sort.column === 'linter' ? ` (${sort.direction})` : ''}`}
                    >
                      <span>Linter</span>
                      <span className={`codicon ${sortIcon('linter')} run__sort-icon`} aria-hidden="true" />
                    </button>
                  </th>
                  <th aria-sort={ariaSort('files')}>
                    <button
                      type="button"
                      className={`run__sort-button${sort.column === 'files' ? ' run__sort-button--active' : ''}`}
                      onClick={() => toggleSort('files')}
                      aria-label={`Sort by files${sort.column === 'files' ? ` (${sort.direction})` : ''}`}
                    >
                      <span>Files</span>
                      <span className={`codicon ${sortIcon('files')} run__sort-icon`} aria-hidden="true" />
                    </button>
                  </th>
                  <th aria-sort={ariaSort('errors')}>
                    <button
                      type="button"
                      className={`run__sort-button${sort.column === 'errors' ? ' run__sort-button--active' : ''}`}
                      onClick={() => toggleSort('errors')}
                      aria-label={`Sort by errors${sort.column === 'errors' ? ` (${sort.direction})` : ''}`}
                    >
                      <span>Errors</span>
                      <span className={`codicon ${sortIcon('errors')} run__sort-icon`} aria-hidden="true" />
                    </button>
                  </th>
                  <th aria-sort={ariaSort('warnings')}>
                    <button
                      type="button"
                      className={`run__sort-button${sort.column === 'warnings' ? ' run__sort-button--active' : ''}`}
                      onClick={() => toggleSort('warnings')}
                      aria-label={`Sort by warnings${sort.column === 'warnings' ? ` (${sort.direction})` : ''}`}
                    >
                      <span>Warnings</span>
                      <span className={`codicon ${sortIcon('warnings')} run__sort-icon`} aria-hidden="true" />
                    </button>
                  </th>
                  <th aria-sort={ariaSort('time')}>
                    <button
                      type="button"
                      className={`run__sort-button${sort.column === 'time' ? ' run__sort-button--active' : ''}`}
                      onClick={() => toggleSort('time')}
                      aria-label={`Sort by time${sort.column === 'time' ? ` (${sort.direction})` : ''}`}
                    >
                      <span>Time</span>
                      <span className={`codicon ${sortIcon('time')} run__sort-icon`} aria-hidden="true" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedResults.map((r) => (
                  <tr
                    key={r.key}
                    className={`run__row run__row--${r.status.toLowerCase()}`}
                    onClick={() => openLog(r)}
                    title={r.logFilePath ? 'Click to open linter log' : ''}
                    role={r.logFilePath ? 'button' : undefined}
                  >
                    <td className="run__status">
                      <span className={`run__status-pill run__status-pill--${r.status.toLowerCase()}`}>
                        <span
                          className={`codicon ${STATUS_ICONS[r.status] || ''} run__status-pill-icon`}
                          aria-hidden="true"
                        />
                        {STATUS_LABELS[r.status] ?? r.status}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="run__link-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          const descriptorId = descriptorIdFromResult(r);
                          if (!descriptorId) {
                            return;
                          }
                          openConfigNavigation({ type: 'descriptor', descriptorId });
                        }}
                        title="Open descriptor in MegaLinter configuration"
                      >
                        {r.descriptor}
                      </button>
                    </td>
                    <td className="run__mono">
                      <button
                        type="button"
                        className="run__link-button run__link-button--mono"
                        onClick={(event) => {
                          event.stopPropagation();
                          const descriptorId = descriptorIdFromResult(r);
                          const linterId = linterIdFromResult(r);
                          if (!descriptorId) {
                            return;
                          }
                          const target: ConfigNavigationTarget =
                            linterId
                              ? { type: 'linter', descriptorId, linterId }
                              : { type: 'descriptor', descriptorId };
                          openConfigNavigation(target);
                        }}
                        title="Open linter in MegaLinter configuration"
                      >
                        {r.linter || r.key}
                      </button>
                    </td>
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

      {recommendedExtensions.length > 0 && (
        <div className="run__section">
          <div className="run__section-title">
            <span className="codicon codicon-extensions" aria-hidden="true" />
            Recommended extensions
            <div className="run__section-actions">
              <button
                type="button"
                className="pill-button pill-button--ghost"
                onClick={onHideRecommendations}
                title="Hide recommended extensions"
              >
                <span className="codicon codicon-eye-closed pill-button__icon" aria-hidden="true" />
                Hide
              </button>
            </div>
          </div>
          <div className="run__recommendations">
            <table className="run__recommendations-table">
              <thead>
                <tr>
                  <th>Extension</th>
                  <th>Author</th>
                  <th>Extension ID</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recommendedExtensions.map((rec) => (
                  <tr key={rec.extensionId}>
                    <td>
                      <button
                        type="button"
                        className="run__link-button run__link-button--mono"
                        onClick={() => onInstallExtension(rec.extensionId)}
                        title="Open extension details"
                      >
                        {rec.label || rec.extensionId}
                      </button>
                    </td>
                    <td>{rec.author || '—'}</td>
                    <td className="run__mono">
                      <button
                        type="button"
                        className="run__link-button run__link-button--mono"
                        onClick={() => onInstallExtension(rec.extensionId)}
                        title="Open extension details"
                      >
                        {rec.extensionId}
                      </button>
                    </td>
                    <td className="run__recommendation-actions">
                      {rec.installed ? (
                        <span className="run__badge run__badge--installed">Installed</span>
                      ) : (
                        <button
                          type="button"
                          className="pill-button pill-button--ghost"
                          onClick={() => onInstallExtension(rec.extensionId)}
                        >
                          <span className="codicon codicon-cloud-download pill-button__icon" aria-hidden="true" />
                          Install
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
