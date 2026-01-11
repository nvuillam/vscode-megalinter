/* eslint-disable @typescript-eslint/naming-convention */
import React, { useState } from 'react';
import type { BreadcrumbsProps, BreadcrumbItem, BreadcrumbOption } from '../types';

import oxSecurityIconLight from '../../../media/ox-security-light.svg';
import oxSecurityIconDark from '../../../media/ox-security-dark.svg';

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ items }) => {
  const [openId, setOpenId] = useState<string | null>(null);

  const renderLabel = (item: BreadcrumbItem): React.ReactNode => {
    if (item.id !== 'home') {
      return item.label;
    }

    return (
      <span className="breadcrumbs__home">
        <img
          className="breadcrumbs__home-icon breadcrumbs__home-icon--light"
          src={oxSecurityIconLight}
          alt=""
          aria-hidden="true"
        />
        <img
          className="breadcrumbs__home-icon breadcrumbs__home-icon--dark"
          src={oxSecurityIconDark}
          alt=""
          aria-hidden="true"
        />
        <span className="breadcrumbs__home-label">{item.label}</span>
      </span>
    );
  };

  return (
    <div className="breadcrumbs" aria-label="Navigation breadcrumb">
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        const hasOptions = !!(item.options && item.options.length > 0);
        const isOpen = openId === item.id;

        const handleSelect = (optId: string) => {
          const match = item.options?.find((opt) => opt.id === optId);
          match?.onSelect();
          setOpenId(null);
        };

        return (
          <span key={item.id} className="breadcrumbs__item">
            {hasOptions ? (
              <div className="breadcrumbs__menu-wrapper">
                <button
                  type="button"
                  className="breadcrumbs__link breadcrumbs__link--menu"
                  onClick={() => setOpenId(isOpen ? null : item.id)}
                >
                  {renderLabel(item)}
                  <span className={`breadcrumbs__chevron ${isOpen ? 'breadcrumbs__chevron--open' : ''}`} />
                </button>
                {isOpen && (
                  <ul className="breadcrumbs__menu">
                    {item.options?.map((opt) => (
                      <li key={opt.id}>
                        <button type="button" onClick={() => handleSelect(opt.id)}>
                          {opt.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : item.onClick ? (
              <button type="button" className="breadcrumbs__link" onClick={item.onClick}>
                {renderLabel(item)}
              </button>
            ) : (
              <span className="breadcrumbs__current">{renderLabel(item)}</span>
            )}
            {!isLast && <span className="breadcrumbs__sep">/</span>}
          </span>
        );
      })}
    </div>
  );
};
