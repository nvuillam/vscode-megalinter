import React, { useState } from 'react';
import type { BreadcrumbsProps, BreadcrumbItem, BreadcrumbOption } from '../types';

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ items }) => {
  const [openId, setOpenId] = useState<string | null>(null);

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
                  {item.label}
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
                {item.label}
              </button>
            ) : (
              <span className="breadcrumbs__current">{item.label}</span>
            )}
            {!isLast && <span className="breadcrumbs__sep">/</span>}
          </span>
        );
      })}
    </div>
  );
};
