import React, { useEffect, useMemo } from 'react';
import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';
import type { ThemedFormProps, Tab } from '../types';
import {
  buildScopedUiSchema,
  buildSubsetSchema,
  filterFormData,
  groupKeysByTheme,
  isDeprecatedPropertyTitle
} from '../menuUtils';
import { TabBar } from './TabBar';
import { DualListWidget, TagArrayFieldTemplate } from './widgets';

export const ThemedForm: React.FC<ThemedFormProps> = ({
  baseSchema,
  keys,
  title,
  uiSchema,
  formData,
  onSubsetChange,
  activeThemeTab,
  setActiveThemeTab,
  sectionMeta,
  prefixToStrip,
  highlightedKeys,
  introTab
}) => {
  const filteredKeys = useMemo(
    () => keys.filter((key) => !isDeprecatedPropertyTitle(baseSchema, key)),
    [keys, baseSchema]
  );

  const { tabs, grouped } = useMemo(
    () => groupKeysByTheme(filteredKeys, prefixToStrip, formData, baseSchema, sectionMeta),
    [filteredKeys, prefixToStrip, formData, baseSchema, sectionMeta]
  );

  const combinedTabs = useMemo<Tab[]>(
    () => (introTab ? [{ id: introTab.id, label: introTab.label }, ...tabs] : tabs),
    [introTab, tabs]
  );

  const effectiveActive = useMemo(() => {
    if (activeThemeTab && combinedTabs.some((t) => t.id === activeThemeTab)) {
      return activeThemeTab;
    }
    return combinedTabs[0]?.id || null;
  }, [activeThemeTab, combinedTabs]);

  useEffect(() => {
    if (!activeThemeTab && combinedTabs[0]) {
      setActiveThemeTab(combinedTabs[0].id);
    }
  }, [activeThemeTab, combinedTabs, setActiveThemeTab]);

  if (!combinedTabs.length) {
    return <p className="muted">No fields available</p>;
  }

  const isIntroTabActive = introTab && effectiveActive === introTab.id;
  const activeKeys = !isIntroTabActive && effectiveActive ? grouped[effectiveActive] || [] : [];
  const activeLabel = combinedTabs.find((t) => t.id === effectiveActive)?.label || title;
  const widgets = useMemo(() => ({ dualList: DualListWidget }), []);
  const templates = useMemo(() => ({ ArrayFieldTemplate: TagArrayFieldTemplate }), []);

  if (!filteredKeys.length && !introTab) {
    return <p className="muted">No fields available</p>;
  }

  return (
    <div className="tab-content">
      {combinedTabs.length > 1 && (
        <TabBar tabs={combinedTabs} activeTab={effectiveActive || ''} onSelect={(id) => setActiveThemeTab(id)} />
      )}
      {isIntroTabActive && introTab ? (
        <div className="linter-description__panel">{introTab.content}</div>
      ) : (
        <Form
          key={`${title}-${effectiveActive || 'default'}`}
          schema={buildSubsetSchema(baseSchema, activeKeys, `${title} - ${activeLabel}`, prefixToStrip)}
          uiSchema={buildScopedUiSchema(baseSchema, activeKeys, uiSchema, highlightedKeys)}
          formData={filterFormData(formData, activeKeys)}
          validator={validator}
          templates={templates}
          widgets={widgets}
          onChange={({ formData: subset }) => onSubsetChange(activeKeys, subset)}
          liveValidate={false}
          showErrorList="bottom"
        />
      )}
    </div>
  );
};
