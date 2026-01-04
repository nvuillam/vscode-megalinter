import React from 'react';
import type { TabBarProps } from '../types';

export const TabBar: React.FC<TabBarProps> = ({ tabs, activeTab, onSelect }) => (
  <div className="tabs">
    {tabs.map((tab) => (
      <button
        key={tab.id}
        className={`tab ${activeTab === tab.id ? 'active' : ''}`}
        onClick={() => onSelect(tab.id)}
        type="button"
      >
        {tab.hasValues ? `${tab.label} *` : tab.label}
      </button>
    ))}
  </div>
);
