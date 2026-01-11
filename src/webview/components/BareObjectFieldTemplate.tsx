/* eslint-disable @typescript-eslint/naming-convention */
import React from 'react';
import type { ObjectFieldTemplateProps } from '@rjsf/utils';

export const BareObjectFieldTemplate: React.FC<ObjectFieldTemplateProps> = (props) => {
  const { properties, onAddClick, schema, disabled, readonly, uiSchema, registry } = props;

  const AddButton = registry.templates.ButtonTemplates.AddButton;
  const canAdd = !!schema?.additionalProperties;

  return (
    <div>
      {properties.map((element) => element.content)}
      {canAdd ? (
        <div className="object-field__add">
          <AddButton
            className="object-field__add-button"
            onClick={onAddClick(schema)}
            disabled={disabled || readonly}
            uiSchema={uiSchema}
            registry={registry}
          />
        </div>
      ) : null}
    </div>
  );
};
