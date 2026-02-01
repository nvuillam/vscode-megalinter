import React from 'react';

export const LoadingOverlay: React.FC = () => (
  <div className="home__loading-overlay" role="status" aria-live="polite">
    <div className="home__loading-card">
      <span className="home__spinner home__spinner--lg" aria-hidden="true" />
    </div>
  </div>
);