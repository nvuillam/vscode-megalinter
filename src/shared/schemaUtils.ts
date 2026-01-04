import type { RJSFSchema } from '@rjsf/utils';

export type CategoryKind = 'generic' | 'descriptor' | 'linter' | 'other';

export type CategoryMeta = {
  id: string;
  kind: CategoryKind;
  label: string;
  parentId?: string;
  order: number;
};

export type SectionMeta = {
  labels: Record<string, string>;
  order: string[];
};

export type SchemaGroups = {
  generalKeys: string[];
  genericCategoryKeys: Record<string, string[]>;
  descriptorKeys: Record<string, string[]>;
  linterKeys: Record<string, Record<string, string[]>>;
  categoryMeta: Record<string, CategoryMeta>;
  sectionMeta: SectionMeta;
};

export const REMOVED_LINTERS = new Set<string>([
  'CREDENTIALS_SECRETLINT',
  'DOCKERFILE_DOCKERFILELINT',
  'GIT_GIT_DIFF',
  'PHP_BUILTIN',
  'KUBERNETES_KUBEVAL',
  'REPOSITORY_GOODCHECK',
  'SPELL_MISSPELL',
  'TERRAFORM_CHECKOV',
  'TERRAFORM_KICS',
  'CSS_SCSSLINT',
  'OPENAPI_SPECTRAL',
  'SQL_SQL_LINT',
  'MARKDOWN_MARKDOWN_LINK_CHECK'
]);

export const filterRemovedLintersFromSchema = <T extends RJSFSchema>(schema: T): T => {
  const clone = JSON.parse(JSON.stringify(schema)) as T;
  const def = (clone as any)?.definitions?.enum_linter_keys;
  if (def && Array.isArray(def.enum)) {
    const filteredEnum: string[] = [];
    const filteredNames: string[] = [];
    def.enum.forEach((val: string, idx: number) => {
      if (!REMOVED_LINTERS.has(val)) {
        filteredEnum.push(val);
        if (Array.isArray(def.enumNames) && def.enumNames[idx] !== undefined) {
          filteredNames.push(def.enumNames[idx]);
        }
      }
    });
    def.enum = filteredEnum;
    if (Array.isArray(def.enumNames)) {
      def.enumNames = filteredNames;
    }
  }
  return clone;
};

const asArray = (value: unknown): string[] => (Array.isArray(value) ? (value as string[]) : []);

