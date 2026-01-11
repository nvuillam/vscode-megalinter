import React, { useMemo } from 'react';
import { marked } from 'marked';
import type { LinterDescriptionProps } from '../types';

export const LinterDescription: React.FC<LinterDescriptionProps> = ({ metadata, linterLabel, descriptorId, linterId }) => {
  const title = metadata?.linterName || metadata?.name || linterLabel;
  const link = metadata?.url || metadata?.repo;
  const linkLabel = link ? link.replace(/^https?:\/\//i, '') : '';
  const image = metadata?.bannerImageUrl || metadata?.imageUrl;
  const description = metadata?.text?.trim();
  const links = metadata?.urls || [];
  const html = useMemo(() => (description ? marked.parse(description) : ''), [description]);

  const megaLinterDocUrl = useMemo(() => {
    if (descriptorId && metadata?.linterName) {
      const normalizedLinterName = metadata.linterName.toLowerCase().replace(/-/g, '_');
      return `https://megalinter.io/latest/descriptors/${descriptorId.toLowerCase()}_${normalizedLinterName}/`;
    }
    return null;
  }, [descriptorId, metadata]);

  return (
    <div className="linter-description">
      <div className="linter-description__header">
        {image && <img src={image} alt={`${title} logo`} className="linter-description__image" />}
        <div className="linter-description__titles">
          <p className="eyebrow">Linter overview</p>
          <h3 className="linter-description__name">{title}</h3>
          {link && (
            <a className="linter-description__link" href={link} target="_blank" rel="noreferrer">
              {linkLabel || 'Open linter homepage'}
            </a>
          )}
        </div>
        {megaLinterDocUrl && (
          <a
            className="pill-button pill-button--solid"
            href={megaLinterDocUrl}
            target="_blank"
            rel="noreferrer"
            style={{ marginLeft: 'auto' }}
          >
            <span className="codicon codicon-book pill-button__icon" aria-hidden="true" />
            MegaLinter Documentation
          </a>
        )}
      </div>
      <div className="linter-description__body">
        {description ? (
          <div className="linter-description__text" dangerouslySetInnerHTML={{ __html: html as string }} />
        ) : (
          <p className="muted">No description available for this linter yet.</p>
        )}
        {links.length > 0 && (
          <div className="linter-description__links">
            <p className="eyebrow">Links</p>
            <ul className="linter-description__link-list">
              {links.map((item) => {
                const label = item.label || item.href.replace(/^https?:\/\//i, '');
                return (
                  <li key={item.href}>
                    <a className="linter-description__link" href={item.href} target="_blank" rel="noreferrer">
                      {label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
