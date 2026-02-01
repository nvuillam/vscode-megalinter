/* eslint-disable @typescript-eslint/naming-convention */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import '@vscode/codicons/dist/codicon.css';
import type { RJSFSchema, UiSchema } from '@rjsf/utils';
import bundledSchema from '../descriptors/schemas/megalinter-configuration.jsonschema.json';
import { extractGroups, filterRemovedLintersFromSchema, SchemaGroups } from '../shared/schemaUtils';
import {
  buildNavigationModel,
  computeNonDefaultKeys,
  deepEqual,
  prettifyId,
  pruneDefaults,
  sanitizeConfigForSave
} from './menuUtils';
import './styles.css';
import megalinterBannerLocal from './assets/megalinter-banner.png';

import {
  HomePanel,
  NavigationMenu,
  MainTabs,
  LoadingOverlay
} from './components';

import {
  useVSCodeApi,
  useNavigationState
} from './hooks';

import type {
  CachedSchema,
  LinterConfigFileInfo,
  LinterMetadataMap,
  MegaLinterConfig,
  NavigationTarget,
  PersistedState,
  VSCodeAPI,
  WebViewMessage,
  SearchItem
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
  const [inheritedConfig, setInheritedConfig] = useState<MegaLinterConfig>({});
  const [inheritedKeySources, setInheritedKeySources] = useState<Record<string, string>>({});
  const [extendsItems, setExtendsItems] = useState<string[]>([]);
  const [, setExtendsErrors] = useState<string[]>([]);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configPath, setConfigPath] = useState<string>('');
  const [configExists, setConfigExists] = useState<boolean>(false);
  const [linterMetadata, setLinterMetadata] = useState<LinterMetadataMap>({});
  const [linterConfigFiles, setLinterConfigFiles] = useState<Record<string, LinterConfigFileInfo>>({});
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

  const referenceDataLoading = useMemo(() => {
    // Consider ref data ready only once schema/groups + config (which includes descriptor metadata) are loaded.
    return !schema || !groups || !configLoaded;
  }, [schema, groups, configLoaded]);

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

  const linterCount = useMemo(() => {
    if (!groups) {
      return 0;
    }
    return Object.values(groups.linterKeys || {}).reduce((acc, linters) => {
      return acc + Object.keys(linters || {}).length;
    }, 0);
  }, [groups]);

  const searchItems = useMemo(() => {
    if (!groups) {
      return [];
    }
    const items: SearchItem[] = [];

    // Descriptors
    Object.keys(groups.descriptorKeys).forEach((id) => {
      const meta = groups.categoryMeta[id];
      items.push({
        id,
        label: prettifyId(meta?.label || id),
        type: 'descriptor',
        descriptorId: id
      });
    });

    // Reporters (Generic Categories)
    Object.keys(groups.genericCategoryKeys).forEach((id) => {
      const meta = groups.categoryMeta[id];
      items.push({
        id,
        label: prettifyId(meta?.label || id),
        type: 'reporter',
        categoryId: id
      });
    });

    // Linters
    Object.entries(groups.linterKeys).forEach(([descriptorId, linters]) => {
      const descriptorLabel = prettifyId(descriptorId);
      Object.keys(linters).forEach((linterId) => {
        const meta = groups.categoryMeta[linterId];
        // Try to get a cleaner label if possible, otherwise prettify ID
        let label = prettifyId(meta?.label || linterId);

        // Remove descriptor name prefix if present to avoid duplication
        if (label.toLowerCase().startsWith(descriptorLabel.toLowerCase() + ' ')) {
          label = label.substring(descriptorLabel.length + 1);
        }
        
        items.push({
          id: linterId,
          label: `${label} (${descriptorLabel})`, // Add context
          type: 'linter',
          descriptorId,
          linterId
        });
      });
    });

    return items.sort((a, b) => a.label.localeCompare(b.label));
  }, [groups]);

  const handleSearchSelect = (item: SearchItem) => {
    if (item.type === 'descriptor' && item.descriptorId) {
      openDescriptor(item.descriptorId, 'descriptor');
    } else if (item.type === 'reporter' && item.categoryId) {
      openCategory(item.categoryId);
    } else if (item.type === 'linter' && item.descriptorId && item.linterId) {
      openDescriptor(item.descriptorId, item.linterId);
    }
  };

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

    const hasTransientArrayEntries = (value: unknown): boolean => {
      const visit = (node: unknown, inArray: boolean): boolean => {
        if (inArray) {
          if (node === null || node === undefined) {
            return true;
          }
          if (typeof node === 'string' && node.trim() === '') {
            return true;
          }
        }

        if (Array.isArray(node)) {
          return node.some((item) => visit(item, true));
        }

        if (node && typeof node === 'object') {
          return Object.values(node as Record<string, unknown>).some((entry) => visit(entry, false));
        }

        return false;
      };

      return visit(value, false);
    };

    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
    }

    // Avoid writing intermediate/blank array values (e.g. "- null") while the user is
    // adding a new item and has not typed yet. Saving those values causes a round-trip
    // that resets the form immediately.
    if (hasTransientArrayEntries(data)) {
      saveTimer.current = null;
      return;
    }

    const timerId = window.setTimeout(() => {
      const sanitized = sanitizeConfigForSave(data);

      const hasExtends =
        extendsItems.length > 0 ||
        (typeof (sanitized as any)?.EXTENDS === 'string' && String((sanitized as any).EXTENDS).trim() !== '') ||
        (Array.isArray((sanitized as any)?.EXTENDS) && (sanitized as any).EXTENDS.length > 0);

      if (!hasExtends) {
        const pruned = pruneDefaults(sanitized, originalConfig, schema);
        postMessage({ type: 'saveConfig', config: pruned });
        return;
      }

      // EXTENDS mode: save only local overrides (diff vs inherited config), plus the EXTENDS key.
      const computeLocalConfigForSave = (
        effective: MegaLinterConfig,
        originalLocal: MegaLinterConfig,
        inherited: MegaLinterConfig
      ): MegaLinterConfig => {
        const result: MegaLinterConfig = { ...(originalLocal || {}) };

        const keys = new Set<string>([
          ...Object.keys(result || {}),
          ...Object.keys(effective || {}),
          ...Object.keys(inherited || {})
        ]);

        keys.forEach((key) => {
          if (!key) {
            return;
          }

          const effectiveHas = Object.prototype.hasOwnProperty.call(effective || {}, key);
          const effectiveValue = effectiveHas ? effective[key] : undefined;

          if (key === 'EXTENDS') {
            if (effectiveHas && effectiveValue !== undefined && effectiveValue !== null) {
              if (typeof effectiveValue === 'string') {
                if (effectiveValue.trim() === '') {
                  delete result[key];
                } else {
                  result[key] = effectiveValue;
                }
              } else if (Array.isArray(effectiveValue)) {
                if (effectiveValue.length === 0) {
                  delete result[key];
                } else {
                  result[key] = effectiveValue;
                }
              } else {
                result[key] = effectiveValue;
              }
            } else {
              delete result[key];
            }
            return;
          }

          const inheritedHas = Object.prototype.hasOwnProperty.call(inherited || {}, key);
          const inheritedValue = inheritedHas ? inherited[key] : undefined;
          const equalsInherited = inheritedHas
            ? deepEqual(effectiveValue, inheritedValue)
            : effectiveValue === undefined;

          if (!equalsInherited) {
            if (!effectiveHas || effectiveValue === undefined) {
              delete result[key];
            } else {
              result[key] = effectiveValue;
            }
            return;
          }

          const originalHas = Object.prototype.hasOwnProperty.call(originalLocal || {}, key);
          const originalValue = originalHas ? originalLocal[key] : undefined;
          const originalEqualsInherited = inheritedHas
            ? deepEqual(originalValue, inheritedValue)
            : originalValue === undefined;

          // If this key used to be a meaningful override but is now the same as inherited,
          // drop it so the local file stays minimal.
          if (originalHas && !originalEqualsInherited) {
            delete result[key];
            return;
          }

          // Otherwise, preserve the key only if it was already present in the local file.
          if (!originalHas) {
            delete result[key];
          }
        });

        return result;
      };

      const localToSave = computeLocalConfigForSave(sanitized, originalConfig, inheritedConfig);
      const finalSanitized = sanitizeConfigForSave(localToSave);
      postMessage({ type: 'saveConfig', config: finalSanitized });
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
        const response = await axios.get<RJSFSchema>(remoteSchemaUrl, {
          signal: controller.signal,
          timeout: 8000,
        });
        window.clearTimeout(timeoutId);

        const schemaData = response.data;
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
        setOriginalConfig(message.localConfig || message.config || {});
        setInheritedConfig(message.inheritedConfig || {});
        setInheritedKeySources(message.inheritedKeySources || {});
        setExtendsItems(message.extendsItems || []);
        setExtendsErrors(message.extendsErrors || []);
        setConfigPath(message.configPath);
        setConfigExists(!!message.configExists);
        setLinterMetadata(message.linterMetadata || {});
        setConfigLoaded(true);
      } else if (message.type === 'linterConfigFileInfo') {
        setLinterConfigFiles((prev) => ({
          ...prev,
          [message.linterKey]: {
            linterKey: message.linterKey,
            resolved: message.resolved,
            configFileName: message.configFileName,
            rulesPath: message.rulesPath,
            local: message.local,
            defaultTemplate: message.defaultTemplate
          }
        }));
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

  // While reference data is loading, force the UI to stay on Home.
  useEffect(() => {
    if (!referenceDataLoading) {
      return;
    }
    setActiveMainTab('home');
    setSelectedCategory(null);
    setSelectedDescriptor(null);
    setSelectedScope(null);
  }, [referenceDataLoading, setActiveMainTab, setSelectedCategory, setSelectedDescriptor, setSelectedScope]);

  const selectedNavId = referenceDataLoading
    ? 'home'
    : activeMainTab === 'home'
      ? 'home'
      : activeMainTab === 'general'
        ? 'general'
        : activeMainTab === 'summary'
          ? 'summary'
          : activeMainTab === 'category'
            ? selectedCategory || ''
            : selectedScope || selectedDescriptor || '';

  const effectiveSections = navigationModel?.sections || [
    { id: 'home', label: 'Home', items: [] }
  ];

  const showHome = referenceDataLoading || activeMainTab === 'home';
  const isConfigLoading = !configLoaded;

  return (
    <div className="container">
      <div className="layout">
        <div className="form-container">
          {showHome ? (
            <HomePanel
              configPath={configPath}
              configExists={configExists}
              configLoaded={configLoaded}
              referenceDataLoading={referenceDataLoading}
              configuredCount={configuredKeyCount}
              totalKeys={totalSchemaKeys}
              linterCount={linterCount}
              postMessage={postMessage}
              onOpenGeneral={openGeneral}
              onOpenSummary={openSummary}
              logoUrl={OX_SECURITY_LOGO}
              logoFallbackUrl={OX_SECURITY_LOGO_FALLBACK}
              bannerUrl={MEGALINTER_BANNER_URL}
              bannerFallbackUrl={MEGALINTER_BANNER_FALLBACK}
              hasConfiguration={configuredKeyCount > 0}
              searchItems={searchItems}
              onSearchSelect={handleSearchSelect}
            />
          ) : (
            <MainTabs
              schema={schema as RJSFSchema}
              groups={groups as SchemaGroups}
              formData={formData}
              originalConfig={originalConfig}
              inheritedConfig={inheritedConfig}
              inheritedKeySources={inheritedKeySources}
              uiSchema={uiSchema}
              onSubsetChange={handleSubsetChange}
              postMessage={postMessage}
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
              linterConfigFiles={linterConfigFiles}
            />
          )}
        </div>
        <div className="nav-wrapper">
          {isConfigLoading && <LoadingOverlay />}
          <NavigationMenu
            sections={effectiveSections}
            selectedId={selectedNavId}
            activeDescriptorId={selectedDescriptor}
            onSelect={(item) => {
              if (referenceDataLoading && item.type !== 'home') {
                return;
              }
              handleNavigationSelect(item);
            }}
            disabled={referenceDataLoading}
          />
        </div>
      </div>
    </div>
  );
};
