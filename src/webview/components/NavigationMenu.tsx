/* eslint-disable @typescript-eslint/naming-convention */
import React, { useEffect, useState } from 'react';
import type { NavigationMenuProps, MenuItem } from '../types';
import { getCodiconForNavigationItem, getCodiconForSection } from '../iconResolver';

export const NavigationMenu: React.FC<NavigationMenuProps> = ({
  sections,
  selectedId,
  activeDescriptorId,
  onSelect
}) => {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    home: true,
    summary: true,
    general: true,
    generic: false,
    descriptors: true
  });

  useEffect(() => {
    const matchingSection = sections.find((section) =>
      section.items.some(
        (item) =>
          item.id === selectedId ||
          (item.children && item.children.some((child) => child.id === selectedId))
      )
    );

    if (!matchingSection) {
      return;
    }

    setExpandedSections((prev) => {
      if (prev[matchingSection.id]) {
        return prev;
      }
      return { ...prev, [matchingSection.id]: true };
    });
  }, [selectedId, sections]);

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <nav className="nav" aria-label="Configuration sections">
      {sections.map((section) => {
        const isExpanded = expandedSections[section.id] ?? true;
        const sectionHasValues = section.items.some(
          (item) => item.hasValues || (item.children && item.children.some((child) => child.hasValues))
        );

        const sectionIcon = getCodiconForSection(section.id);

        if (section.id === 'home' || section.id === 'summary') {
          const targetItem: MenuItem = {
            id: section.id,
            label: section.label,
            type: section.id as MenuItem['type'],
            hasValues: sectionHasValues
          };
          const isActive = selectedId === section.id;
          return (
            <div key={section.id} className="nav__section">
              <button
                type="button"
                className={`nav__title nav__title--link ${isActive ? 'nav__title--active' : ''}`}
                onClick={() => onSelect(targetItem)}
              >
                <span className="nav__title-label">
                  <span className={`nav__icon codicon codicon-${sectionIcon}`} aria-hidden="true" />
                  <span>{section.label}</span>
                  {section.id !== 'home' && sectionHasValues && <span className="nav__dot" aria-hidden="true" />}
                </span>
              </button>
            </div>
          );
        }

        return (
          <div key={section.id} className="nav__section">
            <button
              type="button"
              className="nav__title nav__title--toggle"
              onClick={() => toggleSection(section.id)}
              aria-expanded={isExpanded}
            >
              <span className="nav__title-label">
                <span className={`nav__icon codicon codicon-${sectionIcon}`} aria-hidden="true" />
                <span>{section.label}</span>
                {sectionHasValues && <span className="nav__dot" aria-hidden="true" />}
              </span>
              <span className={`nav__chevron ${isExpanded ? 'nav__chevron--open' : ''}`} aria-hidden="true" />
            </button>
            {isExpanded && section.items.length > 0 && (
              <ul className="nav__list">
                {section.items.map((item) => {
                  const isActive = selectedId === item.id;
                  const isItemExpanded = activeDescriptorId === item.id || isActive;
                  const itemIcon = getCodiconForNavigationItem(item.type, item.id, section.id);
                  return (
                    <li key={item.id} className="nav__list-item">
                      <button
                        type="button"
                        className={`nav__item ${isActive ? 'nav__item--active' : ''}`}
                        onClick={() => onSelect(item)}
                      >
                        <span className="nav__label">
                          <span className={`nav__icon codicon codicon-${itemIcon}`} aria-hidden="true" />
                          <span>{item.label}</span>
                        </span>
                        {item.hasValues && <span className="nav__dot" aria-hidden="true" />}
                      </button>
                      {item.children && item.children.length && isItemExpanded && (
                        <ul className="nav__child-list">
                          {item.children.map((child) => {
                            const childActive = selectedId === child.id;
                            const childIcon = getCodiconForNavigationItem('linter', child.id, section.id);
                            return (
                              <li key={child.id} className="nav__child-item">
                                <button
                                  type="button"
                                  className={`nav__item nav__item--child ${childActive ? 'nav__item--active' : ''}`}
                                  onClick={() => onSelect(child)}
                                >
                                  <span className="nav__label">
                                    <span className={`nav__icon codicon codicon-${childIcon}`} aria-hidden="true" />
                                    <span>{child.label}</span>
                                  </span>
                                  {child.hasValues && <span className="nav__dot" aria-hidden="true" />}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
};