export const extractGroups = (schema: RJSFSchema): SchemaGroups => {
  const properties = (schema.properties as Record<string, any>) || {};
  const definitions = (schema.definitions as Record<string, any>) || {};

  const descriptorEnums = asArray(definitions.enum_descriptor_keys?.enum);
  const linterEnums = asArray(definitions.enum_linter_keys?.enum);
  const genericEnums = asArray(definitions.enum_generic_categories?.enum);
  const genericNames = asArray(definitions.enum_generic_categories?.enumNames);
  const sectionOrder = asArray(definitions.enum_generic_sections?.enum);
  const sectionNames = asArray(definitions.enum_generic_sections?.enumNames);

  const linterList = linterEnums.filter((l) => !REMOVED_LINTERS.has(l));

  const linterDescriptorMap: Record<string, string> = {};
  linterList.forEach((l) => {
    const [descriptor] = l.split('_');
    if (descriptor) {
      linterDescriptorMap[l] = descriptor;
    }
  });

  const descriptorWithLinters = new Set<string>(Object.values(linterDescriptorMap));
  const descriptorList = descriptorEnums.filter((d) => descriptorWithLinters.has(d));

  const descriptorPrefixes = descriptorList.map((d) => `${d}_`);
  const linterPrefixes = linterList.map((l) => `${l}_`);
  const removedLinterPrefixes = Array.from(REMOVED_LINTERS).map((l) => `${l}_`);

  const generalKeys: string[] = [];
  const genericCategoryKeys: Record<string, string[]> = {};
  const descriptorKeys: Record<string, string[]> = {};
  const linterKeys: Record<string, Record<string, string[]>> = {};
  const categoryMeta: Record<string, CategoryMeta> = {};

  const ensureCategoryMeta = (id: string, kind: CategoryKind, label: string, parentId?: string) => {
    const existing = categoryMeta[id];
    const nextOrder = existing?.order ?? Number.MAX_SAFE_INTEGER;
    categoryMeta[id] = {
      id,
      kind,
      label,
      parentId,
      order: nextOrder
    };
  };

  const updateCategoryOrder = (id: string, order: number) => {
    const meta = categoryMeta[id];
    if (!meta) {
      return;
    }
    meta.order = Math.min(meta.order, order);
  };

  const resolveGenericLabel = (id: string): string => {
    const idx = genericEnums.indexOf(id);
    if (idx !== -1 && genericNames[idx]) {
      return String(genericNames[idx]);
    }
    return id;
  };

  descriptorList.forEach((id) => ensureCategoryMeta(id, 'descriptor', id));
  linterList.forEach((id) => ensureCategoryMeta(id, 'linter', id, linterDescriptorMap[id]));
  genericEnums.forEach((id) => ensureCategoryMeta(id, 'generic', resolveGenericLabel(id)));

  Object.entries(properties).forEach(([propKey, propSchema]) => {
    if (removedLinterPrefixes.some((p) => propKey.startsWith(p))) {
      return;
    }

    const categoryId = propSchema['x-category'] as string | undefined;
    const sectionId = (propSchema['x-section'] as string | undefined) || 'MISC';
    const orderValue = typeof propSchema['x-order'] === 'number' ? (propSchema['x-order'] as number) : Number.MAX_SAFE_INTEGER;

    const assignToCategory = (targetCategory: string, kind: CategoryKind, parentId?: string) => {
      if (kind === 'descriptor') {
        if (!descriptorKeys[targetCategory]) {
          descriptorKeys[targetCategory] = [];
        }
        descriptorKeys[targetCategory].push(propKey);
      } else if (kind === 'linter') {
        const descriptor = parentId || linterDescriptorMap[targetCategory];
        if (!descriptor) {
          return;
        }
        if (!linterKeys[descriptor]) {
          linterKeys[descriptor] = {};
        }
        if (!linterKeys[descriptor][targetCategory]) {
          linterKeys[descriptor][targetCategory] = [];
        }
        linterKeys[descriptor][targetCategory].push(propKey);
      } else if (kind === 'generic') {
        if (!genericCategoryKeys[targetCategory]) {
          genericCategoryKeys[targetCategory] = [];
        }
        genericCategoryKeys[targetCategory].push(propKey);
      } else {
        generalKeys.push(propKey);
      }
      ensureCategoryMeta(targetCategory, kind, categoryMeta[targetCategory]?.label || targetCategory, parentId);
      updateCategoryOrder(targetCategory, orderValue);
      propSchema['x-section'] = sectionId;
    };

    if (categoryId === 'GENERAL') {
      ensureCategoryMeta('GENERAL', 'generic', resolveGenericLabel('GENERAL'));
      updateCategoryOrder('GENERAL', orderValue);
      generalKeys.push(propKey);
      return;
    }

    if (categoryId && genericEnums.includes(categoryId)) {
      assignToCategory(categoryId, 'generic');
      return;
    }

    if (categoryId && descriptorList.includes(categoryId)) {
      assignToCategory(categoryId, 'descriptor');
      return;
    }

    if (categoryId && linterDescriptorMap[categoryId]) {
      assignToCategory(categoryId, 'linter', linterDescriptorMap[categoryId]);
      return;
    }

    if (categoryId) {
      // Catch-all: support categories present in x-category but missing from enums (e.g., LLM)
      const label = resolveGenericLabel(categoryId);
      ensureCategoryMeta(categoryId, 'generic', label || categoryId);
      assignToCategory(categoryId, 'generic');
      return;
    }

    const linterPrefix = linterPrefixes.find((p) => propKey.startsWith(p));
    if (linterPrefix) {
      const linterKey = linterPrefix.slice(0, -1);
      assignToCategory(linterKey, 'linter', linterDescriptorMap[linterKey]);
      return;
    }

    const descriptorPrefix = descriptorPrefixes.find((p) => propKey.startsWith(p));
    if (descriptorPrefix) {
      const descriptor = descriptorPrefix.slice(0, -1);
      assignToCategory(descriptor, 'descriptor');
      return;
    }

    generalKeys.push(propKey);
  });

  const sectionMeta: SectionMeta = {
    labels: sectionOrder.reduce<Record<string, string>>((acc, id, idx) => {
      acc[id] = sectionNames[idx] || id;
      return acc;
    }, {}),
    order: sectionOrder
  };

  return {
    generalKeys,
    genericCategoryKeys,
    descriptorKeys,
    linterKeys,
    categoryMeta,
    sectionMeta
  };
};
