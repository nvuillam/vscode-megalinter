import { RJSFSchema, UiSchema } from '@rjsf/utils';
import { buildPresenceMaps, hasAnyKeySet } from '../shared/configPresence';
import { SchemaGroups } from '../shared/schemaUtils';

export type MenuChild = {
  id: string;
  label: string;
  type: 'linter';
  parentId: string;
  hasValues: boolean;
};

export type MenuItem = {
  id: string;
  label: string;
  type: 'general' | 'descriptor';
  hasValues: boolean;
  children?: MenuChild[];
};

export type MenuSectionId = 'general' | 'reporters' | 'llm' | 'languages';

export type MenuSection = {
  id: MenuSectionId;
  label: string;
  items: MenuItem[];
};

const SECTION_ORDER: MenuSectionId[] = ['general', 'reporters', 'llm', 'languages'];

export const prettifyId = (id: string): string => {
  const spaced = id.replace(/_/g, ' ').toLowerCase();
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
};

const descriptorCategory = (descriptorId: string): MenuSectionId => {
  const upper = descriptorId.toUpperCase();
  if (upper.includes('REPORT')) {
    return 'reporters';
  }
  if (upper.includes('LLM') || upper.includes('OPENAI')) {
    return 'llm';
  }
  return 'languages';
};

export const buildNavigationModel = (groups: SchemaGroups, formData: any) => {
  const { generalHasValues, descriptorHasValues, linterHasValues } = buildPresenceMaps(groups, formData);

  const sectionMap: Record<MenuSectionId, MenuItem[]> = {
    general: [],
    reporters: [],
    llm: [],
    languages: []
  };

  const descriptors = Object.keys(groups.descriptorKeys);

  descriptors.forEach((descriptorId) => {
    const sectionId = descriptorCategory(descriptorId);
    const linters = groups.linterKeys[descriptorId] || {};
    const linterEntries = Object.keys(linters).sort();
    const children: MenuChild[] = linterEntries.map((linterId) => ({
      id: linterId,
      parentId: descriptorId,
      label: prettifyId(linterId.replace(`${descriptorId}_`, '')),
      type: 'linter',
      hasValues: !!linterHasValues[descriptorId]?.[linterId]
    }));
    sectionMap[sectionId].push({
      id: descriptorId,
      label: prettifyId(descriptorId),
      type: 'descriptor',
      hasValues: !!descriptorHasValues[descriptorId],
      children
    });
  });

  // Alphabetize items inside each section
  SECTION_ORDER.forEach((sectionId) => {
    sectionMap[sectionId] = sectionMap[sectionId].sort((a, b) => a.label.localeCompare(b.label));
  });

  const sections: MenuSection[] = SECTION_ORDER.reduce<MenuSection[]>((acc, id) => {
    if (id === 'general') {
      acc.push({
        id,
        label: 'General Configuration',
        items: [
          {
            id: 'general',
            label: 'General Configuration',
            type: 'general',
            hasValues: generalHasValues
          }
        ]
      });
      return acc;
    }

    const items = sectionMap[id];
    if (items.length) {
      const label =
        id === 'reporters'
          ? 'Reporters'
          : id === 'llm'
          ? 'LLM Integration'
          : 'Languages / Formats';
      acc.push({ id, label, items });
    }
    return acc;
  }, []);

  const descriptorOrder = SECTION_ORDER.filter((s) => s !== 'general').flatMap((sectionId) =>
    sectionMap[sectionId].map((item) => item.id)
  );

  return { sections, descriptorOrder };
};

export type Tab = { id: string; label: string; hasValues?: boolean };

export const groupKeysByTheme = (
  keys: string[],
  prefixToStrip?: string,
  values?: Record<string, any>
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
  const categoryHasValues: Record<string, boolean> = {};

  keys.forEach((key) => {
    const stripped = prefixToStrip && key.startsWith(prefixToStrip) ? key.slice(prefixToStrip.length) : key;
    const [themeRaw] = stripped.split('_');
    const theme = themeRaw || 'misc';
    const category = categorizeTheme(theme, stripped, key);
    const isSet = values ? hasAnyKeySet([key], values) : false;
    if (!grouped[category]) {
      grouped[category] = [];
    }
    if (isSet) {
      categoryHasValues[category] = true;
    }
    grouped[category].push(key);
  });

  Object.keys(grouped).forEach((cat) => {
    grouped[cat] = sortKeysWithinCategory(grouped[cat], cat);
  });

  const tabs: Tab[] = categoryOrder
    .filter((id) => grouped[id]?.length)
    .map((id) => ({ id, label: categoryLabels[id] || id, hasValues: categoryHasValues[id] }));

  return { tabs, grouped };
};

