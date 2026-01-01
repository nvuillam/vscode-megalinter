# Architecture Overview

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         VS Code                                  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              Extension (Node.js)                           │ │
│  │                                                            │ │
│  │  ┌──────────────┐         ┌────────────────────────────┐  │ │
│  │  │ extension.ts │────────▶│ configurationPanel.ts      │  │ │
│  │  │              │         │                            │  │ │
│  │  │ • Activate   │         │ • Create WebView           │  │ │
│  │  │ • Register   │         │ • Load/Save YAML           │  │ │
│  │  │   Command    │         │ • Message Handling         │  │ │
│  │  └──────────────┘         └────────────────────────────┘  │ │
│  │                                     │                      │ │
│  └─────────────────────────────────────┼──────────────────────┘ │
│                                        │                        │
│                                        │ postMessage()          │
│                                        │ onDidReceiveMessage()  │
│  ┌─────────────────────────────────────┼──────────────────────┐ │
│  │              WebView (Browser)      │                      │ │
│  │                                     ▼                      │ │
│  │  ┌────────────────────────────────────────────────────┐   │ │
│  │  │              React Application                     │   │ │
│  │  │                                                    │   │ │
│  │  │  ┌──────────┐       ┌─────────────────────────┐   │   │ │
│  │  │  │ App.tsx  │──────▶│ React JSON Schema Form  │   │   │ │
│  │  │  │          │       │ (@rjsf/core)            │   │   │ │
│  │  │  │ • Fetch  │       │                         │   │   │ │
│  │  │  │   Schema │       │ • Dynamic Form Gen      │   │   │ │
│  │  │  │ • Manage │       │ • Validation (AJV)      │   │   │ │
│  │  │  │   State  │       │ • Field Rendering       │   │   │ │
│  │  │  └──────────┘       └─────────────────────────┘   │   │ │
│  │  │                                                    │   │ │
│  │  └────────────────────────────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Opening Configuration

```
User Action
    │
    ▼
Command Palette: "MegaLinter: Open Configuration"
    │
    ▼
extension.ts
    │
    ├─▶ Find .mega-linter.yml in workspace
    │
    ▼
configurationPanel.ts
    │
    ├─▶ Create WebView Panel
    ├─▶ Load HTML with React app
    │
    ▼
WebView Loaded
    │
    ▼
App.tsx
    │
    ├─▶ Fetch Schema from GitHub
    │   https://raw.githubusercontent.com/oxsecurity/megalinter/main/...
    │
    ├─▶ Send "getConfig" message to extension
    │
    ▼
configurationPanel.ts
    │
    ├─▶ Read .mega-linter.yml
    ├─▶ Parse YAML with js-yaml
    ├─▶ Send config data to WebView
    │
    ▼
App.tsx
    │
    ├─▶ Render form with schema + data
    │
    ▼
React JSON Schema Form
    │
    ▼
User sees form
```

### Saving Configuration

```
User fills form
    │
    ▼
User clicks "Save Configuration"
    │
    ▼
React JSON Schema Form
    │
    ├─▶ Validate form data
    │
    ▼
App.tsx (onSubmit)
    │
    ├─▶ Send "saveConfig" message with data
    │
    ▼
configurationPanel.ts
    │
    ├─▶ Convert to YAML with js-yaml
    ├─▶ Write to .mega-linter.yml
    ├─▶ Show success notification
    │
    ▼
File saved ✓
```

## Technology Stack

### Extension (Node.js)
- **TypeScript**: Type-safe code
- **VS Code API**: Extension framework
- **js-yaml**: YAML parsing/serialization
- **Webpack**: Bundling for Node.js

### WebView (Browser)
- **React 18**: UI framework
- **React JSON Schema Form**: Dynamic form generation
- **AJV**: JSON Schema validation
- **TypeScript**: Type-safe code
- **CSS**: Styling with VS Code theme variables
- **Webpack**: Bundling for browser

## Key Design Decisions

### 1. Schema Source
- **Decision**: Fetch schema from GitHub at runtime
- **Rationale**: Always use latest MegaLinter schema
- **Alternative considered**: Bundle schema (would require updates)

### 2. Form Generation
- **Decision**: Use React JSON Schema Form (@rjsf/core)
- **Rationale**: Automatic form generation from schema, built-in validation
- **Alternative considered**: Manual form implementation (too much work)

### 3. WebView vs Native UI
- **Decision**: Use WebView with React
- **Rationale**: Rich UI, better form handling, easier styling
- **Alternative considered**: VS Code native UI (limited form capabilities)

### 4. YAML Library
- **Decision**: js-yaml
- **Rationale**: Well-maintained, widely used, good formatting options
- **Alternative considered**: yaml (newer but less mature)

### 5. Bundling Strategy
- **Decision**: Separate bundles for extension and WebView
- **Rationale**: Different environments (Node vs Browser)
- **Implementation**: Two webpack configurations

## Security Considerations

### Content Security Policy
- Scripts: nonce-based (secure)
- Styles: 'unsafe-inline' required for style-loader (acceptable trade-off)
- Default: 'none' (secure)

### Data Validation
- Schema validation with AJV before saving
- Type checking with TypeScript
- No eval() or similar dangerous operations

### Dependencies
- All dependencies checked for vulnerabilities
- Regular updates recommended
- No known security issues

## Performance Characteristics

### Bundle Sizes
- Extension: ~45 KB (minimal)
- WebView: ~454 KB (includes React + RJSF)

### Loading Time
- Extension activation: < 100ms
- WebView creation: < 500ms
- Schema fetch: ~1-2 seconds (network dependent)
- Form rendering: < 500ms

### Memory Usage
- Extension: < 10 MB
- WebView: ~50-100 MB (typical for React apps)

## Extension Points for Future Development

### Possible Enhancements
1. **Offline Mode**: Bundle schema for offline use
2. **Schema Caching**: Cache schema locally
3. **Custom Schemas**: Support custom schema URLs
4. **Templates**: Predefined configuration templates
5. **Validation**: Real-time MegaLinter validation
6. **Import/Export**: Import from other formats
7. **Diff View**: Compare configurations
8. **Multi-file**: Support for multiple config files

### Extension APIs Used
- `vscode.commands`: Command registration
- `vscode.window.createWebviewPanel`: WebView creation
- `vscode.workspace`: Workspace management
- `vscode.window.showInformationMessage`: Notifications
- `vscode.Uri`: File path handling

### Patterns Followed
- Singleton pattern for WebView panel
- Message passing for extension-WebView communication
- React hooks for state management
- TypeScript for type safety
- Webpack for code bundling
