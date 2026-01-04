# GitHub Copilot Instructions for vscode-megalinter

## Project Overview

This is a **VS Code extension** that provides a visual configuration interface for [MegaLinter](https://megalinter.io/). It uses a React-based WebView to render JSON Schema-driven forms for editing `.mega-linter.yml` configuration files.

## Technology Stack

- **VS Code Extension API** (v1.75+)
- **TypeScript 5.x** with strict mode
- **React 18** with functional components and hooks
- **RJSF (React JSON Schema Form)** v5 with AJV8 validator
- **Webpack 5** for bundling (extension + webview)
- **YAML** library for config file parsing/serialization

## Architecture

```
src/
├── extension.ts          # VS Code extension entry point, command registration
├── configurationPanel.ts # WebView panel management, message handling
├── types.d.ts            # Module declarations (images, legacy libs)
├── shared/               # Code shared between extension and webview
│   ├── schemaUtils.ts    # JSON Schema parsing and grouping logic
│   └── configPresence.ts # Detect which config keys have values
├── webview/              # React application for the WebView
│   ├── index.tsx         # React entry point
│   ├── App.tsx           # Main application component (orchestrator)
│   ├── menuUtils.ts      # Navigation model and form utilities
│   ├── styles.css        # All CSS styles (VS Code theme variables)
│   ├── types/            # Centralized TypeScript definitions
│   ├── hooks/            # Custom React hooks (state, API, navigation)
│   ├── components/       # Reusable UI components
│   └── assets/           # Static assets (images)
└── descriptors/          # MegaLinter descriptor YAML files (bundled metadata)
```

## Coding Conventions

### TypeScript

- Use **strict TypeScript** - avoid `any` when possible, prefer explicit types
- Use **type imports**: `import type { X } from '...'`
- Prefer **interfaces** for object shapes, **types** for unions/intersections
- Use **const assertions** for literal types: `as const`
- Handle errors with type guards: `if (error instanceof Error)`
- **Centralized Types**: Define shared interfaces in `src/webview/types/index.ts`

### React

- Use **functional components** with hooks exclusively
- **Component Extraction**: Keep components small and focused. Place them in `src/webview/components/`.
- **Custom Hooks**: Extract logic (state, API calls) into hooks in `src/webview/hooks/`.
- Use **React.FC<Props>** type annotation for components with props
- Use **useMemo** and **useCallback** for expensive computations and callbacks

### State Management

- Use **useVSCodeApi** hook for extension communication and state persistence
- Use **useNavigationState** hook for managing UI navigation (tabs, categories, descriptors)
- Persist WebView state with `vscode.setState()` / `vscode.getState()`
- Auto-save configuration with debounced writes (400ms delay)

### Styling

- Use **VS Code CSS variables** for theming: `var(--vscode-*)`
- Follow **BEM naming** for CSS classes: `.block__element--modifier`
- Keep styles in `styles.css` (single file for webview)
- Support both dark and light themes

### VS Code Extension

- Register commands in `package.json` contributes section
- Use **vscode.Disposable** pattern for cleanup
- Handle webview messages with typed message objects
- Use **vscode.Uri.joinPath** for path construction

## Key Patterns

### WebView Communication

```typescript
// Extension → WebView
panel.webview.postMessage({ type: 'configData', config, configPath });

// WebView → Extension
vscode.postMessage({ type: 'saveConfig', config: data });

// Message handling in extension
panel.webview.onDidReceiveMessage(async (message) => {
  switch (message.type) {
    case 'saveConfig': /* ... */ break;
  }
});
```

### Schema-Driven Forms

```typescript
// Build subset schema for a specific set of keys
const subsetSchema = buildSubsetSchema(baseSchema, keys, title, prefixToStrip);

// Create UI schema with widgets
const uiSchema = buildScopedUiSchema(baseSchema, keys, baseUiSchema, highlightedKeys);

// Render with RJSF
<Form
  schema={subsetSchema}
  uiSchema={uiSchema}
  formData={filterFormData(formData, keys)}
  validator={validator}
  onChange={({ formData }) => onSubsetChange(keys, formData)}
/>
```

### Navigation Model

```typescript
// Navigation targets for deep linking
type NavigationTarget =
  | { type: 'home' }
  | { type: 'general' }
  | { type: 'category'; categoryId: string }
  | { type: 'descriptor'; descriptorId: string }
  | { type: 'linter'; descriptorId: string; linterId: string };
```

## File-Specific Guidelines

### extension.ts
- Keep minimal - only command registration and panel creation
- Use `resolveConfigPath()` to find `.mega-linter.yml` or `.megalinter.yml`

### configurationPanel.ts
- Manages WebView lifecycle and state
- Handles descriptor metadata loading (local + remote with caching)
- Preserves YAML comments when saving (uses `YAML.parseDocument`)

### webview/App.tsx
- Main orchestrator component
- Uses `useVSCodeApi` for communication
- Uses `useNavigationState` for routing
- Renders `NavigationMenu` and either `HomePanel` or `MainTabs`

### webview/components/
- Contains all UI components
- `HomePanel`: Landing page with stats and shortcuts
- `NavigationMenu`: Sidebar navigation
- `MainTabs`: Tabbed interface for configuration forms
- `ThemedForm`: RJSF wrapper with theme support

### webview/hooks/
- `useVSCodeApi`: Wrapper for `acquireVsCodeApi` and state persistence
- `useNavigationState`: Manages active tab, category, and descriptor selection

### schemaUtils.ts
- Parses MegaLinter JSON Schema to extract category/descriptor/linter groups
- Filters removed linters via `REMOVED_LINTERS` set
- Provides metadata for navigation and form organization

### menuUtils.ts
- Builds navigation model from schema groups
- Handles form data filtering, pruning defaults, and UI schema generation
- Contains helper functions for label formatting

## Common Tasks

### Adding a New Command
1. Add to `package.json` → `contributes.commands`
2. Register in `extension.ts` with `vscode.commands.registerCommand`
3. Add any menu contributions to `package.json` → `contributes.menus`

### Adding a New Form Widget
1. Create widget component implementing `WidgetProps` from `@rjsf/utils`
2. Add to `widgets` object in form rendering
3. Apply via `uiSchema` with `'ui:widget': 'widgetName'`

### Modifying Navigation Structure
1. Update `buildNavigationModel()` in `menuUtils.ts`
2. Add new `NavigationTarget` type variant if needed
3. Handle in `useNavigationState` hook

### Updating Descriptor Metadata
1. Descriptors are loaded from `src/descriptors/` (local) or GitHub API (remote)
2. Cached for 24 hours in global state
3. Update `_ingestDescriptorContent()` in `configurationPanel.ts` for parsing changes

## Testing Considerations

- Test with both `.mega-linter.yml` and `.megalinter.yml` filenames
- Test with empty config, partial config, and full config
- Verify theme compatibility (dark, light, high contrast)
- Test WebView state persistence across panel hide/show cycles
- Validate YAML comment preservation on save

## Performance Guidelines

- Debounce save operations (currently 400ms)
- Cache schema and metadata (24-hour TTL)
- Use `useMemo` for derived data from schema/formData
- Lazy-load linter descriptions when section is expanded
- Minimize re-renders with proper dependency arrays

## Security Notes

- WebView uses strict CSP with nonce-based script loading
- External images allowed from `https:` sources only
- No `eval()` usage - `'unsafe-eval'` in CSP is for RJSF/AJV runtime
- Sanitize any user content before rendering

## Dependencies

### Production
- `@rjsf/core`, `@rjsf/utils`, `@rjsf/validator-ajv8` - Form generation
- `yaml` - YAML parsing with comment preservation
- `js-yaml` - Legacy YAML support
- `marked` - Markdown rendering for linter descriptions
- `react`, `react-dom` - UI framework

### Development
- `webpack`, `ts-loader` - Build tooling
- `@types/vscode` - VS Code API types
- `typescript` - Type checking

## Common Gotchas

1. **YAML vs js-yaml**: Use `yaml` package for config (preserves comments), `js-yaml` is legacy
2. **Schema caching**: Schema is cached in both extension (`globalState`) and webview (`vscode.setState`)
3. **Windows paths**: Use `vscode.Uri.joinPath` not string concatenation
4. **Webview state**: State is lost if user closes the panel; use `retainContextWhenHidden: true`
5. **Form data pruning**: `pruneDefaults()` removes default values to keep config minimal
6. **VS Code API**: `acquireVsCodeApi()` must be called exactly once. Use the `useVSCodeApi` hook which handles this correctly.
