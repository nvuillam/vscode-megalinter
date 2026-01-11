import type { RJSFSchema, UiSchema } from '@rjsf/utils';
import type { SchemaGroups } from '../../shared/schemaUtils';

// ============================================================================
// VS Code API Types
// ============================================================================

export interface VSCodeAPI {
  postMessage: (message: ExtensionMessage) => void;
  setState: (state: PersistedState) => void;
  getState: () => PersistedState | undefined;
}

declare global {
  interface Window {
    acquireVsCodeApi: () => VSCodeAPI;
  }
}

// ============================================================================
// Message Types (Extension ↔ WebView)
// ============================================================================

export type ExtensionMessage =
  | { type: 'ready' }
  | { type: 'getConfig' }
  | { type: 'saveConfig'; config: MegaLinterConfig }
  | { type: 'installMegaLinter' }
  | { type: 'upgradeMegaLinter' }
  | { type: 'openCustomFlavorBuilder' }
  | { type: 'openExternal'; url: string }
  | { type: 'resolveLinterConfigFile'; linterKey: string; overrides?: { linterRulesPath?: string; configFile?: string } }
  | { type: 'createLinterConfigFileFromDefault'; linterKey: string; destination?: { linterRulesPath?: string; configFile?: string } }
  | { type: 'getFlavorContext' }
  | { type: 'pickFlavorFolder' }
  | { type: 'runCustomFlavorSetup'; folderPath: string; linters?: string[] }
  | { type: 'loadFlavorDefinition'; folderPath: string }
  | { type: 'openFile'; filePath: string }
  | { type: 'info'; message: string }
  | { type: 'error'; message: string };

export type WebViewMessage =
  | { type: 'configData'; config: MegaLinterConfig; configPath: string; configExists: boolean; linterMetadata: LinterMetadataMap }
  | { type: 'linterConfigFileInfo'; linterKey: string; resolved: boolean; configFileName?: string; rulesPath?: string; local?: LinterConfigFileDetails; defaultTemplate?: LinterDefaultConfigDetails }
  | { type: 'navigate'; target: NavigationTarget };

export type FlavorContextMessage = {
  type: 'flavorContext';
  workspaceFolders: Array<{ name: string; path: string }>;
  defaultFolderPath?: string;
  isWorkspaceFlavorRepo?: boolean;
};

export type FlavorFolderSelectedMessage = {
  type: 'flavorFolderSelected';
  folderPath: string;
};

export type FlavorDefinitionMessage = {
  type: 'flavorDefinition';
  folderPath: string;
  exists: boolean;
  filePath: string;
  content?: string;
};

// ============================================================================
// Navigation Types
// ============================================================================

export type NavigationTarget =
  | { type: 'home' }
  | { type: 'general' }
  | { type: 'summary' }
  | { type: 'category'; categoryId: string }
  | { type: 'descriptor'; descriptorId: string }
  | { type: 'linter'; descriptorId: string; linterId: string };

export type MainTabId = 'home' | 'summary' | 'general' | 'category' | 'descriptors';

export interface ViewState {
  activeMainTab: MainTabId;
  selectedCategory: string | null;
  selectedDescriptor: string | null;
  selectedScope: string | null;
  activeGeneralTheme: string | null;
  activeDescriptorThemes: Record<string, string>;
  activeLinterThemes: Record<string, Record<string, string>>;
}

export interface PersistedState extends ViewState {
  cachedSchema?: CachedSchema | null;
  flavorBuilder?: {
    folderPath?: string;
    selectedLinters?: string[];
  };
}

// ============================================================================
// Schema & Configuration Types
// ============================================================================

export interface CachedSchema {
  schema: RJSFSchema;
  timestamp: number;
}

/**
 * MegaLinter configuration object - keys are configuration variable names,
 * values can be strings, numbers, booleans, or arrays
 */
export type MegaLinterConfigValue = string | number | boolean | string[] | undefined;
export type MegaLinterConfig = Record<string, MegaLinterConfigValue>;

// ============================================================================
// Linter Metadata Types
// ============================================================================

export interface LinterLink {
  label: string;
  href: string;
}

export interface LinterDescriptorMetadata {
  descriptorId?: string;
  name?: string;
  linterName?: string;
  configFileName?: string;
  url?: string;
  repo?: string;
  imageUrl?: string;
  bannerImageUrl?: string;
  text?: string;
  urls?: LinterLink[];
}

export type LinterMetadataMap = Record<string, LinterDescriptorMetadata>;

// ============================================================================
// Linter config file preview types
// ============================================================================

export interface LinterConfigFileDetails {
  exists: boolean;
  filePath?: string;
  content?: string;
  truncated?: boolean;
}

