/* eslint-disable @typescript-eslint/naming-convention */
export const DOCS_BASE = 'https://megalinter.io/latest' as const;

export interface MegaLinterSchemaMeta {
  ['x-section']?: unknown;
  ['x-category']?: unknown;
}

const RESERVED_CATEGORY_IDS = new Set(
  [
    'GENERAL',
    'MISC',
    'ACTIVATION',
    'SCOPE',
    'ERRORS',
    'LINTER_COMMAND',
    'PREPOSTCOMMANDS',
    'FIXES',
    'PERFORMANCE',
    'OUTPUT',
    'SECURITY',
    'PLUGINS',
    'REPORTERS'
  ].map((v) => v.toUpperCase())
);

const DOCS_URLS_BY_VARIABLE: Record<string, string> = {
  // Most variables are covered by inferred URLs below; keep explicit overrides for best targets.
  MEGALINTER_CONFIG: `${DOCS_BASE}/config-file/`,

  // Plugins
  PLUGINS: `${DOCS_BASE}/plugins/`,

  // Activation / deactivation
  ENABLE: `${DOCS_BASE}/config-activation/`,
  ENABLE_LINTERS: `${DOCS_BASE}/config-activation/`,
  DISABLE: `${DOCS_BASE}/config-activation/`,
  DISABLE_LINTERS: `${DOCS_BASE}/config-activation/`,
  DISABLE_ERRORS_LINTERS: `${DOCS_BASE}/config-activation/`,
  ENABLE_ERRORS_LINTERS: `${DOCS_BASE}/config-activation/`,

  // Filtering
  FILTER_REGEX_INCLUDE: `${DOCS_BASE}/config-filtering/`,
  FILTER_REGEX_EXCLUDE: `${DOCS_BASE}/config-filtering/`,
  MEGALINTER_FILES_TO_LINT: `${DOCS_BASE}/config-filtering/`,

  // Fixes
  APPLY_FIXES: `${DOCS_BASE}/config-apply-fixes/`,
  APPLY_FIXES_EVENT: `${DOCS_BASE}/config-apply-fixes/`,
  APPLY_FIXES_MODE: `${DOCS_BASE}/config-apply-fixes/`,

  // Commands
  PRE_COMMANDS: `${DOCS_BASE}/config-precommands/`,
  POST_COMMANDS: `${DOCS_BASE}/config-postcommands/`,

  // CLI lint mode
  SKIP_CLI_LINT_MODES: `${DOCS_BASE}/config-cli-lint-mode/`,

  // Security
  SECURED_ENV_VARIABLES: `${DOCS_BASE}/config-variables-security/`,
  SECURED_ENV_VARIABLES_DEFAULT: `${DOCS_BASE}/config-variables-security/`,

  // Reports
  REPORT_OUTPUT_FOLDER: `${DOCS_BASE}/reporters/`
};

const normalizeKey = (value: string): string => value.trim().toUpperCase();

const looksLikeDescriptorOrLinterKey = (value: string): boolean => {
  // Examples: BASH, PYTHON, PYTHON_RUFF, REPOSITORY_TRIVY
  if (!/^[A-Z0-9_]+$/.test(value)) {
    return false;
  }
  // Avoid mapping generic section ids to /descriptors/.
  return !RESERVED_CATEGORY_IDS.has(value);
};

const resolveUrlFromSection = (sectionId: string, variableName: string): string | undefined => {
  const section = normalizeKey(sectionId);
  const normalizedVar = normalizeKey(variableName);

  switch (section) {
    case 'ACTIVATION':
      return `${DOCS_BASE}/config-activation/`;
    case 'SCOPE':
      return `${DOCS_BASE}/config-filtering/`;
    case 'FIXES':
      return `${DOCS_BASE}/config-apply-fixes/`;
    case 'PREPOSTCOMMANDS':
      if (normalizedVar.startsWith('POST_')) {
        return `${DOCS_BASE}/config-postcommands/`;
      }
      return `${DOCS_BASE}/config-precommands/`;
    case 'SECURITY':
      return `${DOCS_BASE}/config-variables-security/`;
    case 'PLUGINS':
      return `${DOCS_BASE}/plugins/`;
    case 'REPORTERS':
      return `${DOCS_BASE}/reporters/`;
    default:
      return undefined;
  }
};

const resolveUrlFromVariableHeuristics = (variableName: string): string => {
  const name = normalizeKey(variableName);

  if (name.startsWith('LLM_')) {
    return `${DOCS_BASE}/llm-advisor/`;
  }
  if (name.includes('REPORTER') || name.startsWith('REPORT_')) {
    return `${DOCS_BASE}/reporters/`;
  }
  if (name.includes('PLUGIN')) {
    return `${DOCS_BASE}/plugins/`;
  }
  if (name.includes('FILTER_REGEX')) {
    return `${DOCS_BASE}/config-filtering/`;
  }
  if (name.includes('APPLY_FIX')) {
    return `${DOCS_BASE}/config-apply-fixes/`;
  }
  if (name.includes('PRE_COMMAND')) {
    return `${DOCS_BASE}/config-precommands/`;
  }
  if (name.includes('POST_COMMAND')) {
    return `${DOCS_BASE}/config-postcommands/`;
  }
  if (name.includes('CLI_LINT_MODE')) {
    return `${DOCS_BASE}/config-cli-lint-mode/`;
  }
  return `${DOCS_BASE}/config-variables/`;
};

export const getDocsUrlForVariable = (variableName: string, schemaMeta?: MegaLinterSchemaMeta): string | undefined => {
  if (!variableName) {
    return undefined;
  }

  const normalized = normalizeKey(variableName);

  // Highest priority: explicit per-variable overrides.
  const override = DOCS_URLS_BY_VARIABLE[normalized];
  if (override) {
    return override;
  }

  // Next: use x-category to link to a descriptor/linter page when it looks like one.
  const category = typeof schemaMeta?.['x-category'] === 'string' ? normalizeKey(schemaMeta['x-category'] as string) : undefined;
  if (category && looksLikeDescriptorOrLinterKey(category)) {
    return `${DOCS_BASE}/descriptors/${category.toLowerCase()}/`;
  }

  // Next: use x-section for best matching config pages.
  const section = typeof schemaMeta?.['x-section'] === 'string' ? (schemaMeta['x-section'] as string) : undefined;
  if (section) {
    const bySection = resolveUrlFromSection(section, normalized);
    if (bySection) {
      return bySection;
    }
  }

  // Last resort: deterministic heuristic so *every* variable still has a docs button.
  return resolveUrlFromVariableHeuristics(normalized);
};
