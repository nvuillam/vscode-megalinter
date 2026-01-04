import React, { useEffect, useState } from 'react';
import type { ArrayFieldTemplateProps, RJSFSchema } from '@rjsf/utils';
import type { MegaLinterConfigValue } from '../../types';

export const TagArrayFieldTemplate: React.FC<ArrayFieldTemplateProps> = (props) => {
  const { items, canAdd, onAddClick, title, schema, formData, disabled, readonly } = props;
  
  const schemaObj = schema as RJSFSchema & { items?: { type?: string | string[]; enum?: string[] } };
  const itemType = schemaObj?.items?.type;
  const enumValues = Array.isArray(schemaObj?.items?.enum)
    ? schemaObj.items.enum
    : undefined;
  const isStringArray = itemType === 'string' || (Array.isArray(itemType) && itemType.includes('string'));
  const isFreeStringArray = isStringArray && !enumValues;
  
  const values = Array.isArray(formData)
    ? (formData as MegaLinterConfigValue[]).filter((v) => v !== undefined && v !== null)
    : [];
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (disabled || readonly) {
      setIsEditing(false);
    }
  }, [disabled, readonly]);

  if (isFreeStringArray) {
    if (!isEditing) {
      return (
        <div className="string-list string-list--view">
          {title && <p className="tag-array__title">{title}</p>}
          {schema?.description && <p className="field-description">{schema.description}</p>}
          {values.length ? (
            <ul className="dual-list__chips">
              {values.map((val, idx) => (
                <li key={`${idx}-${String(val)}`} className="dual-list__chip">
                  {String(val)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">None set</p>
          )}
          <div className="string-list__controls">
            <button
              type="button"
              className="dual-list__save"
              onClick={() => setIsEditing(true)}
              disabled={disabled || readonly}
            >
              Edit
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="string-list string-list--edit">
        {title && <p className="tag-array__title">{title}</p>}
        {schema?.description && <p className="field-description">{schema.description}</p>}
        <div className="string-list__rows">
          {items.map((item) => (
            <div key={item.key} className="string-list__row">
              <div className="string-list__input">{item.children}</div>
              {item.hasRemove && (
                <button
                  type="button"
                  className="pill-remove string-list__remove"
                  onClick={item.onDropIndexClick(item.index)}
                  aria-label="Remove item"
                >
                  -
                </button>
              )}
            </div>
          ))}
          {canAdd && (
            <button
              type="button"
              className="pill-add pill-add--inline string-list__add"
              onClick={(event) => onAddClick(event)}
              aria-label="Add item"
            >
              + Add string item
            </button>
          )}
        </div>
        <div className="string-list__footer">
          <button
            type="button"
            className="dual-list__save"
            onClick={() => setIsEditing(false)}
            disabled={disabled || readonly}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tag-array">
      {title && <p className="tag-array__title">{title}</p>}
      {schema?.description && <p className="field-description">{schema.description}</p>}
      <div className="tag-array__items">
        {items.map((item) => (
          <div key={item.key} className={`tag-pill ${isStringArray ? 'tag-pill--string' : ''}`}>
            <div className="tag-pill__field">{item.children}</div>
            {item.hasRemove && (
              <button
                type="button"
                className="pill-remove"
                onClick={item.onDropIndexClick(item.index)}
                aria-label="Remove item"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {canAdd && (
          <button
            type="button"
            className="pill-add pill-add--inline"
            onClick={(event) => onAddClick(event)}
            aria-label="Add item"
          >
            + Add
          </button>
        )}
      </div>
    </div>
  );
};
