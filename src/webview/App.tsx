/* eslint-disable @typescript-eslint/naming-convention */
import { useEffect, useMemo, useRef, useState } from 'react';
import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';
import { ArrayFieldTemplateProps, RJSFSchema, UiSchema, WidgetProps } from '@rjsf/utils';
import bundledSchema from '../schema/megalinter-configuration.jsonschema.json';
import './styles.css';

type SchemaGroups = {
  generalKeys: string[];
  descriptorKeys: Record<string, string[]>;
  linterKeys: Record<string, Record<string, string[]>>;
};

type Tab = {
  id: string;
  label: string;
};

type NavigationTarget =
  | { type: 'general' }
  | { type: 'descriptor'; descriptorId: string }
  | { type: 'linter'; descriptorId: string; linterId: string };

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

  const queueSave = (data: any) => {
    if (!schema) {
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
        setSchema(schemaData);
        setSchemaSource('remote');
        setGroups(extractGroups(schemaData));
      } catch (err) {
        console.warn('Remote schema fetch failed, using bundled schema', err);
        try {
          setSchema(fallbackSchema);
          setSchemaSource('local');
          setGroups(extractGroups(fallbackSchema));
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

      const descriptorList = Object.keys(grouped.descriptorKeys).sort();
      if (!selectedDescriptor && descriptorList.length) {
        setSelectedDescriptor(descriptorList[0]);
        setSelectedScope('descriptor');
      } else if (
        selectedDescriptor &&
        descriptorList.length &&
        !descriptorList.includes(selectedDescriptor)
      ) {
        setSelectedDescriptor(descriptorList[0]);
        setSelectedScope('descriptor');
      }
    }
  }, [schema, selectedDescriptor]);

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
      <div className="form-container">
        <MainTabs
          schema={schema}
          groups={groups}
          formData={formData}
          uiSchema={uiSchema}
          onSubsetChange={handleSubsetChange}
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
        />
      </div>
    </div>
  );
};