export const buildSubsetSchema = (
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
      if (prefixToStrip && typeof cloned.description === 'string') {
        cloned.description = stripDescriptionPrefix(cloned.description, prefixToStrip);
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

export const buildScopedUiSchema = (
  baseSchema: RJSFSchema,
  keys: string[],
  baseUiSchema: UiSchema,
  highlightedKeys?: Set<string>
): UiSchema => {
  const ui: UiSchema = { ...baseUiSchema };
  const properties = (baseSchema.properties as Record<string, any>) || {};
  const definitions = (baseSchema.definitions as Record<string, any>) || {};

  const appendClass = (existing: string | undefined, extra: string) =>
    [existing, extra].filter(Boolean).join(' ').trim();

  const resolveEnum = (node: any): string[] | undefined => {
    if (!node) {
      return undefined;
    }
    if (Array.isArray(node.enum)) {
      return node.enum as string[];
    }
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

    if (highlightedKeys?.has(key)) {
      const existing = (ui[key] as Record<string, any>) || {};
      ui[key] = {
        ...existing,
        'ui:classNames': appendClass(existing['ui:classNames'], 'form-field--non-default')
      };
    }
  });

  return ui;
};

export const filterFormData = (data: any, keys: string[]) => {
  const subset: Record<string, any> = {};
  keys.forEach((key) => {
    if (data && Object.prototype.hasOwnProperty.call(data, key)) {
      subset[key] = data[key];
    }
  });
  return subset;
};

export const deepEqual = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

export const computeNonDefaultKeys = (data: any, schema: RJSFSchema): Set<string> => {
  const result = new Set<string>();
  const properties = (schema.properties as Record<string, any>) || {};

  const isEmptyValue = (value: any) => {
    if (value === undefined || value === null) {
      return true;
    }
    if (typeof value === 'string' && value.trim() === '') {
      return true;
    }
    if (Array.isArray(value) && value.length === 0) {
      return true;
    }
    return false;
  };

  Object.keys(data || {}).forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(properties, key)) {
      return;
    }
    const value = data[key];
    if (isEmptyValue(value)) {
      return;
    }
    const defaultValue = properties[key]?.default;
    const hasDefault = defaultValue !== undefined;
    const equalsDefault = hasDefault && deepEqual(value, defaultValue);

    if (!equalsDefault) {
      result.add(key);
    }
  });

  return result;
};

export const pruneDefaults = (data: any, original: any, schema: RJSFSchema) => {
  const result: Record<string, any> = {};
  const properties = (schema.properties as Record<string, any>) || {};

  Object.keys(data || {}).forEach((key) => {
    const value = data[key];
    const wasPresent = Object.prototype.hasOwnProperty.call(original || {}, key);
    const defaultValue = properties[key]?.default;

    if (Array.isArray(value) && value.length === 0) {
      return;
    }

    const equalsDefault = defaultValue !== undefined && deepEqual(value, defaultValue);

    if (!wasPresent && equalsDefault) {
      return;
    }

    result[key] = value;
  });

  return result;
};

export const stripTitlePrefix = (title: string, prefix: string): string => {
  const cleanPrefix = prefix.replace(/_+$/, '');
  if (!cleanPrefix) {
    return title;
  }

  const escaped = cleanPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}(?:\\s+linter)?(?:\\s*[-:])?\\s*`, 'i');
  return title.replace(pattern, '').trimStart();
};

export const stripDescriptionPrefix = (description: string, prefix: string): string => {
  const cleanPrefix = prefix.replace(/_+$/, '');
  if (!cleanPrefix) {
    return description;
  }
  const escaped = cleanPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}\\s*:\\s*`, 'i');
  return description.replace(pattern, '').trimStart();
};

export const categorizeTheme = (theme: string, strippedKey: string, fullKey: string): string => {
  const upper = theme.toUpperCase();
  const keyUpper = strippedKey.toUpperCase();

  if (/(FILE_EXTENSIONS|FILE_NAME.*REGEX)/.test(keyUpper)) {
    return 'scope';
  }

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

export const isDeprecatedPropertyTitle = (schema: RJSFSchema, key: string): boolean => {
  const properties = (schema.properties as Record<string, any>) || {};
  const title = properties[key]?.title;
  if (typeof title !== 'string') {
    return false;
  }
  const lower = title.toLowerCase();
  return lower.includes('deprecated') || lower.includes('removed');
};

export const sortKeysWithinCategory = (keys: string[], category: string) => {
  const priority = (key: string) => {
    const upper = key.toUpperCase();

    if (category === 'prepost') {
      if (upper.includes('PRE_')) {
        return 0;
      }
      if (upper.includes('POST_')) {
        return 1;
      }
      return 2;
    }

    if (category === 'command') {
      if (upper.includes('CUSTOM_REMOVE_ARGUMENTS') || upper.includes('REMOVE_ARGUMENTS')) {
        return 1;
      }
      if (upper.includes('CUSTOM_ARGUMENTS') || (upper.includes('ARGUMENTS') && !upper.includes('REMOVE'))) {
        return 0;
      }
      return 2;
    }

    if (category === 'scope') {
      if (upper.includes('FILE_NAME') && upper.includes('REGEX')) {
        return 0;
      }
      if (upper.includes('REGEX')) {
        return 1;
      }
      if (upper.includes('FILE_EXT')) {
        return 2;
      }
      return 3;
    }

    return 2;
  };

  return [...keys].sort((a, b) => priority(a) - priority(b) || a.localeCompare(b));
};
