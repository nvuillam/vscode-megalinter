/* eslint-disable @typescript-eslint/naming-convention */
import { RJSFSchema, UiSchema } from "@rjsf/utils";
import { buildPresenceMaps, hasAnyKeySet } from "../shared/configPresence";
import { CategoryMeta, SchemaGroups } from "../shared/schemaUtils";
import { getCodiconForSection } from "./iconResolver";

export type MenuChild = {
  id: string;
  label: string;
  type: "linter";
  parentId: string;
  hasValues: boolean;
};

export type MenuItem = {
  id: string;
  label: string;
  type: "home" | "summary" | "general" | "category" | "descriptor";
  hasValues: boolean;
  children?: MenuChild[];
};

export type MenuSectionId =
  | "home"
  | "summary"
  | "general"
  | "generic"
  | "descriptors";

export type MenuSection = {
  id: MenuSectionId;
  label: string;
  items: MenuItem[];
};

const SECTION_ORDER: MenuSectionId[] = [
  "home",
  "summary",
  "general",
  "generic",
  "descriptors",
];

export const prettifyId = (id: string): string => {
  const spaced = id.replace(/_/g, " ").toLowerCase();
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
};

const categoryLabel = (id: string, meta?: CategoryMeta) => {
  if (id === "LLM") {
    return "LLM Advisor";
  }
  if (!meta) {
    return prettifyId(id);
  }
  if (
    meta.kind === "linter" &&
    meta.parentId &&
    id.startsWith(`${meta.parentId}_`)
  ) {
    return prettifyId(id.replace(`${meta.parentId}_`, ""));
  }
  return prettifyId(meta.label || id);
};

const categoryOrderValue = (id: string, meta?: CategoryMeta) =>
  meta?.order ?? Number.MAX_SAFE_INTEGER;

export const buildNavigationModel = (groups: SchemaGroups, formData: any) => {
  const {
    generalHasValues,
    genericHasValues,
    descriptorHasValues,
    linterHasValues,
  } = buildPresenceMaps(groups, formData);
  const hasAnyConfig = Object.keys(formData || {}).length > 0;

  const sectionMap: Record<MenuSectionId, MenuItem[]> = {
    home: [],
    summary: [],
    general: [],
    generic: [],
    descriptors: [],
  };

  sectionMap.home.push({
    id: "home",
    label: "Home",
    type: "home",
    hasValues: hasAnyConfig,
  });

  sectionMap.summary.push({
    id: "summary",
    label: "Summary",
    type: "summary",
    hasValues: hasAnyConfig,
  });

  const generalLabel = categoryLabel("GENERAL", groups.categoryMeta["GENERAL"]);

  sectionMap.general.push({
    id: "general",
    label: "Configuration",
    type: "general",
    hasValues: generalHasValues,
  });

  Object.keys(groups.genericCategoryKeys)
    .sort((a, b) =>
      categoryLabel(a, groups.categoryMeta[a]).localeCompare(
        categoryLabel(b, groups.categoryMeta[b]),
      ),
    )
    .forEach((categoryId) => {
      const meta = groups.categoryMeta[categoryId];
      const targetSection: MenuSectionId =
        categoryId === "LLM" ? "general" : "generic";
      sectionMap[targetSection].push({
        id: categoryId,
        label: categoryLabel(categoryId, meta),
        type: "category",
        hasValues: !!genericHasValues[categoryId],
      });
    });

  Object.keys(groups.descriptorKeys)
    .sort((a, b) =>
      categoryLabel(a, groups.categoryMeta[a]).localeCompare(
        categoryLabel(b, groups.categoryMeta[b]),
      ),
    )
    .forEach((descriptorId) => {
      const linters = groups.linterKeys[descriptorId] || {};
      const linterEntries = Object.keys(linters).sort((a, b) => {
        const orderA = categoryOrderValue(a, groups.categoryMeta[a]);
        const orderB = categoryOrderValue(b, groups.categoryMeta[b]);
        if (orderA === orderB) {
          return categoryLabel(a, groups.categoryMeta[a]).localeCompare(
            categoryLabel(b, groups.categoryMeta[b]),
          );
        }
        return orderA - orderB;
      });

      const children: MenuChild[] = linterEntries.map((linterId) => ({
        id: linterId,
        parentId: descriptorId,
        label: categoryLabel(linterId, groups.categoryMeta[linterId]),
        type: "linter",
        hasValues: !!linterHasValues[descriptorId]?.[linterId],
      }));

      sectionMap.descriptors.push({
        id: descriptorId,
        label: categoryLabel(descriptorId, groups.categoryMeta[descriptorId]),
        type: "descriptor",
        hasValues: !!descriptorHasValues[descriptorId],
        children,
      });
    });

  const sections: MenuSection[] = SECTION_ORDER.reduce<MenuSection[]>(
    (acc, id) => {
      if (id === "home") {
        acc.push({ id, label: "Home", items: sectionMap.home });
        return acc;
      }

      if (id === "summary") {
        acc.push({ id, label: "Summary", items: sectionMap.summary });
        return acc;
      }

      if (id === "general") {
        acc.push({ id, label: generalLabel, items: sectionMap.general });
        return acc;
      }

      const items = sectionMap[id];
      if (!items.length) {
        return acc;
      }

      const label = id === "generic" ? "Reporters" : "Descriptors";
      acc.push({ id, label, items });
      return acc;
    },
    [],
  );

  const descriptorOrder = sectionMap.descriptors.map((item) => item.id);
  return { sections, descriptorOrder };
};

