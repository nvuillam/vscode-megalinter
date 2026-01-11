/* eslint-disable @typescript-eslint/naming-convention */
import React, { useCallback, useMemo } from 'react';
import type { FieldTemplateProps } from '@rjsf/utils';
import { getDocsUrlForVariable } from '../docsLinks';
import { getCodiconForVariable } from '../iconResolver';
import { useVSCodeApi } from '../hooks';

const extractVariableName = (id: string): string | undefined => {
  const rootMarker = 'root_';
  const idx = id.indexOf(rootMarker);
  if (idx < 0) {
    return undefined;
  }
  const withoutRoot = id.slice(idx + rootMarker.length);
  // Top-level MegaLinter variables are uppercase with underscores.
  // Nested array/object fields include indexes/child keys (e.g. root_PRE_COMMANDS_0_command).
  if (!/^[A-Z0-9_]+$/.test(withoutRoot)) {
    return undefined;
  }
  return withoutRoot || undefined;
};

const isTopLevelFieldId = (id: string): boolean => !!extractVariableName(id);

const isRootObjectFieldId = (id: string): boolean => {
  if (!id) {
    return false;
  }
  // RJSF root object field ids are typically "root".
  // When using idPrefix, it becomes something like "summary__root".
  if (id === 'root') {
    return true;
  }
  return id.endsWith('__root') || id.endsWith('_root');
};

export function DocFieldTemplate(props: FieldTemplateProps) {
  const { postMessage } = useVSCodeApi();

  const variableName = useMemo(() => extractVariableName(props.id), [props.id]);
  const docsUrl = useMemo(
    () => (variableName ? getDocsUrlForVariable(variableName, props.schema as Record<string, unknown>) : undefined),
    [variableName, props.schema]
  );
  const showDocs = !!docsUrl && isTopLevelFieldId(props.id);
  const iconName = useMemo(
    () => (variableName ? getCodiconForVariable(variableName, props.schema as Record<string, unknown>) : 'symbol-property'),
    [variableName, props.schema]
  );

  const handleOpenDocs = useCallback(() => {
    if (!docsUrl) {
      return;
    }
    postMessage({ type: 'openExternal', url: docsUrl });
  }, [docsUrl, postMessage]);

  const isRoot = isRootObjectFieldId(props.id);
  const showLabelRow = !!props.label && !isRoot && isTopLevelFieldId(props.id);
  const showDocsButton = showDocs && !isRoot;
  const showDescription = !isRoot && isTopLevelFieldId(props.id);
  const docsButtonTitle = useMemo(() => {
    if (variableName) {
      return `View documentation for ${variableName}`;
    }
    return 'View documentation';
  }, [variableName]);

  return (
    <div className={props.classNames}>
      {showLabelRow && (
        <div className="field-label-row">
          <label htmlFor={props.id} title={variableName}>
            <span className={`codicon codicon-${iconName} field-label__icon`} aria-hidden="true" />
            {props.label}
            {props.required ? '*' : null}
          </label>
          {showDocsButton && (
            <button type="button" className="field-docs-button" onClick={handleOpenDocs} title={docsButtonTitle}>
              <svg
                className="field-docs-button__icon"
                viewBox="0 0 16 16"
                role="img"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M2.75 2A1.75 1.75 0 0 0 1 3.75v8.5C1 13.216 1.784 14 2.75 14H14a.75.75 0 0 0 0-1.5H2.75a.25.25 0 0 1-.25-.25V3.75c0-.138.112-.25.25-.25H14a.75.75 0 0 0 0-1.5H2.75Z" />
                <path d="M5 5.25c0-.414.336-.75.75-.75H13a.75.75 0 0 1 0 1.5H5.75A.75.75 0 0 1 5 5.25Zm0 3c0-.414.336-.75.75-.75H13a.75.75 0 0 1 0 1.5H5.75A.75.75 0 0 1 5 8.25Zm.75 2.25a.75.75 0 0 0 0 1.5H11a.75.75 0 0 0 0-1.5H5.75Z" />
              </svg>
              View documentation
            </button>
          )}
        </div>
      )}
      {!showLabelRow && showDocsButton && (
        <div className="field-label-row">
          <div />
          <button type="button" className="field-docs-button" onClick={handleOpenDocs} title={docsButtonTitle}>
            <svg
              className="field-docs-button__icon"
              viewBox="0 0 16 16"
              role="img"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M2.75 2A1.75 1.75 0 0 0 1 3.75v8.5C1 13.216 1.784 14 2.75 14H14a.75.75 0 0 0 0-1.5H2.75a.25.25 0 0 1-.25-.25V3.75c0-.138.112-.25.25-.25H14a.75.75 0 0 0 0-1.5H2.75Z" />
              <path d="M5 5.25c0-.414.336-.75.75-.75H13a.75.75 0 0 1 0 1.5H5.75A.75.75 0 0 1 5 5.25Zm0 3c0-.414.336-.75.75-.75H13a.75.75 0 0 1 0 1.5H5.75A.75.75 0 0 1 5 8.25Zm.75 2.25a.75.75 0 0 0 0 1.5H11a.75.75 0 0 0 0-1.5H5.75Z" />
            </svg>
            View documentation
          </button>
        </div>
      )}
      {showDescription ? props.description : null}
      {props.children}
      {props.errors}
      {props.help}
    </div>
  );
}
