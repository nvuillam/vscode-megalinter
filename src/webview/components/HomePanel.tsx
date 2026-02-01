/* eslint-disable @typescript-eslint/naming-convention */
import React, { useState } from 'react';
import type { HomePanelProps, SearchItem } from '../types';
import { LoadingOverlay } from './LoadingOverlay';

export const HomePanel: React.FC<HomePanelProps> = ({
  configPath,
  configExists,
  configLoaded,
  referenceDataLoading,
  configuredCount,
  totalKeys,
  linterCount,
  postMessage,
  onOpenGeneral,
  onOpenSummary,
  logoUrl,
  logoFallbackUrl,
  bannerUrl,
  bannerFallbackUrl,
  hasConfiguration,
  searchItems,
  onSearchSelect
}) => {
  const [logoSrc, setLogoSrc] = useState<string>(logoUrl);
  const [bannerSrc, setBannerSrc] = useState<string>(bannerUrl);
  const [searchTerm, setSearchTerm] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const isConfigLoading = !configLoaded;

  const filteredItems = React.useMemo(() => {
    if (!searchTerm || !searchItems) {
      return [];
    }
    const lower = searchTerm.toLowerCase();
    return searchItems.filter(item => item.label.toLowerCase().includes(lower)).slice(0, 10);
  }, [searchTerm, searchItems]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setShowSuggestions(true);
  };

  const handleSelect = (item: SearchItem) => {
    setSearchTerm('');
    setShowSuggestions(false);
    if (onSearchSelect) {
      onSearchSelect(item);
    }
  };

  const renderInstallOrUpgrade = () => {
    if (!configLoaded) {
      return (
        <div className="home__cta-spinner" role="status" aria-live="polite">
          <span className="home__spinner" aria-hidden="true" />
          <span>Loading setup…</span>
        </div>
      );
    }

    if (referenceDataLoading) {
      return (
        <div className="home__cta-spinner" role="status" aria-live="polite">
          <span className="home__spinner" aria-hidden="true" />
          <span>Loading reference data…</span>
        </div>
      );
    }

    if (!configExists) {
      return (
        <button
          type="button"
          className="pill-button pill-button--solid"
          onClick={() => postMessage({ type: 'installMegaLinter' })}
        >
          <span className="codicon codicon-cloud-download pill-button__icon" aria-hidden="true" />
          Install MegaLinter
        </button>
      );
    }

    return (
      <button
        type="button"
        className="pill-button pill-button--solid"
        onClick={() => postMessage({ type: 'upgradeMegaLinter' })}
      >
        <span className="codicon codicon-sync pill-button__icon" aria-hidden="true" />
        Upgrade MegaLinter
      </button>
    );
  };

  return (
    <div className="home">
      <div className="home__banner-row">
        <a
          className="home__banner"
          href="https://megalinter.io/latest/"
          target="_blank"
          rel="noreferrer"
          aria-label="Open MegaLinter website"
        >
          <img
            src={bannerSrc}
            alt="MegaLinter banner"
            className="home__banner-image"
            onError={(event) => {
              if (event.currentTarget.src !== bannerFallbackUrl) {
                setBannerSrc(bannerFallbackUrl);
              }
            }}
          />
        </a>
        <div className="home__brand-stack">
          <a
            className="home__logo-tile home__logo-tile--glow"
            href="https://www.ox.security/?ref=megalinter-vscode"
            target="_blank"
            rel="noreferrer"
            aria-label="Open OX Security website"
          >
            <img
              src={logoSrc}
              alt="OX Security logo"
              className="home__logo"
              onError={(event) => {
                if (event.currentTarget.src !== logoFallbackUrl) {
                  setLogoSrc(logoFallbackUrl);
                }
              }}
            />
            <div className="home__logo-caption">Powered by OX Security</div>
          </a>
        </div>
      </div>

      <div className="home__sections-grid">
        <div className="home__section home__section--primary">
          {isConfigLoading && <LoadingOverlay />}
          <div className="home__section-header">
            <span className="home__section-icon codicon codicon-settings-gear" aria-hidden="true" />
            <div>
              <div className="home__section-title">MegaLinter configuration</div>
              <div className="home__section-copy">Edit, review, and search your configuration in one place.</div>
            </div>
          </div>
          <div className="home__status-grid home__status-grid--inline">
            <div className="home__stat">
              <div className="home__stat-label">Configured keys</div>
              <div className="home__stat-value">{configuredCount} / {totalKeys || 0}</div>
              <div className="home__stat-hint">Saved to {configExists ? configPath || 'your config file' : 'no config yet'}</div>
            </div>
            <div className="home__stat">
              <div className="home__stat-label">Linters</div>
              <div className="home__stat-value">{linterCount}</div>
              <div className="home__stat-hint">Jump into configured linters or search below</div>
            </div>
          </div>
          <div className="home__section-actions">
            <button
              type="button"
              className="pill-button pill-button--solid"
              onClick={onOpenGeneral}
              disabled={!configExists || referenceDataLoading}
            >
              <span className="codicon codicon-settings-gear pill-button__icon" aria-hidden="true" />
              Start with general settings
            </button>
            <button
              type="button"
              className="pill-button pill-button--ghost"
              onClick={onOpenSummary}
              disabled={!hasConfiguration || referenceDataLoading}
            >
              <span className="codicon codicon-checklist pill-button__icon" aria-hidden="true" />
              Review configured values
            </button>
          </div>
          <div className="home__search-section">
            <div className="home__search-container">
              <input
                type="text"
                className="home__search-input"
                placeholder="Search for a descriptor, linter or reporter..."
                value={searchTerm}
                onChange={handleSearchChange}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                disabled={referenceDataLoading}
              />
              {showSuggestions && searchTerm && filteredItems.length > 0 && (
                <ul className="home__search-suggestions">
                  {filteredItems.map((item) => (
                    <li
                      key={`${item.type}-${item.id}`}
                      className="home__search-item"
                      onClick={() => handleSelect(item)}
                    >
                      <span className="home__search-item-label">{item.label}</span>
                      <span className="home__search-item-type">{item.type}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="home__section">
          <div className="home__section-header">
            <span className="home__section-icon codicon codicon-play" aria-hidden="true" />
            <div>
              <div className="home__section-title">Running MegaLinter</div>
              <div className="home__section-copy">Launch a local run with mega-linter-runner and review linter logs.</div>
            </div>
          </div>
          <div className="home__section-actions">
            <button
              type="button"
              className="pill-button pill-button--solid"
              onClick={() => postMessage({ type: 'openRunPanel' })}
            >
              <span className="codicon codicon-play-circle pill-button__icon" aria-hidden="true" />
              Run MegaLinter
            </button>
          </div>
          <div className="home__section-foot">Uses latest runner package with your selected release.</div>
        </div>

        <div className="home__section">
          <div className="home__section-header">
            <span className="home__section-icon codicon codicon-cloud-download" aria-hidden="true" />
            <div>
              <div className="home__section-title">Upgrade MegaLinter</div>
              <div className="home__section-copy">Stay current with the newest checks and descriptor updates.</div>
            </div>
          </div>
          <div className="home__section-actions">
            {renderInstallOrUpgrade()}
          </div>
          <div className="home__section-foot">
            {configExists ? 'Upgrade runs against your existing config.' : 'Install to generate a starter config.'}
          </div>
        </div>

        <div className="home__section">
          <div className="home__section-header">
            <span className="home__section-icon codicon codicon-package" aria-hidden="true" />
            <div>
              <div className="home__section-title">Custom Flavor Builder</div>
              <div className="home__section-copy">Assemble a curated MegaLinter flavor tailored to your stack.</div>
            </div>
          </div>
          <div className="home__section-actions">
            <button
              type="button"
              className="pill-button pill-button--solid"
              onClick={() => postMessage({ type: 'openCustomFlavorBuilder' })}
            >
              <span className="codicon codicon-rocket pill-button__icon" aria-hidden="true" />
              Launch builder
            </button>
            <a
              className="pill-button pill-button--ghost"
              href="https://megalinter.io/latest/flavors/"
              target="_blank"
              rel="noreferrer"
            >
              <span className="codicon codicon-book" aria-hidden="true" />
              View flavor docs
            </a>
          </div>
          <div className="home__section-foot">Share presets with your team using the builder output.</div>
        </div>
      </div>

    </div>
  );
};
