/* eslint-disable @typescript-eslint/naming-convention */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { RJSFSchema, UiSchema } from '@rjsf/utils';
import bundledSchema from '../descriptors/schemas/megalinter-configuration.jsonschema.json';
import { extractGroups, filterRemovedLintersFromSchema, SchemaGroups } from '../shared/schemaUtils';
import {
  buildNavigationModel,
  computeNonDefaultKeys,
  prettifyId,
  pruneDefaults
} from './menuUtils';
import './styles.css';
import megalinterBannerLocal from './assets/megalinter-banner.png';

import {
  HomePanel,
  NavigationMenu,
  MainTabs
} from './components';

import {
  useVSCodeApi,
  useNavigationState
} from './hooks';

import type {
  CachedSchema,
  LinterMetadataMap,
  MegaLinterConfig,
  NavigationTarget,
  PersistedState,
  VSCodeAPI,
  WebViewMessage
} from './types';

const OX_SECURITY_LOGO = 'https://www.ox.security/wp-content/uploads/2025/10/logo-short-new.svg';
const OX_SECURITY_LOGO_FALLBACK = 'https://avatars.githubusercontent.com/u/89921661?s=200&v=4';
const MEGALINTER_BANNER_URL =
  'https://github.com/oxsecurity/megalinter/raw/main/docs/assets/images/megalinter-banner.png';
const MEGALINTER_BANNER_FALLBACK = megalinterBannerLocal;

const SCHEMA_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const App: React.FC = () => {
  const { state: persistedState, updateState, postMessage } = useVSCodeApi();
  
  const [schema, setSchema] = useState<RJSFSchema | null>(null);
  const [groups, setGroups] = useState<SchemaGroups | null>(null);
  const [formData, setFormData] = useState<MegaLinterConfig>({});
  const [originalConfig, setOriginalConfig] = useState<MegaLinterConfig>({});
  const [configLoaded, setConfigLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configPath, setConfigPath] = useState<string>('');
  const [configExists, setConfigExists] = useState<boolean>(false);
  const [linterMetadata, setLinterMetadata] = useState<LinterMetadataMap>({});
  const [cachedSchema, setCachedSchema] = useState<CachedSchema | null>(null);
  const [initialStateReady, setInitialStateReady] = useState(false);

  const {
    activeMainTab,
    setActiveMainTab,
    selectedCategory,
    setSelectedCategory,
    selectedDescriptor,
    setSelectedDescriptor,
    selectedScope,
    setSelectedScope,
    handleNavigationSelect,
    applyNavigation,
    openSummary,
    openGeneral,
    openCategory,
    openDescriptor
  } = useNavigationState(persistedState);

  const [activeGeneralTheme, setActiveGeneralTheme] = useState<string | null>(
    persistedState?.activeGeneralTheme || null
  );
  const [activeDescriptorThemes, setActiveDescriptorThemes] = useState<Record<string, string>>(
    persistedState?.activeDescriptorThemes || {}
  );
  const [activeLinterThemes, setActiveLinterThemes] = useState<Record<string, Record<string, string>>>(
    persistedState?.activeLinterThemes || {}
  );
  
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
    const isValueSet = (value: unknown) => {
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
    updateState(viewState);
  }, [
    activeMainTab,
    selectedCategory,
    selectedDescriptor,
    selectedScope,
    activeGeneralTheme,
    activeDescriptorThemes,
    activeLinterThemes,
    cachedSchema,
    updateState
  ]);

  useEffect(() => {
    const saved = persistedState;
    if (saved) {
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

  const queueSave = (data: MegaLinterConfig) => {
    if (!schema || !configLoaded) {
      return;
    }

    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
    }

    const timerId = window.setTimeout(() => {
      const pruned = pruneDefaults(data, originalConfig, schema);
      postMessage({ type: 'saveConfig', config: pruned });
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
          postMessage({
            type: 'info',
            message: 'Using bundled MegaLinter schema (remote fetch unavailable).'
          });
        } catch (fallbackErr) {
          const errorMessage =
            fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          setError(`Failed to load MegaLinter schema: ${errorMessage}`);
          postMessage({
            type: 'error',
            message: `Failed to load MegaLinter schema: ${errorMessage}`
          });
        }
      } finally {
        setLoading(false);
      }
    };

    fetchSchema();
    postMessage({ type: 'getConfig' });
    postMessage({ type: 'ready' });

    const messageHandler = (event: MessageEvent) => {
      const message = event.data as WebViewMessage;
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

  const handleSubsetChange = (keys: string[], subsetData: MegaLinterConfig) => {
    setFormData((prev: MegaLinterConfig) => {
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
