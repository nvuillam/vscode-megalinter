/* eslint-disable @typescript-eslint/naming-convention */
import React, { useCallback } from 'react';
import type { WidgetProps } from '@rjsf/utils';

export const CheckboxWidget: React.FC<WidgetProps> = ({
  id,
  value,
  disabled,
  readonly,
  autofocus,
  onChange,
  onBlur,
  onFocus,
  options
}) => {
  const ariaDescribedBy = typeof options?.['aria-describedby'] === 'string' ? options['aria-describedby'] : undefined;
  const checked = Boolean(value);
  const isDisabled = disabled || readonly;

  const handleBlur = useCallback(
    () => {
      onBlur?.(id, checked);
    },
    [checked, id, onBlur]
  );

  const handleFocus = useCallback(
    () => {
      onFocus?.(id, checked);
    },
    [checked, id, onFocus]
  );

  const setValue = useCallback(
    (nextValue: boolean) => {
      if (!isDisabled) {
        onChange(nextValue);
      }
    },
    [isDisabled, onChange]
  );

  const handleActive = useCallback(() => setValue(true), [setValue]);
  const handleInactive = useCallback(() => setValue(false), [setValue]);

  const handleKeyDown = useCallback(
    (nextValue: boolean) => (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setValue(nextValue);
      }
    },
    [setValue]
  );

  return (
    <div className="checkbox-widget">
      <div
        className={`boolean-toggle ${checked ? 'boolean-toggle--on' : 'boolean-toggle--off'} ${
          isDisabled ? 'boolean-toggle--disabled' : ''
        }`}
        role="group"
        aria-describedby={ariaDescribedBy}
      >
        <span className="boolean-toggle__thumb" aria-hidden="true" />
        <button
          id={id}
          type="button"
          className={`boolean-toggle__option ${checked ? 'boolean-toggle__option--active' : ''}`}
          aria-pressed={checked}
          disabled={isDisabled}
          autoFocus={autofocus}
          onClick={handleActive}
          onKeyDown={handleKeyDown(true)}
          onBlur={handleBlur}
          onFocus={handleFocus}
        >
          Active
        </button>
        <button
          type="button"
          className={`boolean-toggle__option ${!checked ? 'boolean-toggle__option--active' : ''}`}
          aria-pressed={!checked}
          disabled={isDisabled}
          onClick={handleInactive}
          onKeyDown={handleKeyDown(false)}
        >
          Inactive
        </button>
      </div>
    </div>
  );
};
