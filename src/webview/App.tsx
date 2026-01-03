/* eslint-disable @typescript-eslint/naming-convention */
import { useEffect, useMemo, useRef, useState } from 'react';
import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';
import { ArrayFieldTemplateProps, RJSFSchema, UiSchema, WidgetProps } from '@rjsf/utils';
import bundledSchema from '../schema/megalinter-configuration.jsonschema.json';
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

type NavigationTarget =
  | { type: 'general' }
  | { type: 'descriptor'; descriptorId: string }
  | { type: 'linter'; descriptorId: string; linterId: string };

type ViewState = {
  activeMainTab: string;
  selectedDescriptor: string | null;
  selectedScope: string | null;
  activeGeneralTheme: string | null;
  activeDescriptorThemes: Record<string, string>;
  activeLinterThemes: Record<string, Record<string, string>>;
};

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
  const [schemaSource, setSchemaSource] = useState<'remote' | 'local' | null>(
    null
  );

  const [activeMainTab, setActiveMainTab] = useState<string>('general');
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

  useEffect(() => {
    const viewState: ViewState = {
      activeMainTab,
      selectedDescriptor,
      selectedScope,
      activeGeneralTheme,
      activeDescriptorThemes,
      activeLinterThemes
    };
    vscode.setState?.(viewState);
  }, [
    activeMainTab,
    selectedDescriptor,
    selectedScope,
    activeGeneralTheme,
    activeDescriptorThemes,
    activeLinterThemes
  ]);

  useEffect(() => {
    const saved = vscode.getState?.() as Partial<ViewState> | undefined;
    if (saved) {
      if (saved.activeMainTab) {
        setActiveMainTab(saved.activeMainTab);
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
    }
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
    if (item.type === 'general') {
      setActiveMainTab('general');
      setSelectedDescriptor(null);
      setSelectedScope(null);
      return;
    }

    if (item.type === 'linter') {
      setActiveMainTab('descriptors');
      setSelectedDescriptor(item.parentId);
      setSelectedScope(item.id);
      return;
    }

    setActiveMainTab('descriptors');
    setSelectedDescriptor(item.id);
    setSelectedScope('descriptor');
  };

  const applyNavigation = (target: NavigationTarget) => {
    if (!target) {
      return;
    }

    if (target.type === 'general') {
      setActiveMainTab('general');
      return;
    }

    if (target.type === 'descriptor') {
      setActiveMainTab('descriptors');
      setSelectedDescriptor(target.descriptorId);
      setSelectedScope('descriptor');
      return;
    }

    if (target.type === 'linter') {
      setActiveMainTab('descriptors');
      setSelectedDescriptor(target.descriptorId);
      setSelectedScope(target.linterId);
    }
  };

  useEffect(() => {
    const fallbackSchema = bundledSchema as RJSFSchema;
    const remoteSchemaUrl =
      'https://raw.githubusercontent.com/oxsecurity/megalinter/main/megalinter/descriptors/schemas/megalinter-configuration.jsonschema.json';

    const fetchSchema = async () => {
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
        setSchemaSource('remote');
        setGroups(extractGroups(filtered));
      } catch (err) {
        console.warn('Remote schema fetch failed, using bundled schema', err);
        try {
          const filtered = filterRemovedLintersFromSchema(fallbackSchema);
          setSchema(filtered);
          setSchemaSource('local');
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
        setConfigLoaded(true);
      } else if (message.type === 'navigate' && message.target) {
        applyNavigation(message.target as NavigationTarget);
      }
    };

    window.addEventListener('message', messageHandler);
    return () => window.removeEventListener('message', messageHandler);
  }, []);

  useEffect(() => {
    if (schema) {
      const grouped = extractGroups(schema);
      setGroups(grouped);
    }
  }, [schema, selectedDescriptor]);

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

  return (
    <div className="container">
      <div className="layout">
        <NavigationMenu
          sections={navigationModel?.sections || []}
          selectedId={
            activeMainTab === 'general'
              ? 'general'
              : selectedScope || selectedDescriptor || ''
          }
          activeDescriptorId={selectedDescriptor}
          onSelect={handleNavigationSelect}
        />
        <div className="form-container">
          <MainTabs
            schema={schema}
            groups={groups}
            formData={formData}
            uiSchema={uiSchema}
            onSubsetChange={handleSubsetChange}
            descriptorOrder={navigationModel?.descriptorOrder || []}
            activeMainTab={activeMainTab}
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
          />
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
}> = ({ sections, selectedId, activeDescriptorId, onSelect }) => (
  <nav className="nav" aria-label="Configuration sections">
    {sections.map((section) => (
      <div key={section.id} className="nav__section">
        <div className="nav__title">{section.label}</div>
        <ul className="nav__list">
          {section.items.map((item) => {
            const isActive = selectedId === item.id;
            const isExpanded = activeDescriptorId === item.id || isActive;
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
                {item.children && item.children.length && isExpanded && (
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
      </div>
    ))}
  </nav>
);

const MainTabs: React.FC<{
  schema: RJSFSchema;
  groups: SchemaGroups;
  formData: any;
  uiSchema: UiSchema;
  onSubsetChange: (keys: string[], subsetData: any) => void;
  descriptorOrder: string[];
  activeMainTab: string;
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
}> = ({
  schema,
  groups,
  formData,
  uiSchema,
  onSubsetChange,
  descriptorOrder: descriptorOrderProp,
  activeMainTab,
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
  highlightedKeys
}) => {
  const descriptorOrder = useMemo(() => {
    if (descriptorOrderProp.length) {
      return descriptorOrderProp;
    }
    return Object.keys(groups.descriptorKeys).sort();
  }, [descriptorOrderProp, groups]);
  const { descriptorHasValues, linterHasValues } = useMemo(
    () => buildPresenceMaps(groups, formData),
    [groups, formData]
  );

  const renderGeneral = () => (
    <ThemedForm
      baseSchema={schema}
      keys={groups.generalKeys}
      title="General settings"
      uiSchema={uiSchema}
      formData={filterFormData(formData, groups.generalKeys)}
      onSubsetChange={(keys, subset) => onSubsetChange(keys, subset)}
      activeThemeTab={activeGeneralTheme}
      setActiveThemeTab={setActiveGeneralTheme}
      highlightedKeys={highlightedKeys}
    />
  );

  const renderDescriptorArea = () => {
    const descriptorId = selectedDescriptor || descriptorOrder[0];
    if (!descriptorId) {
      return <p className="muted">No descriptors available</p>;
    }

    const descriptorKeys = groups.descriptorKeys[descriptorId] || [];
    const linters = groups.linterKeys[descriptorId] || {};
    const linterValueMap = linterHasValues[descriptorId] || {};

    const linterEntries = Object.entries(linters).sort(([a], [b]) => a.localeCompare(b));

    const scopeOptions: Tab[] = [
      {
        id: 'descriptor',
        label: `${descriptorId} variables${hasAnyKeySet(descriptorKeys, formData) ? ' *' : ''}`
      },
      ...linterEntries.map(([linter]) => ({
        id: linter,
        label: `${linter.replace(`${descriptorId}_`, '')}${linterValueMap[linter] ? ' *' : ''}`,
        hasValues: linterValueMap[linter]
      }))
    ];

    const activeScope = scopeOptions.find((opt) => opt.id === selectedScope)?.id || scopeOptions[0]?.id;

    const descriptorBreadcrumbOptions = descriptorOrder.map((id) => ({
      id,
      label: prettifyId(id),
      onSelect: () => {
        setSelectedDescriptor(id);
        setSelectedScope('descriptor');
      }
    }));

    const scopeBreadcrumbOptions = scopeOptions.map((opt) => ({
      id: opt.id,
      label: opt.id === 'descriptor' ? 'Variables' : prettifyId(opt.id.replace(`${descriptorId}_`, '')),
      onSelect: () => {
        setSelectedDescriptor(descriptorId);
        setSelectedScope(opt.id);
      }
    }));

    const breadcrumbItems = [
      {
        id: descriptorId,
        label: prettifyId(descriptorId),
        options: descriptorBreadcrumbOptions
      },
      {
        id: activeScope,
        label:
          activeScope === 'descriptor'
            ? 'Variables'
            : prettifyId(activeScope.replace(`${descriptorId}_`, '')),
        options: scopeBreadcrumbOptions
      }
    ];

    const descriptorForm = (
      <ThemedForm
        baseSchema={schema}
        keys={descriptorKeys}
        title={`${descriptorId} variables`}
        uiSchema={uiSchema}
        formData={filterFormData(formData, descriptorKeys)}
        onSubsetChange={(keys, subset) => onSubsetChange(keys, subset)}
        activeThemeTab={activeDescriptorThemes[descriptorId] || null}
        setActiveThemeTab={(id) =>
          setActiveDescriptorThemes({ ...activeDescriptorThemes, [descriptorId]: id || '' })
        }
        prefixToStrip={`${descriptorId}_`}
          highlightedKeys={highlightedKeys}
      />
    );

    const linterForm = (linterKey: string, keys: string[]) => (
      <ThemedForm
        baseSchema={schema}
        keys={keys}
        title={`${linterKey} linter`}
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
        highlightedKeys={highlightedKeys}
      />
    );

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

  return activeMainTab === 'general' ? renderGeneral() : renderDescriptorArea();
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
  items: Array<{ id: string; label: string; options?: BreadcrumbOption[] }>;
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

const ThemedForm: React.FC<{
  baseSchema: RJSFSchema;
  keys: string[];
  title: string;
  uiSchema: UiSchema;
  formData: any;
  onSubsetChange: (keys: string[], subset: any) => void;
  activeThemeTab: string | null;
  setActiveThemeTab: (id: string | null) => void;
  prefixToStrip?: string;
  highlightedKeys: Set<string>;
}> = ({
  baseSchema,
  keys,
  title,
  uiSchema,
  formData,
  onSubsetChange,
  activeThemeTab,
  setActiveThemeTab,
  prefixToStrip,
  highlightedKeys
}) => {
  const filteredKeys = useMemo(
    () => keys.filter((key) => !isDeprecatedPropertyTitle(baseSchema, key)),
    [keys, baseSchema]
  );

  const { tabs, grouped } = useMemo(
    () => groupKeysByTheme(filteredKeys, prefixToStrip, formData),
    [filteredKeys, prefixToStrip, formData]
  );

  const effectiveActive = useMemo(() => {
    if (activeThemeTab && grouped[activeThemeTab]) {
      return activeThemeTab;
    }
    return tabs[0]?.id || null;
  }, [activeThemeTab, grouped, tabs]);

  useEffect(() => {
    if (!activeThemeTab && tabs[0]) {
      setActiveThemeTab(tabs[0].id);
    }
  }, [activeThemeTab, setActiveThemeTab, tabs]);

  if (!tabs.length) {
    return <p className="muted">No fields available</p>;
  }

  const activeKeys = effectiveActive ? grouped[effectiveActive] || [] : [];
  const activeLabel = tabs.find((t) => t.id === effectiveActive)?.label || title;
  const widgets = useMemo(() => ({ dualList: DualListWidget }), []);
  const templates = useMemo(() => ({ ArrayFieldTemplate: TagArrayFieldTemplate }), []);

  if (!filteredKeys.length) {
    return <p className="muted">No fields available</p>;
  }

  return (
    <div className="tab-content">
      {tabs.length > 1 && (
        <TabBar tabs={tabs} activeTab={effectiveActive || ''} onSelect={(id) => setActiveThemeTab(id)} />
      )}
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
