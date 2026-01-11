/* eslint-disable @typescript-eslint/naming-convention */
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
import { DocFieldTemplate } from './DocFieldTemplate';
import { BareObjectFieldTemplate } from './BareObjectFieldTemplate';
import { CheckboxWidget, DualListWidget, TagArrayFieldTemplate } from './widgets';

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
  introTabs
}) => {
  const filteredKeys = useMemo(
    () => keys.filter((key) => !isDeprecatedPropertyTitle(baseSchema, key)),
    [keys, baseSchema]
  );

  const { tabs, grouped } = useMemo(
    () => groupKeysByTheme(filteredKeys, prefixToStrip, formData, baseSchema, sectionMeta),
    [filteredKeys, prefixToStrip, formData, baseSchema, sectionMeta]
  );

  const combinedTabs = useMemo<Tab[]>(() => {
    const extras = (introTabs || []).map((t) => ({ id: t.id, label: t.label, icon: t.icon, disabled: t.disabled }));
    return extras.length ? [...extras, ...tabs] : tabs;
  }, [introTabs, tabs]);

  const effectiveActive = useMemo(() => {
    if (activeThemeTab && combinedTabs.some((t) => t.id === activeThemeTab)) {
      return activeThemeTab;
    }
    return combinedTabs[0]?.id || null;
  }, [activeThemeTab, combinedTabs]);

  useEffect(() => {
    if (!combinedTabs[0]) {
      return;
    }
    if (!activeThemeTab || !combinedTabs.some((t) => t.id === activeThemeTab)) {
      setActiveThemeTab(combinedTabs[0].id);
    }
  }, [activeThemeTab, combinedTabs, setActiveThemeTab]);

  if (!combinedTabs.length) {
    return <p className="muted">No fields available</p>;
  }

  const activeIntroTab = (introTabs || []).find((t) => t.id === effectiveActive);
  const isIntroTabActive = !!activeIntroTab;
  const activeKeys = !isIntroTabActive && effectiveActive ? grouped[effectiveActive] || [] : [];
  const activeLabel = combinedTabs.find((t) => t.id === effectiveActive)?.label || title;
  const widgets = useMemo(() => ({ dualList: DualListWidget, CheckboxWidget }), []);
  const templates = useMemo(
    () => ({
      ArrayFieldTemplate: TagArrayFieldTemplate,
      FieldTemplate: DocFieldTemplate,
      ObjectFieldTemplate: BareObjectFieldTemplate
    }),
    []
  );

  if (!filteredKeys.length && (!introTabs || !introTabs.length)) {
    return <p className="muted">No fields available</p>;
  }

  return (
    <div className="tab-content">
      {combinedTabs.length > 1 && (
        <TabBar tabs={combinedTabs} activeTab={effectiveActive || ''} onSelect={(id) => setActiveThemeTab(id)} />
      )}
      {isIntroTabActive && activeIntroTab ? (
        <div className="linter-description__panel">{activeIntroTab.content}</div>
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