export type Tab = {
  id: string;
  label: string;
  hasValues?: boolean;
  icon?: string;
};

export const groupKeysByTheme = (
  keys: string[],
  _prefixToStrip: string | undefined,
  values: Record<string, any> | undefined,
  schema: RJSFSchema,
  sectionMeta?: { labels: Record<string, string>; order: string[] },
): { tabs: Tab[]; grouped: Record<string, string[]> } => {
  const grouped: Record<string, string[]> = {};
  const sectionHasValues: Record<string, boolean> = {};
  const properties = (schema.properties as Record<string, any>) || {};
  const orderConfig = sectionMeta?.order || [];
  const labelConfig = sectionMeta?.labels || {};
  const allowedSections = new Set(orderConfig.concat("MISC"));

  const resolveSectionId = (key: string): string => {
    const prop = properties[key];
    const sectionId = (prop && prop["x-section"]) || "MISC";
    if (typeof sectionId !== "string") {
      return "MISC";
    }
    return allowedSections.has(sectionId) ? sectionId : "MISC";
  };

  const resolveSectionLabel = (id: string): string => {
    if (labelConfig[id]) {
      return labelConfig[id];
    }
    return prettifyId(id);
  };

  keys.forEach((key) => {
    const sectionId = resolveSectionId(key);
    const isSet = values ? hasAnyKeySet([key], values) : false;
    if (!grouped[sectionId]) {
      grouped[sectionId] = [];
    }
    if (isSet) {
      sectionHasValues[sectionId] = true;
    }
    grouped[sectionId].push(key);
  });

  Object.keys(grouped).forEach((sectionId) => {
    grouped[sectionId] = grouped[sectionId].sort((a, b) => {
      const orderA =
        typeof properties[a]?.["x-order"] === "number"
          ? (properties[a]["x-order"] as number)
          : Number.MAX_SAFE_INTEGER;
      const orderB =
        typeof properties[b]?.["x-order"] === "number"
          ? (properties[b]["x-order"] as number)
          : Number.MAX_SAFE_INTEGER;
      if (orderA === orderB) {
        return a.localeCompare(b);
      }
      return orderA - orderB;
    });
  });

  const sectionOrdering = Object.keys(grouped).sort((a, b) => {
    const idxA = orderConfig.indexOf(a);
    const idxB = orderConfig.indexOf(b);
    if (idxA !== -1 && idxB !== -1 && idxA !== idxB) {
      return idxA - idxB;
    }
    if (idxA !== -1) {
      return -1;
    }
    if (idxB !== -1) {
      return 1;
    }
    return a.localeCompare(b);
  });

  const tabs: Tab[] = sectionOrdering.map((id) => ({
    id,
    label: resolveSectionLabel(id),
    hasValues: sectionHasValues[id],
    icon: getCodiconForSection(id),
  }));

  return { tabs, grouped };
};

export const buildSubsetSchema = (
  baseSchema: RJSFSchema,
  keys: string[],
  title?: string,
  prefixToStrip?: string,
): RJSFSchema => {
  const properties = (baseSchema.properties as Record<string, any>) || {};
  const subsetProps = keys.reduce<Record<string, any>>((acc, key) => {
    if (properties[key]) {
      const cloned = { ...properties[key] };
      if (prefixToStrip && typeof cloned.title === "string") {
        cloned.title = stripTitlePrefix(cloned.title, prefixToStrip);
      }
      if (prefixToStrip && typeof cloned.description === "string") {
        cloned.description = stripDescriptionPrefix(
          cloned.description,
          prefixToStrip,
        );
      }
      acc[key] = cloned;
    }
    return acc;
  }, {});

  const required = Array.isArray(baseSchema.required)
    ? (baseSchema.required as string[]).filter((r) => keys.includes(r))
    : undefined;

  return {
    type: "object",
    title,
    properties: subsetProps,
    required,
    definitions: baseSchema.definitions,
  } as RJSFSchema;
};

