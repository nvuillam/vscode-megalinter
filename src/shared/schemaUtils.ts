import type { RJSFSchema } from '@rjsf/utils';

export type SchemaGroups = {
  generalKeys: string[];
  descriptorKeys: Record<string, string[]>;
  linterKeys: Record<string, Record<string, string[]>>;
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

export const extractGroups = (schema: RJSFSchema): SchemaGroups => {
  const properties = (schema.properties as Record<string, any>) || {};
  const descriptorEnums = (schema.definitions as any)?.enum_descriptor_keys?.enum as string[] | undefined;
  const linterEnums = (schema.definitions as any)?.enum_linter_keys?.enum as string[] | undefined;

  const descriptorListRaw = Array.isArray(descriptorEnums) ? descriptorEnums : [];
  const linterListRaw = Array.isArray(linterEnums) ? linterEnums : [];
  const linterList = linterListRaw.filter((l) => !REMOVED_LINTERS.has(l));

  const descriptorsWithLinters = new Set<string>();
  linterList.forEach((l) => {
    const [descriptorId] = l.split('_');
    if (descriptorId) {
      descriptorsWithLinters.add(descriptorId);
    }
  });

  const descriptorList = descriptorListRaw.filter((d) => descriptorsWithLinters.has(d));

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
  const removedLinterPrefixes = Array.from(REMOVED_LINTERS).map((l) => `${l}_`);

  Object.keys(properties).forEach((propKey) => {
    if (removedLinterPrefixes.some((p) => propKey.startsWith(p))) {
      return;
    }

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

  Object.keys(descriptorKeys).forEach((d) => {
    if (!descriptorList.includes(d)) {
      delete descriptorKeys[d];
    }
  });

  return { generalKeys, descriptorKeys, linterKeys };
};
