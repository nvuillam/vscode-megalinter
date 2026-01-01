import { useEffect, useState } from 'react';
import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';
import { RJSFSchema, UiSchema } from '@rjsf/utils';
import bundledSchema from '../schema/megalinter-configuration.jsonschema.json';
import './styles.css';

// VS Code API type
declare global {
  interface Window {
    acquireVsCodeApi: () => {
      postMessage: (message: any) => void;
      setState: (state: any) => void;
      getState: () => any;
    };
  }
}

const vscode = window.acquireVsCodeApi();

export const App: React.FC = () => {
  const [schema, setSchema] = useState<RJSFSchema | null>(null);
  const [formData, setFormData] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configPath, setConfigPath] = useState<string>('');
  const [schemaSource, setSchemaSource] = useState<'remote' | 'local' | null>(
    null
  );

  useEffect(() => {
    const fallbackSchema = bundledSchema as RJSFSchema;
    const remoteSchemaUrl =
      'https://raw.githubusercontent.com/oxsecurity/megalinter/main/megalinter/descriptors/schemas/megalinter-configuration.jsonschema.json';

    // Fetch the schema from GitHub, fall back to bundled copy when offline
    const fetchSchema = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 8000);

        const response = await fetch(remoteSchemaUrl, {
          signal: controller.signal
        });

        window.clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Failed to fetch schema (HTTP ${response.status})`);
        }

        const schemaData = await response.json();
        setSchema(schemaData);
        setSchemaSource('remote');
      } catch (err) {
        console.warn('Remote schema fetch failed, using bundled schema', err);
        try {
          setSchema(fallbackSchema);
          setSchemaSource('local');
          vscode.postMessage({
            type: 'info',
            message:
              'Using bundled MegaLinter schema (remote fetch unavailable).'
          });
        } catch (fallbackErr) {
          const errorMessage =
            fallbackErr instanceof Error
              ? fallbackErr.message
              : String(fallbackErr);
          setError(`Failed to load MegaLinter schema: ${errorMessage}`);
          vscode.postMessage({
            type: 'error',
            message: `Failed to load MegaLinter schema: ${errorMessage}`
          });
        }
      } finally {
        setLoading(false);
      }
    };

    fetchSchema();

    // Request current config
    vscode.postMessage({ type: 'getConfig' });

    // Listen for messages from the extension
    const messageHandler = (event: MessageEvent) => {
      const message = event.data;
      switch (message.type) {
        case 'configData':
          setFormData(message.config);
          setConfigPath(message.configPath);
          break;
      }
    };

    window.addEventListener('message', messageHandler);

    return () => {
      window.removeEventListener('message', messageHandler);
    };
  }, []);

  const handleSubmit = ({ formData }: any) => {
    vscode.postMessage({
      type: 'saveConfig',
      config: formData
    });
  };

  const handleChange = ({ formData }: any) => {
    setFormData(formData);
  };

  // Custom UI schema to improve the form appearance
  const uiSchema: UiSchema = {
    'ui:submitButtonOptions': {
      submitText: 'Save Configuration',
      norender: false,
      props: {
        className: 'btn-primary'
      }
    }
  };

  if (loading) {
    return (
      <div className="container">
        <div className="loading">
          <p>Loading MegaLinter schema...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="error">
          <h2>Error</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!schema) {
    return (
      <div className="container">
        <div className="error">
          <p>No schema available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="header">
        <h1>MegaLinter Configuration</h1>
        {configPath && (
          <p className="config-path">
            Editing: <code>{configPath}</code>
          </p>
        )}
        {schemaSource && (
          <p className="config-path">
            Schema source: {schemaSource === 'remote' ? 'remote' : 'bundled'}
          </p>
        )}
      </div>
      <div className="form-container">
        <Form
          schema={schema}
          uiSchema={uiSchema}
          formData={formData}
          validator={validator}
          onChange={handleChange}
          onSubmit={handleSubmit}
          liveValidate={false}
          showErrorList="bottom"
        />
      </div>
    </div>
  );
};
