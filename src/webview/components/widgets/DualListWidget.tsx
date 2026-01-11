import React, { useEffect, useMemo, useState } from 'react';
import type { WidgetProps } from '@rjsf/utils';
import type { RJSFSchema } from '@rjsf/utils';

export const DualListWidget: React.FC<WidgetProps> = ({
  value,
  onChange,
  options,
  disabled,
  readonly,
  label,
  id,
  schema,
  registry
}) => {
  const rootSchema = registry?.rootSchema as RJSFSchema | undefined;
  const schemaUtils = registry?.schemaUtils;

  const resolveEnumOptions = (node: unknown): Array<{ value: string; label: string }> | undefined => {
    if (!node || typeof node !== 'object') {
      return undefined;
    }

    const nodeObj = node as Record<string, unknown>;

    const resolveWithNames = (schemaNode: Record<string, unknown>) => {
      const values = Array.isArray(schemaNode?.enum) ? schemaNode.enum as string[] : undefined;
      if (!values) {
        return undefined;
      }
      const names = Array.isArray(schemaNode?.enumNames) ? schemaNode.enumNames as string[] : undefined;
      return values.map((v: string, idx: number) => ({ value: v, label: names?.[idx] ?? String(v) }));
    };

    const resolved = schemaUtils?.retrieveSchema ? schemaUtils.retrieveSchema(nodeObj as RJSFSchema, rootSchema) : nodeObj;
    const direct = resolveWithNames(resolved as Record<string, unknown>);
    if (direct) {
      return direct;
    }

    const ref = typeof nodeObj.$ref === 'string' ? nodeObj.$ref : undefined;
    if (ref && ref.startsWith('#/definitions/') && rootSchema?.definitions) {
      const defKey = ref.replace('#/definitions/', '');
      const def = (rootSchema.definitions as Record<string, unknown>)[defKey];
      if (def && typeof def === 'object') {
        const fromDef = resolveWithNames(def as Record<string, unknown>);
        if (fromDef) {
          return fromDef;
        }
      }
    }
    return undefined;
  };

  const enumOptions = useMemo(() => {
    if (options.enumOptions && Array.isArray(options.enumOptions) && options.enumOptions.length) {
      return options.enumOptions as Array<{ value: string; label: string }>;
    }

    const schemaObj = schema as Record<string, unknown>;
    const itemSchema = schemaObj?.items;
    return resolveEnumOptions(itemSchema) || [];
  }, [options.enumOptions, schema, rootSchema]);

  const selectedValues = Array.isArray(value) ? value as string[] : [];
  const [draft, setDraft] = useState<string[]>(selectedValues);
  const [isEditing, setIsEditing] = useState(false);
  const selectedSet = new Set(isEditing ? draft : selectedValues);

  const valueMap = useMemo(() => {
    const map = new Map<string, string>();
    enumOptions.forEach((opt) => {
      map.set(String(opt.value), opt.value);
    });
    return map;
  }, [enumOptions]);

  const available = enumOptions.filter((opt) => !selectedSet.has(opt.value));
  const selected = enumOptions.filter((opt) => selectedSet.has(opt.value));

  const [availableSelected, setAvailableSelected] = useState<string[]>([]);
  const [chosenSelected, setChosenSelected] = useState<string[]>([]);

  useEffect(() => {
    // Keep draft in sync when not editing; clear transient selections on change
    if (!isEditing) {
      setDraft(selectedValues);
    }
    setAvailableSelected([]);
    setChosenSelected([]);
  }, [selectedValues, isEditing]);

  const addSelected = () => {
    if (readonly || disabled) {
      return;
    }
    const toAdd = availableSelected
      .map((v) => valueMap.get(String(v)))
      .filter((v): v is string => v !== undefined && !selectedSet.has(v));
    if (toAdd.length === 0) {
      return;
    }
    setDraft((prev) => [...prev, ...toAdd]);
    setAvailableSelected([]);
  };

  const removeSelected = () => {
    if (readonly || disabled) {
      return;
    }
    if (chosenSelected.length === 0) {
      return;
    }
    const removeSet = new Set(
      chosenSelected
        .map((v) => valueMap.get(String(v)))
        .filter((v): v is string => v !== undefined)
    );
    setDraft((prev) => prev.filter((v) => !removeSet.has(v)));
    setChosenSelected([]);
  };

  const handleSave = () => {
    onChange(draft);
    setIsEditing(false);
  };

  if (!isEditing) {
    return (
      <div className="dual-list dual-list--view" aria-label={label} id={id}>
        <div className="dual-list__pane dual-list__pane--view">
          {selected.length ? (
            <ul className="dual-list__chips">
              {selected.map((opt) => (
                <li key={opt.value} className="dual-list__chip">
                  {opt.label}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">None selected</p>
          )}
        </div>
        <div className="dual-list__controls dual-list__controls--view">
          <button type="button" onClick={() => setIsEditing(true)} disabled={disabled || readonly}>
            Edit
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dual-list" aria-label={label} id={id}>
      <div className="dual-list__pane">
        <div className="dual-list__title">Available</div>
        <select
          multiple
          value={availableSelected}
          onChange={(e) => {
            const opts = Array.from(e.target.selectedOptions).map((o) => o.value);
            setAvailableSelected(opts);
          }}
          disabled={disabled || readonly}
        >
          {available.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="dual-list__controls">
        <button type="button" onClick={addSelected} disabled={disabled || readonly || availableSelected.length === 0}>
          &gt;
        </button>
        <button type="button" onClick={removeSelected} disabled={disabled || readonly || chosenSelected.length === 0}>
          &lt;
        </button>
      </div>
      <div className="dual-list__pane">
        <div className="dual-list__title">Selected</div>
        <select
          multiple
          value={chosenSelected}
          onChange={(e) => {
            const opts = Array.from(e.target.selectedOptions).map((o) => o.value);
            setChosenSelected(opts);
          }}
          disabled={disabled || readonly}
        >
          {selected.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="dual-list__footer">
        <button
          type="button"
          className="dual-list__save dual-list__save--cta"
          onClick={handleSave}
          disabled={disabled || readonly}
        >
          Save
        </button>
      </div>
    </div>
  );
};
