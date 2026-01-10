/* eslint-disable @typescript-eslint/naming-convention */
import type { RJSFSchema } from '@rjsf/utils';

const DEFAULT_ICON = 'symbol-property';

export const getCodiconForSection = (sectionId: string): string => {
  const id = (sectionId || '').toLowerCase();
  const map: Record<string, string> = {
    home: 'home',
    summary: 'graph',
    general: 'settings-gear',
    generic: 'megaphone',
    descriptors: 'extensions',
    activation: 'rocket',
    scope: 'symbol-namespace',
    errors: 'error',
    output: 'output',
    fixes: 'wrench',
    pre_post_commands: 'terminal',
    performance: 'dashboard',
    plugins: 'extensions',
    security: 'shield',
    misc: 'settings-gear',
    miscellaneous: 'settings-gear',
    description: 'info'
  };

  return map[id] || DEFAULT_ICON;
};

export const getCodiconForNavigationItem = (
  itemType: 'home' | 'summary' | 'general' | 'category' | 'descriptor' | 'linter',
  itemId: string,
  parentSectionId?: string
): string => {
  const id = (itemId || '').toUpperCase();

  if (itemType === 'home' || itemType === 'summary' || itemType === 'general') {
    return getCodiconForSection(itemType);
  }

  if (itemType === 'descriptor') {
    return 'extensions';
  }

  if (itemType === 'linter') {
    return 'tools';
  }

  // Reporter categories (generic)
  if (itemType === 'category') {
    if (id.includes('REPORT') || id.includes('REPORTER')) {
      return 'megaphone';
    }
    if (id.includes('OUTPUT') || id.includes('LOG')) {
      return 'output';
    }
    if (id.includes('SECURITY')) {
      return 'shield';
    }
    if (id.includes('GIT') || id.includes('REPOSITORY')) {
      return 'repo';
    }
    if (parentSectionId) {
      return getCodiconForSection(parentSectionId);
    }
    return 'megaphone';
  }

  return DEFAULT_ICON;
};

export const getCodiconForVariable = (variableName: string, schema?: RJSFSchema | Record<string, unknown>): string => {
  const name = (variableName || '').toUpperCase();
  const section =
    typeof (schema as any)?.['x-section'] === 'string' ? String((schema as any)['x-section']).toLowerCase() : '';
  const category =
    typeof (schema as any)?.['x-category'] === 'string' ? String((schema as any)['x-category']).toUpperCase() : '';

  // Very specific known variables
  if (name === 'APPLY_FIXES_EVENT') {
    return 'symbol-event';
  }
  if (name === 'APPLY_FIXES_MODE') {
    return 'symbol-enum';
  }
  if (name === 'APPLY_FIXES' || name.startsWith('APPLY_FIXES_')) {
    return 'wrench';
  }

  // Variable-name first (highest priority).
  if (name.includes('SECURITY') || name.includes('SECRET') || name.includes('PASSWORD') || name.includes('TOKEN')) {
    return 'shield';
  }
  if (name.includes('ERROR')) {
    return 'error';
  }
  if (name.includes('REPORT') || name.includes('OUTPUT') || name.includes('LOG')) {
    return 'output';
  }
  if (name.includes('FIX')) {
    return 'wrench';
  }
  if (name.includes('PRE_COMMANDS') || name.includes('POST_COMMANDS') || name.includes('COMMAND')) {
    return 'terminal';
  }
  if (name.includes('ENABLE') || name.includes('ACTIVATE')) {
    return 'check';
  }
  if (name.includes('DISABLE') || name.includes('DEACTIVATE')) {
    return 'circle-slash';
  }
  if (name.includes('FILTER') || name.includes('INCLUDE') || name.includes('EXCLUDE')) {
    return 'filter';
  }

  // Then section/category context as fallback.
  if (section) {
    return getCodiconForSection(section);
  }

  // Category-based: reporters vs linters/descriptors.
  if (category.includes('REPORT')) {
    return 'megaphone';
  }
  // Descriptor/linter categories are typically uppercase ids. Heuristic: underscores often indicate a linter.
  if (category && /[A-Z]/.test(category)) {
    if (category.includes('_')) {
      return 'tools';
    }
    return 'symbol-namespace';
  }

  return DEFAULT_ICON;
};
