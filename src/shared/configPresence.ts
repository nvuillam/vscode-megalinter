import { SchemaGroups } from './schemaUtils';

type KeyContainer = Set<string> | Record<string, any>;

const hasKey = (container: KeyContainer, key: string): boolean => {
  if (container instanceof Set) {
    return container.has(key);
  }
  return Object.prototype.hasOwnProperty.call(container || {}, key);
};

export const hasAnyKeySet = (keys: string[], data: KeyContainer): boolean =>
  keys.some((key) => hasKey(data, key));

export const buildPresenceMaps = (groups: SchemaGroups, data: KeyContainer) => {
  const descriptorHasValues: Record<string, boolean> = {};
  const linterHasValues: Record<string, Record<string, boolean>> = {};
  const genericHasValues: Record<string, boolean> = {};
  const generalHasValues = hasAnyKeySet(groups.generalKeys, data);

  Object.entries(groups.genericCategoryKeys).forEach(([categoryId, keys]) => {
    genericHasValues[categoryId] = hasAnyKeySet(keys, data);
  });

  Object.entries(groups.descriptorKeys).forEach(([descriptorId, keys]) => {
    const linters = groups.linterKeys[descriptorId] || {};
    const perLinter: Record<string, boolean> = {};

    Object.entries(linters).forEach(([linterId, linterKeys]) => {
      perLinter[linterId] = hasAnyKeySet(linterKeys, data);
    });

    const descriptorValue = hasAnyKeySet(keys, data) || Object.values(perLinter).some(Boolean);
    linterHasValues[descriptorId] = perLinter;
    descriptorHasValues[descriptorId] = descriptorValue;
  });

  return { generalHasValues, genericHasValues, descriptorHasValues, linterHasValues };
};
