/* eslint-disable @typescript-eslint/naming-convention */

import React from 'react';

export interface ConfigPreviewPanelAction {
  label: string;
  icon: string;
  variant: 'solid' | 'ghost';
  onClick: () => void;
}

export interface ConfigPreviewPanelProps {
  title: string;
  fileName?: string;
  metaLines?: Array<React.ReactNode>;
  documentationUrl?: string;
  onOpenDocumentation?: (url: string) => void;
  actions?: ConfigPreviewPanelAction[];
  content?: string;
  truncated?: boolean;
  truncatedMessage?: string;
  children?: React.ReactNode;
}

export const ConfigPreviewPanel: React.FC<ConfigPreviewPanelProps> = ({
  title,
  fileName,
  metaLines,
  documentationUrl,
  onOpenDocumentation,
  actions,
  content,
  truncated,
  truncatedMessage,
  children
}) => {
  return (
    <div className="linter-description">
      <div className="config-file__header">
        <div>
          <h3 className="linter-description__name">{title}</h3>
          {fileName && <p className="muted">{fileName}</p>}
          {(metaLines || []).map((line, index) => (
            <p className="muted" key={index}>
              {line}
            </p>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {documentationUrl && onOpenDocumentation && (
            <button
              className="pill-button pill-button--ghost"
              onClick={() => onOpenDocumentation(documentationUrl)}
            >
              <span className="codicon codicon-book pill-button__icon" aria-hidden="true" />
              Configuration documentation
            </button>
          )}
          {(actions || []).map((action) => (
            <button
              key={action.label}
              className={`pill-button pill-button--${action.variant}`}
              onClick={action.onClick}
            >
              <span className={`codicon codicon-${action.icon} pill-button__icon`} aria-hidden="true" />
              {action.label}
            </button>
          ))}
        </div>
      </div>
      {children}
      {typeof content === 'string' && <pre className="config-file__content">{content}</pre>}
      {truncated && <p className="muted">{truncatedMessage || 'Preview truncated.'}</p>}
    </div>
  );
};
