/* eslint-disable @typescript-eslint/naming-convention */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';
import type { MainTabsProps, Tab, BreadcrumbItem, BreadcrumbOption } from '../types';
import {
  buildPresenceMaps,
  hasAnyKeySet
} from '../../shared/configPresence';
import {
  buildScopedUiSchema,
  buildSubsetSchema,
  filterFormData,
  prettifyId
} from '../menuUtils';
import { Breadcrumbs } from './Breadcrumbs';
import { ThemedForm } from './ThemedForm';
import { LinterDescription } from './LinterDescription';
import { DocFieldTemplate } from './DocFieldTemplate';
import { CheckboxWidget, DualListWidget, TagArrayFieldTemplate } from './widgets';

export const MainTabs: React.FC<MainTabsProps> = ({
  schema,
  groups,
  formData,
  originalConfig,
  uiSchema,
  onSubsetChange,
  postMessage,
  descriptorOrder: descriptorOrderProp,
  activeMainTab,
  setActiveMainTab,
  selectedCategory,
  setSelectedCategory,
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
  highlightedKeys,
  linterMetadata,
  linterConfigFiles
}) => {
  const [brokenLinterIcons, setBrokenLinterIcons] = useState<Record<string, boolean>>({});
  const [resolvingLinterConfig, setResolvingLinterConfig] = useState<Record<string, boolean>>({});
  const lastResolveSignature = useRef<Record<string, string>>({});

  const activeLinterKey = useMemo(() => {
    if (activeMainTab !== 'descriptors') {
      return null;
    }
    if (!selectedScope || selectedScope === 'descriptor') {
      return null;
    }
    return selectedScope;
  }, [activeMainTab, selectedScope]);

  const activeLinterOverrides = useMemo(() => {
    if (!activeLinterKey) {
      return null;
    }

    // Use persisted config to detect explicit overrides and avoid transient defaults added by RJSF
    // when switching between themed tabs (e.g. Linter Command).
    const rulesPath = Object.prototype.hasOwnProperty.call(originalConfig || {}, 'LINTER_RULES_PATH')
      ? (typeof originalConfig?.LINTER_RULES_PATH === 'string' ? String(originalConfig.LINTER_RULES_PATH) : undefined)
      : undefined;

    const configKey = `${activeLinterKey}_CONFIG_FILE`;
    const configFile = Object.prototype.hasOwnProperty.call(originalConfig || {}, configKey)
      ? (typeof originalConfig?.[configKey] === 'string' ? String(originalConfig[configKey]) : undefined)
      : undefined;

    return { rulesPath, configFile };
  }, [activeLinterKey, originalConfig]);

  useEffect(() => {
    if (!activeLinterKey) {
      return;
    }

    const signature = JSON.stringify({
      linterKey: activeLinterKey,
      rulesPath: activeLinterOverrides?.rulesPath ?? null,
      configFile: activeLinterOverrides?.configFile ?? null
    });

    if (lastResolveSignature.current[activeLinterKey] === signature) {
      return;
    }
    lastResolveSignature.current[activeLinterKey] = signature;

    setResolvingLinterConfig((prev) => ({ ...prev, [activeLinterKey]: true }));
    postMessage({
      type: 'resolveLinterConfigFile',
      linterKey: activeLinterKey,
      overrides: {
        linterRulesPath: activeLinterOverrides?.rulesPath,
        configFile: activeLinterOverrides?.configFile
      }
    });
  }, [activeLinterKey, activeLinterOverrides?.rulesPath, activeLinterOverrides?.configFile, postMessage]);

  useEffect(() => {
    if (!activeLinterKey) {
      return;
    }
    const info = linterConfigFiles[activeLinterKey];
    if (info?.resolved) {
      setResolvingLinterConfig((prev) => {
        if (!prev[activeLinterKey]) {
          return prev;
        }
        return { ...prev, [activeLinterKey]: false };
      });
    }
  }, [activeLinterKey, linterConfigFiles]);

  const markLinterIconBroken = useCallback((linterId: string) => {
    setBrokenLinterIcons((prev) => {
      if (prev[linterId]) {
        return prev;
      }
      return { ...prev, [linterId]: true };
    });
  }, []);

  const descriptorOrder = useMemo(() => {
    if (descriptorOrderProp.length) {
      return descriptorOrderProp;
    }
    return Object.keys(groups.descriptorKeys).sort();
  }, [descriptorOrderProp, groups]);
  
  const presence = useMemo(() => buildPresenceMaps(groups, formData), [groups, formData]);
  const linterHasValues = presence.linterHasValues;
  
  const resolveCategoryLabel = (categoryId: string) => {
    const meta = groups.categoryMeta[categoryId];
    if (meta?.kind === 'linter' && meta.parentId && categoryId.startsWith(`${meta.parentId}_`)) {
      return prettifyId(categoryId.replace(`${meta.parentId}_`, ''));
    }
    if (meta?.label) {
      return prettifyId(meta.label);
    }
    return prettifyId(categoryId);
  };

  const compareCategories = (a: string, b: string) => {
    const orderA = groups.categoryMeta[a]?.order ?? Number.MAX_SAFE_INTEGER;
    const orderB = groups.categoryMeta[b]?.order ?? Number.MAX_SAFE_INTEGER;
    if (orderA === orderB) {
      return resolveCategoryLabel(a).localeCompare(resolveCategoryLabel(b));
    }
    return orderA - orderB;
  };

  const goHome = () => {
    setActiveMainTab('home');
    setSelectedCategory(null);
    setSelectedDescriptor(null);
    setSelectedScope(null);
  };

  const renderSummary = () => {
    const properties = (schema.properties as Record<string, unknown>) || {};
    const sectionOrder = groups.sectionMeta.order || [];
    const sectionLabels = groups.sectionMeta.labels || {};

    const configuredKeys = Object.keys(formData || {}).filter((key) => {
      const value = formData?.[key];
      if (value === undefined || value === null) {
        return false;
      }
      if (typeof value === 'string' && value.trim() === '') {
        return false;
      }
      if (Array.isArray(value) && value.length === 0) {
        return false;
      }
      return true;
    });

    const categoryKindRank: Record<string, number> = {
      generic: 1,
      descriptor: 2,
      linter: 3,
      other: 4
    };

    const resolveCategory = (key: string) => {
      const prop = properties[key] as Record<string, unknown> || {};
      const categoryId = prop['x-category'] as string | undefined;
      const meta = categoryId ? groups.categoryMeta[categoryId] : undefined;
      if (groups.generalKeys.includes(key)) {
        return { id: 'GENERAL', label: 'General', kind: 'generic' as const, meta: groups.categoryMeta['GENERAL'] };
      }
      const genericEntry = Object.entries(groups.genericCategoryKeys).find(([, keys]) => keys.includes(key));
      if (genericEntry) {
        const [id] = genericEntry;
        return { id, label: resolveCategoryLabel(id), kind: 'generic' as const, meta: groups.categoryMeta[id] };
      }
      const descriptorEntry = Object.entries(groups.descriptorKeys).find(([, keys]) => keys.includes(key));
      if (descriptorEntry) {
        const [id] = descriptorEntry;
        return { id, label: resolveCategoryLabel(id), kind: 'descriptor' as const, meta: groups.categoryMeta[id] };
      }
      const linterEntry = Object.entries(groups.linterKeys).find(([, linters]) =>
        Object.entries(linters).some(([, keys]) => keys.includes(key))
      );
      if (linterEntry) {
        const [descriptorId, linters] = linterEntry;
        const linterId = Object.keys(linters).find((l) => linters[l].includes(key));
        if (linterId) {
          return {
            id: linterId,
            label: resolveCategoryLabel(linterId),
            kind: 'linter' as const,
            meta: groups.categoryMeta[linterId],
            parent: descriptorId
          };
        }
      }
      if (meta) {
        return { id: meta.id, label: resolveCategoryLabel(meta.id), kind: meta.kind, meta };
      }
      return { id: 'OTHER', label: 'Other', kind: 'other' as const, meta: undefined };
    };

    const resolveSection = (key: string) => {
      const prop = properties[key] as Record<string, unknown> || {};
      const sectionId = typeof prop['x-section'] === 'string' ? (prop['x-section'] as string) : 'MISC';
      const index = sectionOrder.indexOf(sectionId);
      const sectionLabel = sectionLabels[sectionId] || prettifyId(sectionId);
      return { id: sectionId, index: index === -1 ? Number.MAX_SAFE_INTEGER : index, label: sectionLabel };
    };

    const orderedKeys = [...configuredKeys].sort((a, b) => {
      const catA = resolveCategory(a);
      const catB = resolveCategory(b);
      const kindA = catA.kind === 'generic' && catA.id === 'GENERAL' ? -1 : categoryKindRank[catA.kind] ?? 99;
      const kindB = catB.kind === 'generic' && catB.id === 'GENERAL' ? -1 : categoryKindRank[catB.kind] ?? 99;
      if (kindA !== kindB) {
        return kindA - kindB;
      }
      if (catA.label !== catB.label) {
        return catA.label.localeCompare(catB.label);
      }

      const secA = resolveSection(a);
      const secB = resolveSection(b);
      if (secA.index !== secB.index) {
        return secA.index - secB.index;
      }
      if (secA.label !== secB.label) {
        return secA.label.localeCompare(secB.label);
      }

      const propA = properties[a] as Record<string, unknown> || {};
      const propB = properties[b] as Record<string, unknown> || {};
      const orderA = typeof propA['x-order'] === 'number' ? (propA['x-order'] as number) : Number.MAX_SAFE_INTEGER;
      const orderB = typeof propB['x-order'] === 'number' ? (propB['x-order'] as number) : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return a.localeCompare(b);
    });

    if (!configuredKeys.length) {
      return (
        <div className="summary-panel">
          <Breadcrumbs
            items={[
              { id: 'home', label: 'MegaLinter Home', onClick: goHome },
              { id: 'summary', label: 'Summary' }
            ]}
          />
          <p className="muted">No configuration values set yet.</p>
        </div>
      );
    }

    const summarySchema = buildSubsetSchema(schema, orderedKeys, 'Configured values');
    const summaryUiSchema = buildScopedUiSchema(schema, orderedKeys, uiSchema, highlightedKeys);

    return (
      <div className="summary-panel">
        <Breadcrumbs
          items={[
            { id: 'home', label: 'MegaLinter Home', onClick: goHome },
            { id: 'summary', label: 'Summary' }
          ]}
        />
        <Form
          schema={summarySchema}
          formData={filterFormData(formData, orderedKeys)}
          onChange={(e) => {
            const data = e.formData;
            onSubsetChange(orderedKeys, data);
          }}
          validator={validator}
          uiSchema={summaryUiSchema}
          liveValidate
          noHtml5Validate
          showErrorList={false}
          widgets={{ dualList: DualListWidget, CheckboxWidget }}
          templates={{ ArrayFieldTemplate: TagArrayFieldTemplate, FieldTemplate: DocFieldTemplate }}
          idPrefix="summary"
        >
          <></>
        </Form>
      </div>
    );
  };

  const renderGeneral = () => (
    <div className="general-panel">
      <Breadcrumbs
        items={[
          { id: 'home', label: 'MegaLinter Home', onClick: goHome },
          { id: 'general', label: 'General settings' }
        ]}
      />
      <ThemedForm
        baseSchema={schema}
        keys={groups.generalKeys}
        title="General settings"
        uiSchema={uiSchema}
        formData={filterFormData(formData, groups.generalKeys)}
        onSubsetChange={(keys, subset) => onSubsetChange(keys, subset)}
        activeThemeTab={activeGeneralTheme}
        setActiveThemeTab={setActiveGeneralTheme}
        sectionMeta={groups.sectionMeta}
        highlightedKeys={highlightedKeys}
      />
    </div>
  );

  const renderCategory = () => {
    const categoryIds = Object.keys(groups.genericCategoryKeys);
    const categoryId =
      (selectedCategory && categoryIds.includes(selectedCategory) && selectedCategory) || categoryIds[0];

    if (!categoryId) {
      return (
        <div className="category-panel">
          <Breadcrumbs
            items={[
              { id: 'home', label: 'MegaLinter Home', onClick: goHome },
              { id: 'category', label: 'Categories' }
            ]}
          />
          <p className="muted">No categories available</p>
        </div>
      );
    }

    const categoryKeys = groups.genericCategoryKeys[categoryId] || [];
    const label = resolveCategoryLabel(categoryId);

    const categoryOptions: BreadcrumbOption[] = categoryIds.map((id) => ({
      id,
      label: resolveCategoryLabel(id),
      onSelect: () => {
        setSelectedCategory(id);
        setActiveMainTab('category');
      }
    }));

    return (
      <div className="category-panel">
        <Breadcrumbs
          items={[
            { id: 'home', label: 'MegaLinter Home', onClick: goHome },
            { id: categoryId, label, options: categoryOptions }
          ]}
        />
        <ThemedForm
          baseSchema={schema}
          keys={categoryKeys}
          title={`${label} settings`}
          uiSchema={uiSchema}
          formData={filterFormData(formData, categoryKeys)}
          onSubsetChange={(keys, subset) => onSubsetChange(keys, subset)}
          activeThemeTab={activeDescriptorThemes[categoryId] || null}
          setActiveThemeTab={(id) =>
            setActiveDescriptorThemes({ ...activeDescriptorThemes, [categoryId]: id || '' })
          }
          sectionMeta={groups.sectionMeta}
          highlightedKeys={highlightedKeys}
        />
      </div>
    );
  };

  const renderDescriptorArea = () => {
    const descriptorId = selectedDescriptor || descriptorOrder[0];
    if (!descriptorId) {
      return <p className="muted">No descriptors available</p>;
    }

    const descriptorKeys = groups.descriptorKeys[descriptorId] || [];
    const linters = groups.linterKeys[descriptorId] || {};
    const linterValueMap = linterHasValues[descriptorId] || {};

    const linterEntries = Object.entries(linters).sort(([a], [b]) => compareCategories(a, b));

    const scopeOptions: Tab[] = [
      {
        id: 'descriptor',
        label: `${resolveCategoryLabel(descriptorId)} variables${hasAnyKeySet(descriptorKeys, formData) ? ' *' : ''}`
      },
      ...linterEntries.map(([linter]) => ({
        id: linter,
        label: `${resolveCategoryLabel(linter)}${linterValueMap[linter] ? ' *' : ''}`,
        hasValues: linterValueMap[linter]
      }))
    ];

    const activeScope = scopeOptions.find((opt) => opt.id === selectedScope)?.id || scopeOptions[0]?.id;

    const descriptorBreadcrumbOptions: BreadcrumbOption[] = descriptorOrder.map((id) => ({
      id,
      label: resolveCategoryLabel(id),
      onSelect: () => {
        setSelectedDescriptor(id);
        setSelectedScope('descriptor');
      }
    }));

    const scopeBreadcrumbOptions: BreadcrumbOption[] = scopeOptions.map((opt) => ({
      id: opt.id,
      label: opt.id === 'descriptor' ? 'Variables' : resolveCategoryLabel(opt.id),
      onSelect: () => {
        setSelectedDescriptor(descriptorId);
        setSelectedScope(opt.id);
      }
    }));

    const breadcrumbItems: BreadcrumbItem[] = [
      { id: 'home', label: 'MegaLinter Home', onClick: goHome },
      activeScope === 'descriptor'
        ? {
            id: descriptorId,
            label: resolveCategoryLabel(descriptorId),
            options: descriptorBreadcrumbOptions
          }
        : {
            id: descriptorId,
            label: resolveCategoryLabel(descriptorId),
            onClick: () => {
              setSelectedDescriptor(descriptorId);
              setSelectedScope('descriptor');
            }
          },
      {
        id: activeScope,
        label: activeScope === 'descriptor' ? 'Variables' : resolveCategoryLabel(activeScope),
        options: scopeBreadcrumbOptions
      }
    ];

    const descriptorForm = (
      <ThemedForm
        baseSchema={schema}
        keys={descriptorKeys}
        title={`${resolveCategoryLabel(descriptorId)} variables`}
        uiSchema={uiSchema}
        formData={filterFormData(formData, descriptorKeys)}
        onSubsetChange={(keys, subset) => onSubsetChange(keys, subset)}
        activeThemeTab={activeDescriptorThemes[descriptorId] || null}
        setActiveThemeTab={(id) =>
          setActiveDescriptorThemes({ ...activeDescriptorThemes, [descriptorId]: id || '' })
        }
        prefixToStrip={`${descriptorId}_`}
        sectionMeta={groups.sectionMeta}
        highlightedKeys={highlightedKeys}
      />
    );

    const linterForm = (linterKey: string, keys: string[]) => {
      const linterLabel = resolveCategoryLabel(linterKey);
      const configInfo = linterConfigFiles[linterKey];
      const configFileName = configInfo?.configFileName;
      const isAnalyzing = !!resolvingLinterConfig[linterKey];
      const rulesConfigUrl = linterMetadata[linterKey]?.rulesConfigurationUrl;

      const introTabs = [
        {
          id: 'description',
          label: 'Description',
          icon: 'info',
          content: (
            <LinterDescription
              metadata={linterMetadata[linterKey]}
              linterLabel={linterLabel}
              descriptorId={descriptorId}
              linterId={linterKey}
            />
          )
        },
        ...(isAnalyzing
          ? [
              {
                id: 'analyzing-config',
                label: 'Analyzing config…',
                icon: 'loading',
                disabled: true,
                content: (
                  <div className="loading">
                    <p>Analyzing effective config file…</p>
                  </div>
                )
              }
            ]
          : [])
      ];

      if (!isAnalyzing && configInfo?.local?.exists && configInfo.local.filePath) {
        introTabs.push({
          id: 'config-file',
          label: 'Config file',
          icon: 'file-code',
          content: (
            <div className="linter-description">
              <div className="config-file__header">
                <div>
                  <h3 className="linter-description__name">Config file</h3>
                  {configFileName && <p className="muted">{configFileName}</p>}
                  <p className="muted">{configInfo.local.filePath}</p>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {rulesConfigUrl && (
                    <button
                      className="pill-button pill-button--ghost"
                      onClick={() => postMessage({ type: 'openExternal', url: rulesConfigUrl })}
                    >
                      <span className="codicon codicon-book pill-button__icon" aria-hidden="true" />
                      Configuration documentation
                    </button>
                  )}
                  <button
                    className="pill-button pill-button--solid"
                    onClick={() => postMessage({ type: 'openFile', filePath: configInfo.local!.filePath! })}
                  >
                    <span className="codicon codicon-edit pill-button__icon" aria-hidden="true" />
                    Edit
                  </button>
                </div>
              </div>
              <pre className="config-file__content">{configInfo.local.content || ''}</pre>
              {configInfo.local.truncated && (
                <p className="muted">Preview truncated (file is large).</p>
              )}
            </div>
          )
        });
      } else if (!isAnalyzing && configInfo?.defaultTemplate?.exists && configInfo.defaultTemplate.content) {
        introTabs.push({
          id: 'default-config',
          label: 'Default config',
          icon: 'file',
          content: (
            <div className="linter-description">
              <div className="config-file__header">
                <div>
                  <h3 className="linter-description__name">Default configuration</h3>
                  {configFileName && <p className="muted">{configFileName}</p>}
                  {configInfo.defaultTemplate.source && (
                    <p className="muted">Source: {configInfo.defaultTemplate.source}</p>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {rulesConfigUrl && (
                    <button
                      className="pill-button pill-button--ghost"
                      onClick={() => postMessage({ type: 'openExternal', url: rulesConfigUrl })}
                    >
                      <span className="codicon codicon-book pill-button__icon" aria-hidden="true" />
                      Configuration documentation
                    </button>
                  )}
                  <button
                    className="pill-button pill-button--solid"
                    onClick={() =>
                      postMessage({
                        type: 'createLinterConfigFileFromDefault',
                        linterKey,
                        destination: {
                          linterRulesPath: activeLinterOverrides?.rulesPath,
                          configFile: configFileName
                        }
                      })
                    }
                  >
                    <span className="codicon codicon-file-add pill-button__icon" aria-hidden="true" />
                    Override
                  </button>
                </div>
              </div>
              <pre className="config-file__content">{configInfo.defaultTemplate.content}</pre>
              {configInfo.defaultTemplate.truncated && (
                <p className="muted">Preview truncated (template is large).</p>
              )}
            </div>
          )
        });
      } else if (!isAnalyzing && configFileName) {
        introTabs.push({
          id: 'default-config',
          label: 'Default config',
          icon: 'file',
          content: (
            <div className="linter-description">
              <div className="config-file__header">
                <div>
                  <h3 className="linter-description__name">Default configuration</h3>
                  <p className="muted">No default template found for {configFileName}.</p>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {rulesConfigUrl && (
                    <button
                      className="pill-button pill-button--ghost"
                      onClick={() => postMessage({ type: 'openExternal', url: rulesConfigUrl })}
                    >
                      <span className="codicon codicon-book pill-button__icon" aria-hidden="true" />
                      Configuration documentation
                    </button>
                  )}
                  <button
                    className="pill-button pill-button--solid"
                    onClick={() =>
                      postMessage({
                        type: 'createLinterConfigFileFromDefault',
                        linterKey,
                        mode: 'blank',
                        destination: {
                          linterRulesPath: activeLinterOverrides?.rulesPath,
                          configFile: configFileName
                        }
                      })
                    }
                  >
                    Create
                  </button>
                </div>
              </div>
            </div>
          )
        });
      }

      return (
        <ThemedForm
          baseSchema={schema}
          keys={keys}
          title={`${linterLabel} linter`}
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
          sectionMeta={groups.sectionMeta}
          highlightedKeys={highlightedKeys}
          introTabs={introTabs}
        />
      );
    };

    const renderLintersList = () => (
      <div className="linters-list-panel">
        <h3 className="linters-list-title">Available Linters</h3>
        <div className="linters-grid">
          {linterEntries.map(([linterId]) => {
            const meta = linterMetadata[linterId];
            const shouldShowFallbackIcon = !meta?.imageUrl || !!brokenLinterIcons[linterId];
            return (
              <button
                key={linterId}
                className="linter-card"
                onClick={() => setSelectedScope(linterId)}
              >
                {shouldShowFallbackIcon ? (
                  <span
                    className="linter-card__icon linter-card__icon--fallback codicon codicon-shield"
                    aria-hidden="true"
                  />
                ) : (
                  <img
                    src={meta?.imageUrl}
                    alt=""
                    className="linter-card__icon"
                    onError={() => markLinterIconBroken(linterId)}
                  />
                )}
                <div className="linter-card__content">
                  <span className="linter-card__name">{resolveCategoryLabel(linterId)}</span>
                  {linterValueMap[linterId] && <span className="linter-card__badge">Configured</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );

    const activeContent =
      activeScope === 'descriptor' ? (
        <div className="descriptor-overview">
          {linterEntries.length > 0 && renderLintersList()}
          {descriptorForm}
        </div>
      ) : (
        linterForm(activeScope, linters[activeScope] || [])
      );

    return (
      <div className="descriptor-panel">
        <Breadcrumbs items={breadcrumbItems} />
        <div className="tab-content">{activeContent}</div>
      </div>
    );
  };

  if (activeMainTab === 'summary') {
    return renderSummary();
  }

  if (activeMainTab === 'general') {
    return renderGeneral();
  }

  if (activeMainTab === 'category') {
    return renderCategory();
  }

  return renderDescriptorArea();
};
