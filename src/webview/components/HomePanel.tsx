import React, { useState } from 'react';
import type { HomePanelProps, VSCodeAPI, SearchItem } from '../types';

declare const vscode: VSCodeAPI;

export const HomePanel: React.FC<HomePanelProps> = ({
  configPath,
  configExists,
  configLoaded,
  configuredCount,
  totalKeys,
  descriptorCount,
  linterCount,
  onOpenGeneral,
  onOpenSummary,
  onOpenFirstDescriptor,
  onOpenReporters,
  logoUrl,
  logoFallbackUrl,
  bannerUrl,
  bannerFallbackUrl,
  descriptorLabel,
  reportersLabel,
  hasConfiguration,
  descriptorNavigationReady,
  reporterNavigationReady,
  searchItems,
  onSearchSelect
}) => {
  const [logoSrc, setLogoSrc] = useState<string>(logoUrl);
  const [bannerSrc, setBannerSrc] = useState<string>(bannerUrl);
  const [searchTerm, setSearchTerm] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const filteredItems = React.useMemo(() => {
    if (!searchTerm || !searchItems) return [];
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

    if (!configExists) {
      return (
        <button
          type="button"
          className="pill-button pill-button--solid"
          onClick={() => vscode.postMessage({ type: 'installMegaLinter' })}
        >
          Install MegaLinter
        </button>
      );
    }

    return (
      <button
        type="button"
        className="pill-button pill-button--solid"
        onClick={() => vscode.postMessage({ type: 'upgradeMegaLinter' })}
      >
        Upgrade MegaLinter
      </button>
    );
  };

  return (
    <div className="home">
      <div className="home__banner">
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
      </div>
      <div className="home__hero">
        <div className="home__logo-tile">
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
        </div>
        <div className="home__intro">
          <p className="eyebrow">MegaLinter workspace home</p>
          <h1 className="home__title">Configure once, ship confidently</h1>
          <p className="home__subtitle">
            Tailor MegaLinter to your repository, preview the impact, and keep every run aligned with your team.
          </p>
          <div className="home__actions">
            {renderInstallOrUpgrade()}
            <button
              type="button"
              className="pill-button pill-button--primary"
              onClick={onOpenGeneral}
              disabled={!configExists}
            >
              Start with general settings
            </button>
            <button
              type="button"
              className="pill-button pill-button--ghost"
              onClick={onOpenSummary}
              disabled={!hasConfiguration}
            >
              Review configured values
            </button>
            <a
              className="pill-button pill-button--ghost"
              href="https://megalinter.io/latest/"
              target="_blank"
              rel="noreferrer"
            >
              Open MegaLinter docs
            </a>
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
      </div>

      <div className="home__grid" role="list">
        <div className="home__card" role="listitem">
          <div className="home__card-label">Configured values</div>
          <div className="home__card-value">
            {configuredCount}
            <span className="home__card-sub">of {totalKeys || '-'} fields</span>
          </div>
          <p className="home__card-note">
            {hasConfiguration
              ? 'Great start - keep adding detail or jump to Summary.'
              : 'No overrides yet. Begin with general settings to set the foundation.'}
          </p>
        </div>

        <div className="home__card" role="listitem">
          <div className="home__card-label">Coverage</div>
          <div className="home__card-value">
            {descriptorCount}
            <span className="home__card-sub">descriptors</span>
          </div>
          <p className="home__card-note">{linterCount} linters available across your stack.</p>
        </div>
      </div>
    </div>
  );
};
