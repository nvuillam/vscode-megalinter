/* eslint-disable @typescript-eslint/naming-convention */
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';
import { ArrayFieldTemplateProps, RJSFSchema, UiSchema, WidgetProps } from '@rjsf/utils';
import bundledSchema from '../descriptors/schemas/megalinter-configuration.jsonschema.json';
import { buildPresenceMaps, hasAnyKeySet } from '../shared/configPresence';
import { extractGroups, filterRemovedLintersFromSchema, SchemaGroups } from '../shared/schemaUtils';
import {
  buildNavigationModel,
  buildScopedUiSchema,
  buildSubsetSchema,
  computeNonDefaultKeys,
  filterFormData,
  groupKeysByTheme,
  isDeprecatedPropertyTitle,
  MenuChild,
  MenuItem,
  MenuSection,
  prettifyId,
  pruneDefaults,
  Tab
} from './menuUtils';
import './styles.css';
import megalinterBannerLocal from './assets/megalinter-banner.png';

const OX_SECURITY_LOGO = 'https://www.ox.security/wp-content/uploads/2025/10/logo-short-new.svg';
const OX_SECURITY_LOGO_FALLBACK = 'https://avatars.githubusercontent.com/u/89921661?s=200&v=4';
const MEGALINTER_BANNER_URL =
  'https://github.com/oxsecurity/megalinter/raw/main/docs/assets/images/megalinter-banner.png';
const MEGALINTER_BANNER_FALLBACK = megalinterBannerLocal;

type NavigationTarget =
  | { type: 'home' }
  | { type: 'general' }
  | { type: 'summary' }
  | { type: 'category'; categoryId: string }
  | { type: 'descriptor'; descriptorId: string }
  | { type: 'linter'; descriptorId: string; linterId: string };

type ViewState = {
  activeMainTab: string;
  selectedCategory: string | null;
  selectedDescriptor: string | null;
  selectedScope: string | null;
  activeGeneralTheme: string | null;
  activeDescriptorThemes: Record<string, string>;
  activeLinterThemes: Record<string, Record<string, string>>;
};

type LinterDescriptorMetadata = {
  descriptorId?: string;
  name?: string;
  linterName?: string;
  url?: string;
  repo?: string;
  imageUrl?: string;
  bannerImageUrl?: string;
  text?: string;
  urls?: Array<{ label: string; href: string }>;
};

type CachedSchema = {
  schema: RJSFSchema;
  timestamp: number;
};

type PersistedState = ViewState & {
  cachedSchema?: CachedSchema | null;
};

const SCHEMA_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// VS Code API type
declare global {
  interface Window {
    acquireVsCodeApi: () => {
      postMessage: (message: any) => void;
      setState: (state: any) => void;
      getState: () => any;
    };
  }
}

const vscode = window.acquireVsCodeApi();

