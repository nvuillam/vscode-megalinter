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

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange(event.target.checked);
    },
    [onChange]
  );

  const handleBlur = useCallback(
    (event: React.FocusEvent<HTMLInputElement>) => {
      onBlur?.(id, event.target.checked);
    },
    [id, onBlur]
  );

  const handleFocus = useCallback(
    (event: React.FocusEvent<HTMLInputElement>) => {
      onFocus?.(id, event.target.checked);
    },
    [id, onFocus]
  );

  const isDisabled = disabled || readonly;

  return (
    <div className="checkbox-widget" style={{ display: 'flex', alignItems: 'center' }}>
      <input
        id={id}
        type="checkbox"
        checked={Boolean(value)}
        disabled={isDisabled}
        autoFocus={autofocus}
        onChange={handleChange}
        onBlur={handleBlur}
        onFocus={handleFocus}
        aria-describedby={ariaDescribedBy}
      />
    </div>
  );
};
