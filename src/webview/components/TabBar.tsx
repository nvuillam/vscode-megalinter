import React from 'react';
import type { TabBarProps } from '../types';
import { getCodiconForSection } from '../iconResolver';

export const TabBar: React.FC<TabBarProps> = ({ tabs, activeTab, onSelect }) => (
  <div className="tabs">
    {tabs.map((tab) => (
      <button
        key={tab.id}
        className={`tab ${activeTab === tab.id ? 'active' : ''}`}
        onClick={() => {
          if (!tab.disabled) {
            onSelect(tab.id);
          }
        }}
        type="button"
        disabled={!!tab.disabled}
      >
        <span
          className={`codicon codicon-${tab.icon || getCodiconForSection(tab.id)} tab__icon ${tab.icon === 'loading' ? 'codicon-modifier-spin' : ''}`}
          aria-hidden="true"
        />
        {tab.hasValues ? `${tab.label} *` : tab.label}
      </button>
    ))}
  </div>
);