export const App: React.FC = () => {
  const [schema, setSchema] = useState<RJSFSchema | null>(null);
  const [groups, setGroups] = useState<SchemaGroups | null>(null);
  const [formData, setFormData] = useState<any>({});
  const [originalConfig, setOriginalConfig] = useState<any>({});
  const [configLoaded, setConfigLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configPath, setConfigPath] = useState<string>('');
  const [configExists, setConfigExists] = useState<boolean>(false);
  const [linterMetadata, setLinterMetadata] = useState<Record<string, LinterDescriptorMetadata>>({});
  const [cachedSchema, setCachedSchema] = useState<CachedSchema | null>(null);
  const [initialStateReady, setInitialStateReady] = useState(false);

  const [activeMainTab, setActiveMainTab] = useState<string>('home');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedDescriptor, setSelectedDescriptor] = useState<string | null>(
    null
  );
  const [selectedScope, setSelectedScope] = useState<string | null>(null);
  const [activeGeneralTheme, setActiveGeneralTheme] = useState<string | null>(
    null
  );
  const [activeDescriptorThemes, setActiveDescriptorThemes] = useState<
    Record<string, string>
  >({});
  const [activeLinterThemes, setActiveLinterThemes] = useState<
    Record<string, Record<string, string>>
  >({});
  const saveTimer = useRef<number | null>(null);
  const highlightedKeys = useMemo(() => {
    if (!schema) {
      return new Set<string>();
    }
    return computeNonDefaultKeys(formData, schema);
  }, [formData, schema]);
  const navigationModel = useMemo(
    () => (groups ? buildNavigationModel(groups, formData) : null),
    [groups, formData]
  );

  const configuredKeyCount = useMemo(() => {
    const entries = Object.entries(formData || {});
    const isValueSet = (value: any) => {
      if (value === undefined || value === null) {
        return false;
      }
      if (typeof value === 'string') {
        return value.trim() !== '';
      }
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return true;
    };
    return entries.reduce((acc, [, value]) => (isValueSet(value) ? acc + 1 : acc), 0);
  }, [formData]);

  const totalSchemaKeys = useMemo(() => {
    if (!schema || !schema.properties) {
      return 0;
    }
    return Object.keys(schema.properties as Record<string, unknown>).length;
  }, [schema]);

  const descriptorCount = useMemo(
    () => navigationModel?.descriptorOrder.length ?? 0,
    [navigationModel]
  );

  const linterCount = useMemo(() => {
    if (!groups) {
      return 0;
    }
    return Object.values(groups.linterKeys || {}).reduce((acc, linters) => {
      return acc + Object.keys(linters || {}).length;
    }, 0);
  }, [groups]);

  const firstDescriptorId = useMemo(
    () => navigationModel?.descriptorOrder[0] || null,
    [navigationModel]
  );

  const firstGenericCategoryId = useMemo(() => {
    if (!groups) {
      return null;
    }
    const ids = Object.keys(groups.genericCategoryKeys);
    const preferred = ids.find((id) => id.toLowerCase().includes('report'));
    return preferred || ids[0] || null;
  }, [groups]);

  const firstDescriptorLabel = useMemo(() => {
    if (!firstDescriptorId || !groups) {
      return '';
    }
    const meta = groups.categoryMeta[firstDescriptorId];
    return prettifyId(meta?.label || firstDescriptorId);
  }, [firstDescriptorId, groups]);

  const firstGenericCategoryLabel = useMemo(() => {
    if (!firstGenericCategoryId || !groups) {
      return '';
    }
    const meta = groups.categoryMeta[firstGenericCategoryId];
    return prettifyId(meta?.label || firstGenericCategoryId);
  }, [firstGenericCategoryId, groups]);

  useEffect(() => {
    const viewState: PersistedState = {
      activeMainTab,
      selectedCategory,
      selectedDescriptor,
      selectedScope,
      activeGeneralTheme,
      activeDescriptorThemes,
      activeLinterThemes,
      cachedSchema
    };
    vscode.setState?.(viewState);
  }, [
    activeMainTab,
    selectedCategory,
    selectedDescriptor,
    selectedScope,
    activeGeneralTheme,
    activeDescriptorThemes,
    activeLinterThemes,
    cachedSchema
  ]);

  useEffect(() => {
    const saved = vscode.getState?.() as Partial<PersistedState> | undefined;
    if (saved) {
      if (saved.activeMainTab) {
        setActiveMainTab(saved.activeMainTab);
      }
      if (saved.selectedCategory !== undefined) {
        setSelectedCategory(saved.selectedCategory || null);
      }
      if (saved.selectedDescriptor !== undefined) {
        setSelectedDescriptor(saved.selectedDescriptor);
      }
      if (saved.selectedScope !== undefined) {
        setSelectedScope(saved.selectedScope);
      }
      if (saved.activeGeneralTheme !== undefined) {
        setActiveGeneralTheme(saved.activeGeneralTheme);
      }
      if (saved.activeDescriptorThemes) {
        setActiveDescriptorThemes(saved.activeDescriptorThemes);
      }
      if (saved.activeLinterThemes) {
        setActiveLinterThemes(saved.activeLinterThemes);
      }

      const cached = saved.cachedSchema;
      const isCacheFresh =
        cached && typeof cached.timestamp === 'number' && Date.now() - cached.timestamp < SCHEMA_CACHE_TTL_MS;

      if (cached && isCacheFresh) {
        const filtered = filterRemovedLintersFromSchema(cached.schema);
        setSchema(filtered);
        setGroups(extractGroups(filtered));
        setCachedSchema(cached);
        setLoading(false);
      }
    }

    setInitialStateReady(true);
  }, []);

  const queueSave = (data: any) => {
    if (!schema || !configLoaded) {
      return;
    }

    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
    }

    const timerId = window.setTimeout(() => {
      const pruned = pruneDefaults(data, originalConfig, schema);
      vscode.postMessage({ type: 'saveConfig', config: pruned });
    }, 400);

    saveTimer.current = timerId;
  };

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
      }
    };
  }, []);

  const handleNavigationSelect = (item: MenuItem | MenuChild) => {
    if (item.type === 'home') {
      setActiveMainTab('home');
      setSelectedCategory(null);
      setSelectedDescriptor(null);
      setSelectedScope(null);
      return;
    }

    if (item.type === 'summary') {
      setActiveMainTab('summary');
      setSelectedCategory(null);
      setSelectedDescriptor(null);
      setSelectedScope(null);
      return;
    }

    if (item.type === 'general') {
      setActiveMainTab('general');
      setSelectedCategory(null);
      setSelectedDescriptor(null);
      setSelectedScope(null);
      return;
    }

    if (item.type === 'category') {
      setActiveMainTab('category');
      setSelectedCategory(item.id);
      setSelectedDescriptor(null);
      setSelectedScope(null);
      return;
    }

    if (item.type === 'linter') {
      setActiveMainTab('descriptors');
      setSelectedCategory(null);
      setSelectedDescriptor(item.parentId);
      setSelectedScope(item.id);
      return;
    }

    setActiveMainTab('descriptors');
    setSelectedCategory(null);
    setSelectedDescriptor(item.id);
    setSelectedScope('descriptor');
  };

  const applyNavigation = (target: NavigationTarget) => {
    if (!target) {
      return;
    }

    if (target.type === 'home') {
      setActiveMainTab('home');
      setSelectedCategory(null);
      setSelectedDescriptor(null);
      setSelectedScope(null);
      return;
    }

    if (target.type === 'general') {
      setActiveMainTab('general');
      setSelectedCategory(null);
      return;
    }

    if (target.type === 'summary') {
      setActiveMainTab('summary');
      setSelectedCategory(null);
      setSelectedDescriptor(null);
      setSelectedScope(null);
      return;
    }

    if (target.type === 'category') {
      setActiveMainTab('category');
      setSelectedCategory(target.categoryId);
      setSelectedDescriptor(null);
      setSelectedScope(null);
      return;
    }

    if (target.type === 'descriptor') {
      setActiveMainTab('descriptors');
      setSelectedCategory(null);
      setSelectedDescriptor(target.descriptorId);
      setSelectedScope('descriptor');
      return;
    }

    if (target.type === 'linter') {
      setActiveMainTab('descriptors');
      setSelectedCategory(null);
      setSelectedDescriptor(target.descriptorId);
      setSelectedScope(target.linterId);
    }
  };

  const openSummary = () => {
    setActiveMainTab('summary');
    setSelectedCategory(null);
    setSelectedDescriptor(null);
    setSelectedScope(null);
  };

  const openGeneral = () => {
    setActiveMainTab('general');
    setSelectedCategory(null);
    setSelectedDescriptor(null);
    setSelectedScope(null);
  };

  const openCategory = (categoryId: string | null) => {
    if (!categoryId) {
      return;
    }
    setActiveMainTab('category');
    setSelectedCategory(categoryId);
    setSelectedDescriptor(null);
    setSelectedScope(null);
  };

  const openDescriptor = (descriptorId: string | null, scopeId?: string | null) => {
    if (!descriptorId) {
      return;
    }
    setActiveMainTab('descriptors');
    setSelectedCategory(null);
    setSelectedDescriptor(descriptorId);
    setSelectedScope(scopeId || 'descriptor');
  };

  useEffect(() => {
    if (!initialStateReady) {
      return;
    }

    const fallbackSchema = bundledSchema as RJSFSchema;
    const remoteSchemaUrl =
      'https://raw.githubusercontent.com/oxsecurity/megalinter/main/megalinter/descriptors/schemas/megalinter-configuration.jsonschema.json';
    const shouldSkipFetch = cachedSchema && Date.now() - cachedSchema.timestamp < SCHEMA_CACHE_TTL_MS;

    const fetchSchema = async () => {
      if (shouldSkipFetch) {
        return;
      }
      try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 8000);
        const response = await fetch(remoteSchemaUrl, { signal: controller.signal });
        window.clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Failed to fetch schema (HTTP ${response.status})`);
        }

        const schemaData = await response.json();
        const filtered = filterRemovedLintersFromSchema(schemaData as RJSFSchema);
        setSchema(filtered);
        setGroups(extractGroups(filtered));
        setCachedSchema({ schema: schemaData as RJSFSchema, timestamp: Date.now() });
      } catch (err) {
        console.warn('Remote schema fetch failed, using bundled schema', err);
        try {
          const filtered = filterRemovedLintersFromSchema(fallbackSchema);
          setSchema(filtered);
          setGroups(extractGroups(filtered));
          vscode.postMessage({
            type: 'info',
            message: 'Using bundled MegaLinter schema (remote fetch unavailable).'
          });
        } catch (fallbackErr) {
          const errorMessage =
            fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          setError(`Failed to load MegaLinter schema: ${errorMessage}`);
          vscode.postMessage({
            type: 'error',
            message: `Failed to load MegaLinter schema: ${errorMessage}`
          });
        }
      } finally {
        setLoading(false);
      }
    };

    fetchSchema();
    vscode.postMessage({ type: 'getConfig' });
    vscode.postMessage({ type: 'ready' });

    const messageHandler = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'configData') {
        setFormData(message.config);
        setOriginalConfig(message.config || {});
        setConfigPath(message.configPath);
        setConfigExists(!!message.configExists);
        setLinterMetadata(message.linterMetadata || {});
        setConfigLoaded(true);
      } else if (message.type === 'navigate' && message.target) {
        applyNavigation(message.target as NavigationTarget);
      }
    };

    window.addEventListener('message', messageHandler);
    return () => window.removeEventListener('message', messageHandler);
  }, [initialStateReady]);

  useEffect(() => {
    if (schema) {
      const grouped = extractGroups(schema);
      setGroups(grouped);
    }
  }, [schema]);

  useEffect(() => {
    if (!navigationModel || !navigationModel.descriptorOrder.length) {
      return;
    }
    const firstDescriptor = navigationModel.descriptorOrder[0];
    const isValidSelection = selectedDescriptor && navigationModel.descriptorOrder.includes(selectedDescriptor);

    if (selectedDescriptor && !isValidSelection) {
      setSelectedDescriptor(firstDescriptor);
      setSelectedScope('descriptor');
    }

    if (!selectedDescriptor && activeMainTab === 'descriptors') {
      setSelectedDescriptor(firstDescriptor);
      setSelectedScope('descriptor');
    }
  }, [navigationModel, selectedDescriptor, activeMainTab]);

  useEffect(() => {
    if (!groups) {
      return;
    }

    const categoryIds = Object.keys(groups.genericCategoryKeys);
    if (activeMainTab !== 'category') {
      return;
    }

    if (!categoryIds.length) {
      setSelectedCategory(null);
      return;
    }

    if (!selectedCategory || !categoryIds.includes(selectedCategory)) {
      setSelectedCategory(categoryIds[0]);
    }
  }, [groups, activeMainTab, selectedCategory]);

  const handleSubsetChange = (keys: string[], subsetData: any) => {
    setFormData((prev: any) => {
      const next = { ...prev };
      keys.forEach((key) => {
        if (subsetData && Object.prototype.hasOwnProperty.call(subsetData, key)) {
          const value = subsetData[key];
          if (value === undefined) {
            delete next[key];
          } else {
            next[key] = value;
          }
        }
      });
      queueSave(next);
      return next;
    });
  };

    const uiSchema: UiSchema = {
      'ui:submitButtonOptions': {
        norender: true
      }
    };

  if (loading) {
    return (
      <div className="container">
        <div className="loading">
          <p>Loading MegaLinter schema...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="error">
          <h2>Error</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!schema || !groups) {
    return (
      <div className="container">
        <div className="error">
          <p>No schema available</p>
        </div>
      </div>
    );
  }

  const selectedNavId =
    activeMainTab === 'home'
      ? 'home'
      : activeMainTab === 'general'
      ? 'general'
      : activeMainTab === 'summary'
      ? 'summary'
      : activeMainTab === 'category'
      ? selectedCategory || ''
      : selectedScope || selectedDescriptor || '';

  return (
    <div className="container">
      <div className="layout">
        <NavigationMenu
          sections={navigationModel?.sections || []}
          selectedId={selectedNavId}
          activeDescriptorId={selectedDescriptor}
          onSelect={handleNavigationSelect}
        />
        <div className="form-container">
          {activeMainTab === 'home' ? (
            <HomePanel
              configPath={configPath}
              configExists={configExists}
              configLoaded={configLoaded}
              configuredCount={configuredKeyCount}
              totalKeys={totalSchemaKeys}
              descriptorCount={descriptorCount}
              linterCount={linterCount}
              onOpenGeneral={openGeneral}
              onOpenSummary={openSummary}
              onOpenFirstDescriptor={() => openDescriptor(firstDescriptorId, 'descriptor')}
              onOpenReporters={() => openCategory(firstGenericCategoryId)}
              logoUrl={OX_SECURITY_LOGO}
              logoFallbackUrl={OX_SECURITY_LOGO_FALLBACK}
              bannerUrl={MEGALINTER_BANNER_URL}
              bannerFallbackUrl={MEGALINTER_BANNER_FALLBACK}
              descriptorLabel={firstDescriptorLabel}
              reportersLabel={firstGenericCategoryLabel}
              hasConfiguration={configuredKeyCount > 0}
              descriptorNavigationReady={!!firstDescriptorId}
              reporterNavigationReady={!!firstGenericCategoryId}
            />
          ) : (
            <MainTabs
              schema={schema}
              groups={groups}
              formData={formData}
              uiSchema={uiSchema}
              onSubsetChange={handleSubsetChange}
              descriptorOrder={navigationModel?.descriptorOrder || []}
              activeMainTab={activeMainTab}
              setActiveMainTab={setActiveMainTab}
              selectedCategory={selectedCategory}
              setSelectedCategory={setSelectedCategory}
              selectedDescriptor={selectedDescriptor}
              setSelectedDescriptor={setSelectedDescriptor}
              selectedScope={selectedScope}
              setSelectedScope={setSelectedScope}
              activeGeneralTheme={activeGeneralTheme}
              setActiveGeneralTheme={setActiveGeneralTheme}
              activeDescriptorThemes={activeDescriptorThemes}
              setActiveDescriptorThemes={setActiveDescriptorThemes}
              activeLinterThemes={activeLinterThemes}
              setActiveLinterThemes={setActiveLinterThemes}
              highlightedKeys={highlightedKeys}
              linterMetadata={linterMetadata}
            />
          )}
        </div>
      </div>
    </div>
  );
};

type HomePanelProps = {
  configPath: string;
  configExists: boolean;
  configLoaded: boolean;
  configuredCount: number;
  totalKeys: number;
  descriptorCount: number;
  linterCount: number;
  onOpenGeneral: () => void;
  onOpenSummary: () => void;
  onOpenFirstDescriptor: () => void;
  onOpenReporters: () => void;
  logoUrl: string;
  logoFallbackUrl: string;
  bannerUrl: string;
  bannerFallbackUrl: string;
  descriptorLabel: string;
  reportersLabel: string;
  hasConfiguration: boolean;
  descriptorNavigationReady: boolean;
  reporterNavigationReady: boolean;
};

const HomePanel: React.FC<HomePanelProps> = ({
  configPath,
  configExists,
  configLoaded,
  configuredCount,
  totalKeys,
  descriptorCount,
  linterCount,
  onOpenGeneral,
  onOpenSummary,
  onOpenFirstDescriptor,
  onOpenReporters,
  logoUrl,
  logoFallbackUrl,
  bannerUrl,
  bannerFallbackUrl,
  descriptorLabel,
  reportersLabel,
  hasConfiguration,
  descriptorNavigationReady,
  reporterNavigationReady
}) => {
  const [logoSrc, setLogoSrc] = useState<string>(logoUrl);
  const [bannerSrc, setBannerSrc] = useState<string>(bannerUrl);
  const configBadge = configPath ? configPath : 'No configuration file selected yet';
  const renderInstallOrUpgrade = () => {
    if (!configLoaded) {
      return (
        <div className="home__cta-spinner" role="status" aria-live="polite">
          <span className="home__spinner" aria-hidden="true" />
          <span>Loading setup…</span>
        </div>
      );
    }

    if (!configExists) {
      return (
        <button
          type="button"
          className="pill-button pill-button--solid"
          onClick={() => vscode.postMessage({ type: 'installMegaLinter' })}
        >
          Install MegaLinter
        </button>
      );
    }

    return (
      <button
        type="button"
        className="pill-button pill-button--solid"
        onClick={() => vscode.postMessage({ type: 'upgradeMegaLinter' })}
      >
        Upgrade MegaLinter
      </button>
    );
  };

  return (
    <div className="home">
      <div className="home__banner">
        <img
          src={bannerSrc}
          alt="MegaLinter banner"
          className="home__banner-image"
          onError={(event) => {
            if (event.currentTarget.src !== bannerFallbackUrl) {
              setBannerSrc(bannerFallbackUrl);
            }
          }}
        />
      </div>
      <div className="home__hero">
        <div className="home__logo-tile">
          <img
            src={logoSrc}
            alt="OX Security logo"
            className="home__logo"
            onError={(event) => {
              if (event.currentTarget.src !== logoFallbackUrl) {
                setLogoSrc(logoFallbackUrl);
              }
            }}
          />
          <div className="home__logo-caption">Powered by OX Security</div>
        </div>
        <div className="home__intro">
          <p className="eyebrow">MegaLinter workspace home</p>
          <h1 className="home__title">Configure once, ship confidently</h1>
          <p className="home__subtitle">
            Tailor MegaLinter to your repository, preview the impact, and keep every run aligned with your team.
          </p>
          <div className="home__actions">
            {renderInstallOrUpgrade()}
            <button
              type="button"
              className="pill-button pill-button--primary"
              onClick={onOpenGeneral}
              disabled={!configExists}
            >
              Start with general settings
            </button>
            <button
              type="button"
              className="pill-button pill-button--ghost"
              onClick={onOpenSummary}
              disabled={!hasConfiguration}
            >
              Review configured values
            </button>
            <a
              className="pill-button pill-button--ghost"
              href="https://megalinter.io/latest/"
              target="_blank"
              rel="noreferrer"
            >
              Open MegaLinter docs
            </a>
          </div>
          <div className="home__badges" aria-label="Quick context">
            <span className="pill-chip pill-chip--muted" title={configBadge}>
              {configBadge}
            </span>
          </div>
        </div>
      </div>

      <div className="home__grid" role="list">
        <div className="home__card" role="listitem">
          <div className="home__card-label">Configured values</div>
          <div className="home__card-value">
            {configuredCount}
            <span className="home__card-sub">of {totalKeys || '-'} fields</span>
          </div>
          <p className="home__card-note">
            {hasConfiguration
              ? 'Great start - keep adding detail or jump to Summary.'
              : 'No overrides yet. Begin with general settings to set the foundation.'}
          </p>
        </div>

        <div className="home__card" role="listitem">
          <div className="home__card-label">Coverage</div>
          <div className="home__card-value">
            {descriptorCount}
            <span className="home__card-sub">descriptors</span>
          </div>
          <p className="home__card-note">{linterCount} linters available across your stack.</p>
        </div>
      </div>

    </div>
  );
};

const NavigationMenu: React.FC<{
  sections: MenuSection[];
  selectedId: string;
  activeDescriptorId: string | null;
  onSelect: (item: MenuItem | MenuChild) => void;
}> = ({ sections, selectedId, activeDescriptorId, onSelect }) => {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    home: true,
    summary: true,
    general: true,
    generic: false,
    descriptors: true
  });

  useEffect(() => {
    const matchingSection = sections.find((section) =>
      section.items.some(
        (item) =>
          item.id === selectedId ||
          (item.children && item.children.some((child) => child.id === selectedId))
      )
    );

    if (!matchingSection) {
      return;
    }

    setExpandedSections((prev) => {
      if (prev[matchingSection.id]) {
        return prev;
      }
      return { ...prev, [matchingSection.id]: true };
    });
  }, [selectedId, sections]);

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <nav className="nav" aria-label="Configuration sections">
      {sections.map((section) => {
        const isExpanded = expandedSections[section.id] ?? true;
        const sectionHasValues = section.items.some(
          (item) => item.hasValues || (item.children && item.children.some((child) => child.hasValues))
        );

        if (section.id === 'home' || section.id === 'summary') {
          const targetItem: MenuItem = {
            id: section.id,
            label: section.label,
            type: section.id as MenuItem['type'],
            hasValues: sectionHasValues
          };
          const isActive = selectedId === section.id;
          return (
            <div key={section.id} className="nav__section">
              <button
                type="button"
                className={`nav__title nav__title--link ${isActive ? 'nav__title--active' : ''}`}
                onClick={() => onSelect(targetItem)}
              >
                <span className="nav__title-label">
                  <span>{section.label}</span>
                  {section.id !== 'home' && sectionHasValues && <span className="nav__dot" aria-hidden="true" />}
                </span>
              </button>
            </div>
          );
        }

        return (
          <div key={section.id} className="nav__section">
            <button
              type="button"
              className="nav__title nav__title--toggle"
              onClick={() => toggleSection(section.id)}
              aria-expanded={isExpanded}
            >
              <span className="nav__title-label">
                <span>{section.label}</span>
                {sectionHasValues && <span className="nav__dot" aria-hidden="true" />}
              </span>
              <span className={`nav__chevron ${isExpanded ? 'nav__chevron--open' : ''}`} aria-hidden="true" />
            </button>
            {isExpanded && section.items.length > 0 && (
              <ul className="nav__list">
                {section.items.map((item) => {
                  const isActive = selectedId === item.id;
                  const isItemExpanded = activeDescriptorId === item.id || isActive;
                  return (
                    <li key={item.id} className="nav__list-item">
                      <button
                        type="button"
                        className={`nav__item ${isActive ? 'nav__item--active' : ''}`}
                        onClick={() => onSelect(item)}
                      >
                        <span className="nav__label">{item.label}</span>
                        {item.hasValues && <span className="nav__dot" aria-hidden="true" />}
                      </button>
                      {item.children && item.children.length && isItemExpanded && (
                        <ul className="nav__child-list">
                          {item.children.map((child) => {
                            const childActive = selectedId === child.id;
                            return (
                              <li key={child.id} className="nav__child-item">
                                <button
                                  type="button"
                                  className={`nav__item nav__item--child ${childActive ? 'nav__item--active' : ''}`}
                                  onClick={() => onSelect(child)}
                                >
                                  <span className="nav__label">{child.label}</span>
                                  {child.hasValues && <span className="nav__dot" aria-hidden="true" />}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
};

const MainTabs: React.FC<{
  schema: RJSFSchema;
  groups: SchemaGroups;
  formData: any;
  uiSchema: UiSchema;
  onSubsetChange: (keys: string[], subsetData: any) => void;
  descriptorOrder: string[];
  activeMainTab: string;
  setActiveMainTab: (id: string) => void;
  selectedCategory: string | null;
  setSelectedCategory: (id: string | null) => void;
  selectedDescriptor: string | null;
  setSelectedDescriptor: (id: string | null) => void;
  selectedScope: string | null;
  setSelectedScope: (id: string | null) => void;
  activeGeneralTheme: string | null;
  setActiveGeneralTheme: (id: string | null) => void;
  activeDescriptorThemes: Record<string, string>;
  setActiveDescriptorThemes: (value: Record<string, string>) => void;
  activeLinterThemes: Record<string, Record<string, string>>;
  setActiveLinterThemes: (value: Record<string, Record<string, string>>) => void;
  highlightedKeys: Set<string>;
  linterMetadata: Record<string, LinterDescriptorMetadata>;
}> = ({
  schema,
  groups,
  formData,
  uiSchema,
  onSubsetChange,
  descriptorOrder: descriptorOrderProp,
  activeMainTab,
  setActiveMainTab,
  selectedCategory,
  setSelectedCategory,
  selectedDescriptor,
  setSelectedDescriptor,
  selectedScope,
  setSelectedScope,
  activeGeneralTheme,
  setActiveGeneralTheme,
  activeDescriptorThemes,
  setActiveDescriptorThemes,
  activeLinterThemes,
  setActiveLinterThemes,
  highlightedKeys,
  linterMetadata
}) => {
  const descriptorOrder = useMemo(() => {
    if (descriptorOrderProp.length) {
      return descriptorOrderProp;
    }
    return Object.keys(groups.descriptorKeys).sort();
  }, [descriptorOrderProp, groups]);
  const presence = useMemo(() => buildPresenceMaps(groups, formData), [groups, formData]);
  const linterHasValues = presence.linterHasValues;
  const resolveCategoryLabel = (categoryId: string) => {
    const meta = groups.categoryMeta[categoryId];
    if (meta?.kind === 'linter' && meta.parentId && categoryId.startsWith(`${meta.parentId}_`)) {
      return prettifyId(categoryId.replace(`${meta.parentId}_`, ''));
    }
    if (meta?.label) {
      return prettifyId(meta.label);
    }
    return prettifyId(categoryId);
  };

  const compareCategories = (a: string, b: string) => {
    const orderA = groups.categoryMeta[a]?.order ?? Number.MAX_SAFE_INTEGER;
    const orderB = groups.categoryMeta[b]?.order ?? Number.MAX_SAFE_INTEGER;
    if (orderA === orderB) {
      return resolveCategoryLabel(a).localeCompare(resolveCategoryLabel(b));
    }
    return orderA - orderB;
  };

  const goHome = () => {
    setActiveMainTab('home');
    setSelectedCategory(null);
    setSelectedDescriptor(null);
    setSelectedScope(null);
  };

    const renderSummary = () => {
      const properties = (schema.properties as Record<string, any>) || {};
      const sectionOrder = groups.sectionMeta.order || [];
      const sectionLabels = groups.sectionMeta.labels || {};

      const configuredKeys = Object.keys(formData || {}).filter((key) => {
        const value = formData?.[key];
        if (value === undefined || value === null) {
          return false;
        }
        if (typeof value === 'string' && value.trim() === '') {
          return false;
        }
        if (Array.isArray(value) && value.length === 0) {
          return false;
        }
        return true;
      });

      const categoryKindRank: Record<string, number> = {
        generic: 1,
        descriptor: 2,
        linter: 3,
        other: 4
      };

      const resolveCategory = (key: string) => {
        const prop = properties[key] || {};
        const categoryId = prop['x-category'] as string | undefined;
        const meta = categoryId ? groups.categoryMeta[categoryId] : undefined;
        if (groups.generalKeys.includes(key)) {
          return { id: 'GENERAL', label: 'General', kind: 'generic' as const, meta: groups.categoryMeta['GENERAL'] };
        }
        const genericEntry = Object.entries(groups.genericCategoryKeys).find(([, keys]) => keys.includes(key));
        if (genericEntry) {
          const [id] = genericEntry;
          return { id, label: resolveCategoryLabel(id), kind: 'generic' as const, meta: groups.categoryMeta[id] };
        }
        const descriptorEntry = Object.entries(groups.descriptorKeys).find(([, keys]) => keys.includes(key));
        if (descriptorEntry) {
          const [id] = descriptorEntry;
          return { id, label: resolveCategoryLabel(id), kind: 'descriptor' as const, meta: groups.categoryMeta[id] };
        }
        const linterEntry = Object.entries(groups.linterKeys).find(([, linters]) =>
          Object.entries(linters).some(([, keys]) => keys.includes(key))
        );
        if (linterEntry) {
          const [descriptorId, linters] = linterEntry;
          const linterId = Object.keys(linters).find((l) => linters[l].includes(key));
          if (linterId) {
            return {
              id: linterId,
              label: resolveCategoryLabel(linterId),
              kind: 'linter' as const,
              meta: groups.categoryMeta[linterId],
              parent: descriptorId
            };
          }
        }
        if (meta) {
          return { id: meta.id, label: resolveCategoryLabel(meta.id), kind: meta.kind, meta };
        }
        return { id: 'OTHER', label: 'Other', kind: 'other' as const, meta: undefined };
      };

      const resolveSection = (key: string) => {
        const sectionId = typeof properties[key]?.['x-section'] === 'string' ? (properties[key]['x-section'] as string) : 'MISC';
        const index = sectionOrder.indexOf(sectionId);
        const sectionLabel = sectionLabels[sectionId] || prettifyId(sectionId);
        return { id: sectionId, index: index === -1 ? Number.MAX_SAFE_INTEGER : index, label: sectionLabel };
      };

      const orderedKeys = [...configuredKeys].sort((a, b) => {
        const catA = resolveCategory(a);
        const catB = resolveCategory(b);
        const kindA = catA.kind === 'generic' && catA.id === 'GENERAL' ? -1 : categoryKindRank[catA.kind] ?? 99;
        const kindB = catB.kind === 'generic' && catB.id === 'GENERAL' ? -1 : categoryKindRank[catB.kind] ?? 99;
        if (kindA !== kindB) {
          return kindA - kindB;
        }
        if (catA.label !== catB.label) {
          return catA.label.localeCompare(catB.label);
        }

        const secA = resolveSection(a);
        const secB = resolveSection(b);
        if (secA.index !== secB.index) {
          return secA.index - secB.index;
        }
        if (secA.label !== secB.label) {
          return secA.label.localeCompare(secB.label);
        }

        const orderA = typeof properties[a]?.['x-order'] === 'number' ? (properties[a]['x-order'] as number) : Number.MAX_SAFE_INTEGER;
        const orderB = typeof properties[b]?.['x-order'] === 'number' ? (properties[b]['x-order'] as number) : Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        return a.localeCompare(b);
      });

      if (!configuredKeys.length) {
        return (
          <div className="summary-panel">
            <Breadcrumbs
              items={[
                { id: 'home', label: 'MegaLinter home', onClick: goHome },
                { id: 'summary', label: 'Summary' }
              ]}
            />
            <p className="muted">No configuration values set yet.</p>
          </div>
        );
      }

      const summarySchema = buildSubsetSchema(schema, orderedKeys, 'Configured values');
      const summaryUiSchema = buildScopedUiSchema(schema, orderedKeys, uiSchema, highlightedKeys);

      return (
        <div className="summary-panel">
          <Breadcrumbs
            items={[
              { id: 'home', label: 'MegaLinter home', onClick: goHome },
              { id: 'summary', label: 'Summary' }
            ]}
          />
          <Form
            schema={summarySchema}
            formData={filterFormData(formData, orderedKeys)}
            onChange={(e) => {
              const data = e.formData;
              onSubsetChange(orderedKeys, data);
            }}
            validator={validator}
            uiSchema={summaryUiSchema}
            liveValidate
            noHtml5Validate
            showErrorList={false}
            widgets={{ dualList: DualListWidget }}
            templates={{ ArrayFieldTemplate: TagArrayFieldTemplate }}
            idPrefix="summary"
          >
            <></>
          </Form>
        </div>
      );
    };

  const renderGeneral = () => (
    <div className="general-panel">
      <Breadcrumbs
        items={[
          { id: 'home', label: 'MegaLinter home', onClick: goHome },
          { id: 'general', label: 'General settings' }
        ]}
      />
      <ThemedForm
        baseSchema={schema}
        keys={groups.generalKeys}
        title="General settings"
        uiSchema={uiSchema}
        formData={filterFormData(formData, groups.generalKeys)}
        onSubsetChange={(keys, subset) => onSubsetChange(keys, subset)}
        activeThemeTab={activeGeneralTheme}
        setActiveThemeTab={setActiveGeneralTheme}
        sectionMeta={groups.sectionMeta}
        highlightedKeys={highlightedKeys}
      />
    </div>
  );

  const renderCategory = () => {
    const categoryIds = Object.keys(groups.genericCategoryKeys);
    const categoryId =
      (selectedCategory && categoryIds.includes(selectedCategory) && selectedCategory) || categoryIds[0];

    if (!categoryId) {
      return (
        <div className="category-panel">
          <Breadcrumbs
            items={[
              { id: 'home', label: 'MegaLinter home', onClick: goHome },
              { id: 'category', label: 'Categories' }
            ]}
          />
          <p className="muted">No categories available</p>
        </div>
      );
    }

    const categoryKeys = groups.genericCategoryKeys[categoryId] || [];
    const label = resolveCategoryLabel(categoryId);

    const categoryOptions = categoryIds.map((id) => ({
      id,
      label: resolveCategoryLabel(id),
      onSelect: () => {
        setSelectedCategory(id);
        setActiveMainTab('category');
      }
    }));

    return (
      <div className="category-panel">
        <Breadcrumbs
          items={[
            { id: 'home', label: 'MegaLinter home', onClick: goHome },
            { id: categoryId, label, options: categoryOptions }
          ]}
        />
        <ThemedForm
          baseSchema={schema}
          keys={categoryKeys}
          title={`${label} settings`}
          uiSchema={uiSchema}
          formData={filterFormData(formData, categoryKeys)}
          onSubsetChange={(keys, subset) => onSubsetChange(keys, subset)}
          activeThemeTab={activeDescriptorThemes[categoryId] || null}
          setActiveThemeTab={(id) =>
            setActiveDescriptorThemes({ ...activeDescriptorThemes, [categoryId]: id || '' })
          }
          sectionMeta={groups.sectionMeta}
          highlightedKeys={highlightedKeys}
        />
      </div>
    );
  };

  const renderDescriptorArea = () => {
    const descriptorId = selectedDescriptor || descriptorOrder[0];
    if (!descriptorId) {
      return <p className="muted">No descriptors available</p>;
    }

    const descriptorKeys = groups.descriptorKeys[descriptorId] || [];
    const linters = groups.linterKeys[descriptorId] || {};
    const linterValueMap = linterHasValues[descriptorId] || {};

    const linterEntries = Object.entries(linters).sort(([a], [b]) => compareCategories(a, b));

    const scopeOptions: Tab[] = [
      {
        id: 'descriptor',
        label: `${resolveCategoryLabel(descriptorId)} variables${hasAnyKeySet(descriptorKeys, formData) ? ' *' : ''}`
      },
      ...linterEntries.map(([linter]) => ({
        id: linter,
        label: `${resolveCategoryLabel(linter)}${linterValueMap[linter] ? ' *' : ''}`,
        hasValues: linterValueMap[linter]
      }))
    ];

    const activeScope = scopeOptions.find((opt) => opt.id === selectedScope)?.id || scopeOptions[0]?.id;

    const descriptorBreadcrumbOptions = descriptorOrder.map((id) => ({
      id,
      label: resolveCategoryLabel(id),
      onSelect: () => {
        setSelectedDescriptor(id);
        setSelectedScope('descriptor');
      }
    }));

    const scopeBreadcrumbOptions = scopeOptions.map((opt) => ({
      id: opt.id,
      label: opt.id === 'descriptor' ? 'Variables' : resolveCategoryLabel(opt.id),
      onSelect: () => {
        setSelectedDescriptor(descriptorId);
        setSelectedScope(opt.id);
      }
    }));

    const breadcrumbItems = [
      { id: 'home', label: 'MegaLinter home', onClick: goHome },
      {
        id: descriptorId,
        label: resolveCategoryLabel(descriptorId),
        options: descriptorBreadcrumbOptions
      },
      {
        id: activeScope,
        label:
          activeScope === 'descriptor'
            ? 'Variables'
            : resolveCategoryLabel(activeScope),
        options: scopeBreadcrumbOptions
      }
    ];

    const descriptorForm = (
      <ThemedForm
        baseSchema={schema}
        keys={descriptorKeys}
        title={`${resolveCategoryLabel(descriptorId)} variables`}
        uiSchema={uiSchema}
        formData={filterFormData(formData, descriptorKeys)}
        onSubsetChange={(keys, subset) => onSubsetChange(keys, subset)}
        activeThemeTab={activeDescriptorThemes[descriptorId] || null}
        setActiveThemeTab={(id) =>
          setActiveDescriptorThemes({ ...activeDescriptorThemes, [descriptorId]: id || '' })
        }
        prefixToStrip={`${descriptorId}_`}
        sectionMeta={groups.sectionMeta}
        highlightedKeys={highlightedKeys}
      />
    );

    const linterForm = (linterKey: string, keys: string[]) => {
      const linterLabel = resolveCategoryLabel(linterKey);
      const introTab = {
        id: 'description',
        label: 'Description',
        content: (
          <LinterDescription
            metadata={linterMetadata[linterKey]}
            linterLabel={linterLabel}
          />
        )
      };

      return (
        <ThemedForm
          baseSchema={schema}
          keys={keys}
          title={`${linterLabel} linter`}
          uiSchema={uiSchema}
          formData={filterFormData(formData, keys)}
          onSubsetChange={(k, subset) => onSubsetChange(k, subset)}
          activeThemeTab={activeLinterThemes[descriptorId]?.[linterKey] || null}
          setActiveThemeTab={(id) =>
            setActiveLinterThemes({
              ...activeLinterThemes,
              [descriptorId]: {
                ...(activeLinterThemes[descriptorId] || {}),
                [linterKey]: id || ''
              }
            })
          }
          prefixToStrip={`${linterKey}_`}
          sectionMeta={groups.sectionMeta}
          highlightedKeys={highlightedKeys}
          introTab={introTab}
        />
      );
    };

    const activeContent =
      activeScope === 'descriptor'
        ? descriptorForm
        : linterForm(activeScope, linters[activeScope] || []);

    return (
      <div className="descriptor-panel">
        <Breadcrumbs items={breadcrumbItems} />
        <div className="tab-content">{activeContent}</div>
      </div>
    );
  };

  if (activeMainTab === 'summary') {
    return renderSummary();
  }

  if (activeMainTab === 'general') {
    return renderGeneral();
  }

  if (activeMainTab === 'category') {
    return renderCategory();
  }

  return renderDescriptorArea();
};

const TabBar: React.FC<{
  tabs: Tab[];
  activeTab: string;
  onSelect: (id: string) => void;
}> = ({ tabs, activeTab, onSelect }) => (
  <div className="tabs">
    {tabs.map((tab) => (
      <button
        key={tab.id}
        className={`tab ${activeTab === tab.id ? 'active' : ''}`}
        onClick={() => onSelect(tab.id)}
        type="button"
      >
        {tab.hasValues ? `${tab.label} *` : tab.label}
      </button>
    ))}
  </div>
);

type BreadcrumbOption = { id: string; label: string; onSelect: () => void };

const Breadcrumbs: React.FC<{
  items: Array<{ id: string; label: string; onClick?: () => void; options?: BreadcrumbOption[] }>;
}> = ({ items }) => {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="breadcrumbs" aria-label="Navigation breadcrumb">
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        const hasOptions = !!(item.options && item.options.length > 0);
        const isOpen = openId === item.id;

        const handleSelect = (optId: string) => {
          const match = item.options?.find((opt) => opt.id === optId);
          match?.onSelect();
          setOpenId(null);
        };

        return (
          <span key={item.id} className="breadcrumbs__item">
            {hasOptions ? (
              <div className="breadcrumbs__menu-wrapper">
                <button
                  type="button"
                  className="breadcrumbs__link breadcrumbs__link--menu"
                  onClick={() => setOpenId(isOpen ? null : item.id)}
                >
                  {item.label}
                  <span className={`breadcrumbs__chevron ${isOpen ? 'breadcrumbs__chevron--open' : ''}`} />
                </button>
                {isOpen && (
                  <ul className="breadcrumbs__menu">
                    {item.options?.map((opt) => (
                      <li key={opt.id}>
                        <button type="button" onClick={() => handleSelect(opt.id)}>
                          {opt.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : item.onClick ? (
              <button type="button" className="breadcrumbs__link" onClick={item.onClick}>
                {item.label}
              </button>
            ) : (
              <span className="breadcrumbs__current">{item.label}</span>
            )}
            {!isLast && <span className="breadcrumbs__sep">/</span>}
          </span>
        );
      })}
    </div>
  );
};

const LinterDescription: React.FC<{
  metadata?: LinterDescriptorMetadata;
  linterLabel: string;
}> = ({ metadata, linterLabel }) => {
  const title = metadata?.linterName || metadata?.name || linterLabel;
  const link = metadata?.url || metadata?.repo;
  const linkLabel = link ? link.replace(/^https?:\/\//i, '') : '';
  const image = metadata?.bannerImageUrl || metadata?.imageUrl;
  const description = metadata?.text?.trim();
  const links = metadata?.urls || [];
  const html = useMemo(() => (description ? marked.parse(description) : ''), [description]);

  return (
    <div className="linter-description">
      <div className="linter-description__header">
        {image && <img src={image} alt={`${title} logo`} className="linter-description__image" />}
        <div className="linter-description__titles">
          <p className="eyebrow">Linter overview</p>
          <h3 className="linter-description__name">{title}</h3>
          {link && (
            <a className="linter-description__link" href={link} target="_blank" rel="noreferrer">
              {linkLabel || 'Open linter homepage'}
            </a>
          )}
        </div>
      </div>
      <div className="linter-description__body">
        {description ? (
          <div className="linter-description__text" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <p className="muted">No description available for this linter yet.</p>
        )}
        {links.length > 0 && (
          <div className="linter-description__links">
            <p className="eyebrow">Links</p>
            <ul className="linter-description__link-list">
              {links.map((item) => {
                const label = item.label || item.href.replace(/^https?:\/\//i, '');
                return (
                  <li key={item.href}>
                    <a className="linter-description__link" href={item.href} target="_blank" rel="noreferrer">
                      {label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

const ThemedForm: React.FC<{
  baseSchema: RJSFSchema;
  keys: string[];
  title: string;
  uiSchema: UiSchema;
  formData: any;
  onSubsetChange: (keys: string[], subset: any) => void;
  activeThemeTab: string | null;
  setActiveThemeTab: (id: string | null) => void;
  sectionMeta: SchemaGroups['sectionMeta'];
  prefixToStrip?: string;
  highlightedKeys: Set<string>;
  introTab?: { id: string; label: string; content: ReactNode };
}> = ({
  baseSchema,
  keys,
  title,
  uiSchema,
  formData,
  onSubsetChange,
  activeThemeTab,
  setActiveThemeTab,
  sectionMeta,
  prefixToStrip,
  highlightedKeys,
  introTab
}) => {
  const filteredKeys = useMemo(
    () => keys.filter((key) => !isDeprecatedPropertyTitle(baseSchema, key)),
    [keys, baseSchema]
  );

  const { tabs, grouped } = useMemo(
    () => groupKeysByTheme(filteredKeys, prefixToStrip, formData, baseSchema, sectionMeta),
    [filteredKeys, prefixToStrip, formData, baseSchema, sectionMeta]
  );

  const combinedTabs = useMemo<Tab[]>(
    () => (introTab ? [{ id: introTab.id, label: introTab.label }, ...tabs] : tabs),
    [introTab, tabs]
  );

  const effectiveActive = useMemo(() => {
    if (activeThemeTab && combinedTabs.some((t) => t.id === activeThemeTab)) {
      return activeThemeTab;
    }
    return combinedTabs[0]?.id || null;
  }, [activeThemeTab, combinedTabs]);

  useEffect(() => {
    if (!activeThemeTab && combinedTabs[0]) {
      setActiveThemeTab(combinedTabs[0].id);
    }
  }, [activeThemeTab, combinedTabs, setActiveThemeTab]);

  if (!combinedTabs.length) {
    return <p className="muted">No fields available</p>;
  }

  const isIntroTabActive = introTab && effectiveActive === introTab.id;
  const activeKeys = !isIntroTabActive && effectiveActive ? grouped[effectiveActive] || [] : [];
  const activeLabel = combinedTabs.find((t) => t.id === effectiveActive)?.label || title;
  const widgets = useMemo(() => ({ dualList: DualListWidget }), []);
  const templates = useMemo(() => ({ ArrayFieldTemplate: TagArrayFieldTemplate }), []);

  if (!filteredKeys.length && !introTab) {
    return <p className="muted">No fields available</p>;
  }

  return (
    <div className="tab-content">
      {combinedTabs.length > 1 && (
        <TabBar tabs={combinedTabs} activeTab={effectiveActive || ''} onSelect={(id) => setActiveThemeTab(id)} />
      )}
      {isIntroTabActive && introTab ? (
        <div className="linter-description__panel">{introTab.content}</div>
      ) : (
        <Form
          key={`${title}-${effectiveActive || 'default'}`}
          schema={buildSubsetSchema(baseSchema, activeKeys, `${title} - ${activeLabel}`, prefixToStrip)}
          uiSchema={buildScopedUiSchema(baseSchema, activeKeys, uiSchema, highlightedKeys)}
          formData={filterFormData(formData, activeKeys)}
          validator={validator}
          templates={templates}
          widgets={widgets}
          onChange={({ formData: subset }) => onSubsetChange(activeKeys, subset)}
          liveValidate={false}
          showErrorList="bottom"
        />
      )}
    </div>
  );
};

const TagArrayFieldTemplate: React.FC<ArrayFieldTemplateProps> = (props) => {
  const { items, canAdd, onAddClick, title, schema, formData, disabled, readonly } = props;
  const itemType = (schema as any)?.items?.type;
  const enumValues = Array.isArray((schema as any)?.items?.enum)
    ? (schema as any).items.enum
    : undefined;
  const isStringArray = itemType === 'string' || (Array.isArray(itemType) && itemType.includes('string'));
  const isFreeStringArray = isStringArray && !enumValues;
  const values = Array.isArray(formData)
    ? (formData as unknown[]).filter((v) => v !== undefined && v !== null)
    : [];
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (disabled || readonly) {
      setIsEditing(false);
    }
  }, [disabled, readonly]);

  if (isFreeStringArray) {
    if (!isEditing) {
      return (
        <div className="string-list string-list--view">
          {title && <p className="tag-array__title">{title}</p>}
          {schema?.description && <p className="field-description">{schema.description}</p>}
          {values.length ? (
            <ul className="dual-list__chips">
              {values.map((val, idx) => (
                <li key={`${idx}-${String(val)}`} className="dual-list__chip">
                  {String(val)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">None set</p>
          )}
          <div className="string-list__controls">
            <button
              type="button"
              className="dual-list__save"
              onClick={() => setIsEditing(true)}
              disabled={disabled || readonly}
            >
              Edit
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="string-list string-list--edit">
        {title && <p className="tag-array__title">{title}</p>}
        {schema?.description && <p className="field-description">{schema.description}</p>}
        <div className="string-list__rows">
          {items.map((item) => (
            <div key={item.key} className="string-list__row">
              <div className="string-list__input">{item.children}</div>
              {item.hasRemove && (
                <button
                  type="button"
                  className="pill-remove string-list__remove"
                  onClick={item.onDropIndexClick(item.index)}
                  aria-label="Remove item"
                >
                  -
                </button>
              )}
            </div>
          ))}
          {canAdd && (
            <button
              type="button"
              className="pill-add pill-add--inline string-list__add"
              onClick={(event) => onAddClick(event)}
              aria-label="Add item"
            >
              + Add string item
            </button>
          )}
        </div>
        <div className="string-list__footer">
          <button
            type="button"
            className="dual-list__save"
            onClick={() => setIsEditing(false)}
            disabled={disabled || readonly}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tag-array">
      {title && <p className="tag-array__title">{title}</p>}
      {schema?.description && <p className="field-description">{schema.description}</p>}
      <div className="tag-array__items">
        {items.map((item) => (
          <div key={item.key} className={`tag-pill ${isStringArray ? 'tag-pill--string' : ''}`}>
            <div className="tag-pill__field">{item.children}</div>
            {item.hasRemove && (
              <button
                type="button"
                className="pill-remove"
                onClick={item.onDropIndexClick(item.index)}
                aria-label="Remove item"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {canAdd && (
          <button
            type="button"
            className="pill-add pill-add--inline"
            onClick={(event) => onAddClick(event)}
            aria-label="Add item"
          >
            + Add
          </button>
        )}
      </div>
    </div>
  );
};

const DualListWidget: React.FC<WidgetProps> = ({
  value,
  onChange,
  options,
  disabled,
  readonly,
  label,
  id,
  schema,
  registry
}) => {
  const rootSchema = registry?.rootSchema as RJSFSchema | undefined;
  const schemaUtils = registry?.schemaUtils;

  const resolveEnumOptions = (node: any): Array<{ value: any; label: string }> | undefined => {
    if (!node) {
      return undefined;
    }

    const resolveWithNames = (schemaNode: any) => {
      const values = Array.isArray(schemaNode?.enum) ? schemaNode.enum : undefined;
      if (!values) {
        return undefined;
      }
      const names = Array.isArray(schemaNode?.enumNames) ? schemaNode.enumNames : undefined;
      return values.map((v: any, idx: number) => ({ value: v, label: names?.[idx] ?? String(v) }));
    };

    const resolved = schemaUtils?.retrieveSchema ? schemaUtils.retrieveSchema(node, rootSchema) : node;
    const direct = resolveWithNames(resolved);
    if (direct) {
      return direct;
    }

    const ref = typeof node.$ref === 'string' ? node.$ref : undefined;
    if (ref && ref.startsWith('#/definitions/') && rootSchema?.definitions) {
      const defKey = ref.replace('#/definitions/', '');
      const def = (rootSchema.definitions as Record<string, any>)[defKey];
      const fromDef = resolveWithNames(def);
      if (fromDef) {
        return fromDef;
      }
    }
    return undefined;
  };

  const enumOptions = useMemo(() => {
    if (options.enumOptions && options.enumOptions.length) {
      return options.enumOptions as Array<{ value: any; label: string }>;
    }

    const itemSchema = (schema as any)?.items;
    return resolveEnumOptions(itemSchema) || [];
  }, [options.enumOptions, schema, rootSchema]);
  const selectedValues = Array.isArray(value) ? value : [];
  const [draft, setDraft] = useState<string[]>(selectedValues);
  const [isEditing, setIsEditing] = useState(false);
  const selectedSet = new Set(isEditing ? draft : selectedValues);
  const valueMap = useMemo(() => {
    const map = new Map<string, any>();
    enumOptions.forEach((opt) => {
      map.set(String(opt.value), opt.value);
    });
    return map;
  }, [enumOptions]);

  const available = enumOptions.filter((opt) => !selectedSet.has(opt.value));
  const selected = enumOptions.filter((opt) => selectedSet.has(opt.value));

  const [availableSelected, setAvailableSelected] = useState<string[]>([]);
  const [chosenSelected, setChosenSelected] = useState<string[]>([]);

  useEffect(() => {
    // Keep draft in sync when not editing; clear transient selections on change
    if (!isEditing) {
      setDraft(selectedValues);
    }
    setAvailableSelected([]);
    setChosenSelected([]);
  }, [selectedValues, isEditing]);

  const addSelected = () => {
    if (readonly || disabled) {
      return;
    }
    const toAdd = availableSelected
      .map((v) => valueMap.get(String(v)))
      .filter((v): v is any => v !== undefined && !selectedSet.has(v));
    if (toAdd.length === 0) {
      return;
    }
    setDraft((prev) => [...prev, ...toAdd]);
    setAvailableSelected([]);
  };

  const removeSelected = () => {
    if (readonly || disabled) {
      return;
    }
    if (chosenSelected.length === 0) {
      return;
    }
    const removeSet = new Set(
      chosenSelected
        .map((v) => valueMap.get(String(v)))
        .filter((v): v is any => v !== undefined)
    );
    setDraft((prev) => prev.filter((v) => !removeSet.has(v)));
    setChosenSelected([]);
  };

  const handleSave = () => {
    onChange(draft);
    setIsEditing(false);
  };

  if (!isEditing) {
    return (
      <div className="dual-list dual-list--view" aria-label={label} id={id}>
        <div className="dual-list__pane dual-list__pane--view">
          {selected.length ? (
            <ul className="dual-list__chips">
              {selected.map((opt) => (
                <li key={opt.value} className="dual-list__chip">
                  {opt.label}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">None selected</p>
          )}
        </div>
        <div className="dual-list__controls dual-list__controls--view">
          <button type="button" onClick={() => setIsEditing(true)} disabled={disabled || readonly}>
            Edit
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dual-list" aria-label={label} id={id}>
      <div className="dual-list__pane">
        <div className="dual-list__title">Available</div>
        <select
          multiple
          value={availableSelected}
          onChange={(e) => {
            const opts = Array.from(e.target.selectedOptions).map((o) => o.value as string);
            setAvailableSelected(opts);
          }}
          disabled={disabled || readonly}
        >
          {available.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="dual-list__controls">
        <button type="button" onClick={addSelected} disabled={disabled || readonly || availableSelected.length === 0}>
          &gt;
        </button>
        <button type="button" onClick={removeSelected} disabled={disabled || readonly || chosenSelected.length === 0}>
          &lt;
        </button>
      </div>
      <div className="dual-list__pane">
        <div className="dual-list__title">Selected</div>
        <select
          multiple
          value={chosenSelected}
          onChange={(e) => {
            const opts = Array.from(e.target.selectedOptions).map((o) => o.value as string);
            setChosenSelected(opts);
          }}
          disabled={disabled || readonly}
        >
          {selected.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="dual-list__footer">
        <button type="button" className="dual-list__save" onClick={handleSave} disabled={disabled || readonly}>
          Save
        </button>
      </div>
    </div>
  );
};