const MainTabs: React.FC<{
  schema: RJSFSchema;
  groups: SchemaGroups;
  formData: any;
  uiSchema: UiSchema;
  onSubsetChange: (keys: string[], subsetData: any) => void;
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
}> = ({
  schema,
  groups,
  formData,
  uiSchema,
  onSubsetChange,
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
  setActiveLinterThemes
}) => {
  const descriptorOrder = useMemo(() => Object.keys(groups.descriptorKeys).sort(), [groups]);

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
    />
  );

  const renderDescriptorArea = () => {
    const descriptorId = selectedDescriptor || descriptorOrder[0];
    if (!descriptorId) {
      return <p className="muted">No descriptors available</p>;
    }

    const descriptorKeys = groups.descriptorKeys[descriptorId] || [];
    const linters = groups.linterKeys[descriptorId] || {};
    const linterEntries = Object.entries(linters).sort(([a], [b]) => a.localeCompare(b));

    const scopeOptions: Tab[] = [
      { id: 'descriptor', label: `${descriptorId} variables` },
      ...linterEntries.map(([linter]) => ({ id: linter, label: linter.replace(`${descriptorId}_`, '') }))
    ];

    const activeScope = scopeOptions.find((opt) => opt.id === selectedScope)?.id || scopeOptions[0]?.id;

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
      />
    );

    const activeContent =
      activeScope === 'descriptor'
        ? descriptorForm
        : linterForm(activeScope, linters[activeScope] || []);

    return (
      <div className="descriptor-panel">
        <div className="descriptor-controls">
          <label className="control">
            <span>Descriptor</span>
            <select
              value={descriptorId}
              onChange={(e) => {
                setSelectedDescriptor(e.target.value);
                setSelectedScope('descriptor');
              }}
            >
              {descriptorOrder.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <label className="control">
            <span>Scope</span>
            <select
              value={activeScope || ''}
              onChange={(e) => setSelectedScope(e.target.value || 'descriptor')}
            >
              {scopeOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="tab-content">{activeContent}</div>
      </div>
    );
  };

  const activeContent = activeMainTab === 'general' ? renderGeneral() : renderDescriptorArea();

  return (
    <div>{activeContent}</div>
  );
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
        {tab.label}
      </button>
    ))}
  </div>
);

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
}> = ({
  baseSchema,
  keys,
  title,
  uiSchema,
  formData,
  onSubsetChange,
  activeThemeTab,
  setActiveThemeTab,
  prefixToStrip
}) => {
  const { tabs, grouped } = useMemo(() => groupKeysByTheme(keys, prefixToStrip), [keys, prefixToStrip]);

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

  return (
    <div className="tab-content">
      {tabs.length > 1 && (
        <TabBar tabs={tabs} activeTab={effectiveActive || ''} onSelect={(id) => setActiveThemeTab(id)} />
      )}
      <Form
        key={`${title}-${effectiveActive || 'default'}`}
        schema={buildSubsetSchema(baseSchema, activeKeys, `${title} - ${activeLabel}`, prefixToStrip)}
        uiSchema={buildScopedUiSchema(baseSchema, activeKeys, uiSchema)}
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
  const { items, canAdd, onAddClick, title, schema } = props;
  const itemType = (schema as any)?.items?.type;
  const isStringArray = itemType === 'string' || (Array.isArray(itemType) && itemType.includes('string'));

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

const groupKeysByTheme = (
  keys: string[],
  prefixToStrip?: string
): { tabs: Tab[]; grouped: Record<string, string[]> } => {
  const categoryOrder = ['command', 'scope', 'severity', 'prepost', 'misc'];
  const categoryLabels: Record<string, string> = {
    command: 'Linter command',
    scope: 'Scope (filters)',
    severity: 'Severity',
    prepost: 'Pre-Post commands',
    misc: 'Misc'
  };

  const grouped: Record<string, string[]> = {};

  keys.forEach((key) => {
    const stripped = prefixToStrip && key.startsWith(prefixToStrip) ? key.slice(prefixToStrip.length) : key;
    const [themeRaw] = stripped.split('_');
    const theme = themeRaw || 'misc';
    const category = categorizeTheme(theme, stripped, key);
    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category].push(key);
  });

  Object.keys(grouped).forEach((cat) => {
    grouped[cat] = sortKeysWithinCategory(grouped[cat], cat);
  });

  const tabs: Tab[] = categoryOrder
    .filter((id) => grouped[id]?.length)
    .map((id) => ({ id, label: categoryLabels[id] || id }));

  return { tabs, grouped };
};

const extractGroups = (schema: RJSFSchema): SchemaGroups => {
  const properties = (schema.properties as Record<string, any>) || {};
  const descriptorEnums = (schema.definitions as any)?.enum_descriptor_keys?.enum as string[] | undefined;
  const linterEnums = (schema.definitions as any)?.enum_linter_keys?.enum as string[] | undefined;

  const descriptorList = Array.isArray(descriptorEnums) ? descriptorEnums : [];
  const linterList = Array.isArray(linterEnums) ? linterEnums : [];

  const descriptorKeys: Record<string, string[]> = {};
  const linterKeys: Record<string, Record<string, string[]>> = {};
  const generalKeys: string[] = [];

  const linterDescriptorMap: Record<string, string> = {};
  linterList.forEach((l) => {
    const parts = l.split('_');
    const descriptor = parts[0];
    linterDescriptorMap[l] = descriptor;
  });

  const descriptorPrefixes = descriptorList.map((d) => `${d}_`);
  const linterPrefixes = linterList.map((l) => `${l}_`);

  Object.keys(properties).forEach((propKey) => {
    const linterPrefix = linterPrefixes.find((p) => propKey.startsWith(p));
    if (linterPrefix) {
      const linterKey = linterPrefix.slice(0, -1);
      const descriptor = linterDescriptorMap[linterKey];
      if (descriptor) {
        if (!linterKeys[descriptor]) {
          linterKeys[descriptor] = {};
        }
        if (!linterKeys[descriptor][linterKey]) {
          linterKeys[descriptor][linterKey] = [];
        }
        linterKeys[descriptor][linterKey].push(propKey);
        return;
      }
    }

    const descriptorPrefix = descriptorPrefixes.find((p) => propKey.startsWith(p));
    if (descriptorPrefix) {
      const descriptor = descriptorPrefix.slice(0, -1);
      if (!descriptorKeys[descriptor]) {
        descriptorKeys[descriptor] = [];
      }
      descriptorKeys[descriptor].push(propKey);
      return;
    }

    generalKeys.push(propKey);
  });

  return { generalKeys, descriptorKeys, linterKeys };
};

const buildSubsetSchema = (
  baseSchema: RJSFSchema,
  keys: string[],
  title?: string,
  prefixToStrip?: string
): RJSFSchema => {
  const properties = (baseSchema.properties as Record<string, any>) || {};
  const subsetProps = keys.reduce<Record<string, any>>((acc, key) => {
    if (properties[key]) {
      const cloned = { ...properties[key] };
      if (prefixToStrip && typeof cloned.title === 'string') {
        cloned.title = stripTitlePrefix(cloned.title, prefixToStrip);
      }
      acc[key] = cloned;
    }
    return acc;
  }, {});

  const required = Array.isArray(baseSchema.required)
    ? (baseSchema.required as string[]).filter((r) => keys.includes(r))
    : undefined;

  return {
    type: 'object',
    title,
    properties: subsetProps,
    required,
    definitions: baseSchema.definitions
  } as RJSFSchema;
};

const buildScopedUiSchema = (
  baseSchema: RJSFSchema,
  keys: string[],
  baseUiSchema: UiSchema
): UiSchema => {
  const ui: UiSchema = { ...baseUiSchema };
  const properties = (baseSchema.properties as Record<string, any>) || {};
  const definitions = (baseSchema.definitions as Record<string, any>) || {};

  const resolveEnum = (node: any): string[] | undefined => {
    if (!node) return undefined;
    if (Array.isArray(node.enum)) return node.enum as string[];
    const ref = typeof node.$ref === 'string' ? node.$ref : undefined;
    if (ref && ref.startsWith('#/definitions/')) {
      const defKey = ref.replace('#/definitions/', '');
      const def = definitions[defKey];
      if (def && Array.isArray(def.enum)) {
        return def.enum as string[];
      }
    }
    return undefined;
  };

  keys.forEach((key) => {
    const prop = properties[key];
    if (prop && prop.type === 'array' && prop.items) {
      const enumValues = resolveEnum(prop.items);
      if (enumValues) {
        ui[key] = { ...(ui[key] as any), 'ui:widget': 'dualList' };
      }
    }
  });

  return ui;
};

const filterFormData = (data: any, keys: string[]) => {
  const subset: Record<string, any> = {};
  keys.forEach((key) => {
    if (data && Object.prototype.hasOwnProperty.call(data, key)) {
      subset[key] = data[key];
    }
  });
  return subset;
};

const deepEqual = (a: any, b: any) => {
  return JSON.stringify(a) === JSON.stringify(b);
};

const pruneDefaults = (data: any, original: any, schema: RJSFSchema) => {
  const result: Record<string, any> = {};
  const properties = (schema.properties as Record<string, any>) || {};

  Object.keys(data || {}).forEach((key) => {
    const value = data[key];
    const isEmptyArray = Array.isArray(value) && value.length === 0;
    const wasPresent = Object.prototype.hasOwnProperty.call(original || {}, key);
    const defaultValue = properties[key]?.default;

    if (isEmptyArray) {
      return; // remove empty arrays entirely
    }

    const equalsDefault = defaultValue !== undefined && deepEqual(value, defaultValue);

    if (!wasPresent && equalsDefault) {
      return; // skip writing default values that weren't originally set
    }

    result[key] = value;
  });

  return result;
};

const stripTitlePrefix = (title: string, prefix: string): string => {
  const cleanPrefix = prefix.replace(/_+$/, '');
  if (!cleanPrefix) {
    return title;
  }

  const escaped = cleanPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}(?:\\s+linter)?(?:\\s*[-:])?\\s*`, 'i');
  return title.replace(pattern, '').trimStart();
};

const categorizeTheme = (theme: string, strippedKey: string, fullKey: string): string => {
  const upper = theme.toUpperCase();
  const keyUpper = strippedKey.toUpperCase();

  // Override matching files/regex should live in scope
  if (/(FILE_EXTENSIONS|FILE_NAME.*REGEX)/.test(keyUpper)) {
    return 'scope';
  }

  // Avoid duplicate display of config-file-name style keys by grouping them under command once
  if (keyUpper.includes('CONFIG_FILE')) {
    return 'command';
  }

  if (['FILTER', 'SCOPE'].includes(upper)) {
    return 'scope';
  }

  if (['COMMAND', 'CLI', 'CONFIG', 'FILE', 'ARGUMENTS'].includes(upper)) {
    return 'command';
  }

  if (['RULES', 'DISABLE', 'SEVERITY'].includes(upper)) {
    return 'severity';
  }

  if (['PRE', 'POST'].includes(upper)) {
    return 'prepost';
  }

  return 'misc';
};

const sortKeysWithinCategory = (keys: string[], category: string) => {
  const priority = (key: string) => {
    const upper = key.toUpperCase();

    if (category === 'prepost') {
      if (upper.includes('PRE_')) return 0;
      if (upper.includes('POST_')) return 1;
      return 2;
    }

    if (category === 'command') {
      if (upper.includes('CUSTOM_REMOVE_ARGUMENTS') || upper.includes('REMOVE_ARGUMENTS')) return 1;
      if (upper.includes('CUSTOM_ARGUMENTS') || (upper.includes('ARGUMENTS') && !upper.includes('REMOVE'))) return 0;
      return 2;
    }

    if (category === 'scope') {
      if (upper.includes('FILE_NAME') && upper.includes('REGEX')) return 0;
      if (upper.includes('REGEX')) return 1;
      if (upper.includes('FILE_EXT')) return 2;
      return 3;
    }

    return 2;
  };

  return [...keys].sort((a, b) => priority(a) - priority(b) || a.localeCompare(b));
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

  const resolveEnumValues = (node: any): string[] | undefined => {
    if (!node) return undefined;

    const resolved = schemaUtils?.retrieveSchema ? schemaUtils.retrieveSchema(node, rootSchema) : node;
    if (Array.isArray(resolved?.enum)) return resolved.enum as string[];

    const ref = typeof node.$ref === 'string' ? node.$ref : undefined;
    if (ref && ref.startsWith('#/definitions/') && rootSchema?.definitions) {
      const defKey = ref.replace('#/definitions/', '');
      const def = (rootSchema.definitions as Record<string, any>)[defKey];
      if (def && Array.isArray(def.enum)) {
        return def.enum as string[];
      }
    }
    return undefined;
  };

  const enumOptions = useMemo(() => {
    if (options.enumOptions && options.enumOptions.length) {
      return options.enumOptions as Array<{ value: any; label: string }>;
    }

    const itemSchema = (schema as any)?.items;
    const values = resolveEnumValues(itemSchema) || [];
    return values.map((v) => ({ value: v, label: String(v) }));
  }, [options.enumOptions, schema, rootSchema]);
  const selectedValues = Array.isArray(value) ? value : [];
  const selectedSet = new Set(selectedValues);
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
    // Clear selections when the source data changes to avoid stale ids
    setAvailableSelected([]);
    setChosenSelected([]);
  }, [value]);

  const addSelected = () => {
    if (readonly || disabled) return;
    const toAdd = availableSelected
      .map((v) => valueMap.get(String(v)))
      .filter((v): v is any => v !== undefined && !selectedSet.has(v));
    if (toAdd.length === 0) return;
    onChange([...selectedValues, ...toAdd]);
    setAvailableSelected([]);
  };

  const removeSelected = () => {
    if (readonly || disabled) return;
    if (chosenSelected.length === 0) return;
    const removeSet = new Set(
      chosenSelected
        .map((v) => valueMap.get(String(v)))
        .filter((v): v is any => v !== undefined)
    );
    const next = selectedValues.filter((v) => !removeSet.has(v));
    onChange(next);
    setChosenSelected([]);
  };

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
    </div>
  );
};