export const buildScopedUiSchema = (
  baseSchema: RJSFSchema,
  keys: string[],
  baseUiSchema: UiSchema,
  highlightedKeys?: Set<string>,
  inheritedConfig?: Record<string, any>,
  inheritedKeySources?: Record<string, string>,
  currentData?: Record<string, any>,
): UiSchema => {
  const ui: UiSchema = { ...baseUiSchema };
  const properties = (baseSchema.properties as Record<string, any>) || {};
  const definitions = (baseSchema.definitions as Record<string, any>) || {};

  const appendClass = (existing: string | undefined, extra: string) =>
    [existing, extra].filter(Boolean).join(" ").trim();

  const resolveEnum = (node: any): string[] | undefined => {
    if (!node) {
      return undefined;
    }
    if (Array.isArray(node.enum)) {
      return node.enum as string[];
    }
    const ref = typeof node.$ref === "string" ? node.$ref : undefined;
    if (ref && ref.startsWith("#/definitions/")) {
      const defKey = ref.replace("#/definitions/", "");
      const def = definitions[defKey];
      if (def && Array.isArray(def.enum)) {
        return def.enum as string[];
      }
    }
    return undefined;
  };

  keys.forEach((key) => {
    const prop = properties[key];
    if (prop && prop.type === "array" && prop.items) {
      const enumValues = resolveEnum(prop.items);
      if (enumValues) {
        ui[key] = { ...(ui[key] as any), "ui:widget": "dualList" };
      }
    }

    const isInherited =
      !!inheritedConfig &&
      Object.prototype.hasOwnProperty.call(inheritedConfig, key) &&
      !!currentData &&
      Object.prototype.hasOwnProperty.call(currentData, key) &&
      deepEqual(currentData[key], inheritedConfig[key]);

    if (isInherited) {
      const existing = (ui[key] as Record<string, any>) || {};
      const options = (existing["ui:options"] as Record<string, any>) || {};
      const inheritedFrom = inheritedKeySources?.[key];

      ui[key] = {
        ...existing,
        "ui:classNames": appendClass(
          existing["ui:classNames"],
          "form-field--inherited",
        ),
        "ui:options": {
          ...options,
          ...(inheritedFrom ? { inheritedFrom } : {}),
        },
      };
    }

    if (highlightedKeys?.has(key)) {
      const existing = (ui[key] as Record<string, any>) || {};
      ui[key] = {
        ...existing,
        "ui:classNames": appendClass(
          existing["ui:classNames"],
          "form-field--non-default",
        ),
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

export const deepEqual = (a: any, b: any) =>
  JSON.stringify(a) === JSON.stringify(b);

export const computeNonDefaultKeys = (
  data: any,
  schema: RJSFSchema,
): Set<string> => {
  const result = new Set<string>();
  const properties = (schema.properties as Record<string, any>) || {};

  const isEmptyValue = (value: any) => {
    if (value === undefined || value === null) {
      return true;
    }
    if (typeof value === "string" && value.trim() === "") {
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
    const wasPresent = Object.prototype.hasOwnProperty.call(
      original || {},
      key,
    );
    const defaultValue = properties[key]?.default;

    if (Array.isArray(value) && value.length === 0) {
      return;
    }

    const equalsDefault =
      defaultValue !== undefined && deepEqual(value, defaultValue);

    if (!wasPresent && equalsDefault) {
      return;
    }

    result[key] = value;
  });

  return result;
};

export { sanitizeConfigForSave } from "../shared/sanitizeConfigForSave";

export const stripTitlePrefix = (title: string, prefix: string): string => {
  const cleanPrefix = prefix.replace(/_+$/, "");
  if (!cleanPrefix) {
    return title;
  }

  const escaped = cleanPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^${escaped}(?:\\s+linter)?(?:\\s*[-:])?\\s*`,
    "i",
  );
  return title.replace(pattern, "").trimStart();
};

export const stripDescriptionPrefix = (
  description: string,
  prefix: string,
): string => {
  const cleanPrefix = prefix.replace(/_+$/, "");
  if (!cleanPrefix) {
    return description;
  }
  const escaped = cleanPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}\\s*:\\s*`, "i");
  return description.replace(pattern, "").trimStart();
};

export const categorizeTheme = (
  theme: string,
  strippedKey: string,
  fullKey: string,
): string => {
  return theme || strippedKey || fullKey;
};

export const isDeprecatedPropertyTitle = (
  schema: RJSFSchema,
  key: string,
): boolean => {
  const properties = (schema.properties as Record<string, any>) || {};
  const title = properties[key]?.title;
  if (typeof title !== "string") {
    return false;
  }
  const lower = title.toLowerCase();
  return lower.includes("deprecated") || lower.includes("removed");
};

export const sortKeysWithinCategory = (keys: string[], category: string) => {
  const priority = (key: string) => {
    const upper = key.toUpperCase();

    if (category === "prepost") {
      if (upper.includes("PRE_")) {
        return 0;
      }
      if (upper.includes("POST_")) {
        return 1;
      }
      return 2;
    }

    if (category === "command") {
      if (
        upper.includes("CUSTOM_REMOVE_ARGUMENTS") ||
        upper.includes("REMOVE_ARGUMENTS")
      ) {
        return 1;
      }
      if (
        upper.includes("CUSTOM_ARGUMENTS") ||
        (upper.includes("ARGUMENTS") && !upper.includes("REMOVE"))
      ) {
        return 0;
      }
      return 2;
    }

    if (category === "scope") {
      if (upper.includes("FILE_NAME") && upper.includes("REGEX")) {
        return 0;
      }
      if (upper.includes("REGEX")) {
        return 1;
      }
      if (upper.includes("FILE_EXT")) {
        return 2;
      }
      return 3;
    }

    return 2;
  };

  return [...keys].sort(
    (a, b) => priority(a) - priority(b) || a.localeCompare(b),
  );
};