export interface LinterDefaultConfigDetails {
  exists: boolean;
  source?: 'remote' | 'local';
  content?: string;
  truncated?: boolean;
}

export interface LinterConfigFileInfo {
  linterKey: string;
  resolved: boolean;
  configFileName?: string;
  rulesPath?: string;
  local?: LinterConfigFileDetails;
  defaultTemplate?: LinterDefaultConfigDetails;
}

// ============================================================================
// Navigation Menu Types
// ============================================================================

export interface MenuChild {
  id: string;
  label: string;
  type: 'linter';
  parentId: string;
  hasValues: boolean;
}

export interface MenuItem {
  id: string;
  label: string;
  type: 'home' | 'summary' | 'general' | 'category' | 'descriptor';
  hasValues: boolean;
  children?: MenuChild[];
}

export type MenuSectionId = 'home' | 'summary' | 'general' | 'generic' | 'descriptors';

export interface MenuSection {
  id: MenuSectionId;
  label: string;
  items: MenuItem[];
}

export interface NavigationModel {
  sections: MenuSection[];
  descriptorOrder: string[];
}

// ============================================================================
// Form & Tab Types
// ============================================================================

export interface Tab {
  id: string;
  label: string;
  hasValues?: boolean;
  icon?: string;
  disabled?: boolean;
}

export interface BreadcrumbOption {
  id: string;
  label: string;
  onSelect: () => void;
}

export interface BreadcrumbItem {
  id: string;
  label: string;
  onClick?: () => void;
  options?: BreadcrumbOption[];
}

export interface SearchItem {
  id: string;
  label: string;
  type: 'descriptor' | 'linter' | 'reporter';
  descriptorId?: string;
  linterId?: string;
  categoryId?: string;
}

// ============================================================================
// Component Props Types
// ============================================================================

export interface HomePanelProps {
  configPath: string;
  configExists: boolean;
  configLoaded: boolean;
  configuredCount: number;
  totalKeys: number;
  descriptorCount: number;
  linterCount: number;
  postMessage: (message: ExtensionMessage) => void;
  onOpenGeneral: () => void;
  onOpenSummary: () => void;
  onOpenFirstDescriptor: () => void;
  onOpenReporters: () => void;
  logoUrl: string;
  logoFallbackUrl: string;
  bannerUrl: string;
  bannerFallbackUrl: string;
  descriptorLabel: string;
  reportersLabel: string;
  hasConfiguration: boolean;
  descriptorNavigationReady: boolean;
  reporterNavigationReady: boolean;
  searchItems: SearchItem[];
  onSearchSelect: (item: SearchItem) => void;
}

export interface NavigationMenuProps {
  sections: MenuSection[];
  selectedId: string;
  activeDescriptorId: string | null;
  onSelect: (item: MenuItem | MenuChild) => void;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

export interface LinterDescriptionProps {
  metadata?: LinterDescriptorMetadata;
  linterLabel: string;
  descriptorId?: string;
  linterId?: string;
}

export interface ThemedFormProps {
  baseSchema: RJSFSchema;
  keys: string[];
  title: string;
  uiSchema: UiSchema;
  formData: MegaLinterConfig;
  onSubsetChange: (keys: string[], subset: MegaLinterConfig) => void;
  activeThemeTab: string | null;
  setActiveThemeTab: (id: string | null) => void;
  sectionMeta: SchemaGroups['sectionMeta'];
  prefixToStrip?: string;
  highlightedKeys: Set<string>;
  introTabs?: IntroTab[];
}

export interface IntroTab {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  content: React.ReactNode;
}

export interface MainTabsProps {
  schema: RJSFSchema;
  groups: SchemaGroups;
  formData: MegaLinterConfig;
  uiSchema: UiSchema;
  onSubsetChange: (keys: string[], subsetData: MegaLinterConfig) => void;
  postMessage: (message: ExtensionMessage) => void;
  descriptorOrder: string[];
  activeMainTab: MainTabId;
  setActiveMainTab: (id: MainTabId) => void;
  selectedCategory: string | null;
  setSelectedCategory: (id: string | null) => void;
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
  linterMetadata: LinterMetadataMap;
  linterConfigFiles: Record<string, LinterConfigFileInfo>;
}

export interface TabBarProps {
  tabs: Tab[];
  activeTab: string;
  onSelect: (id: string) => void;
}

// ============================================================================
// Presence Maps (for tracking which fields have values)
// ============================================================================

export interface PresenceMaps {
  generalHasValues: boolean;
  genericHasValues: Record<string, boolean>;
  descriptorHasValues: Record<string, boolean>;
  linterHasValues: Record<string, Record<string, boolean>>;
}
