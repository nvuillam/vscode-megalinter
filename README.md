# MegaLinter Configuration Extension

A Visual Studio Code extension that provides a graphical user interface for configuring [MegaLinter](https://github.com/oxsecurity/megalinter) through `.mega-linter.yml` files.

## Features

- **Visual Configuration Editor**: Configure MegaLinter using a form-based UI instead of manually editing YAML files
- **Schema-Based Validation**: Automatically validates configuration using MegaLinter's official JSON Schema
- **React-Powered WebView**: Modern, responsive UI built with React
- **Automatic Schema Fetching**: Always uses the latest MegaLinter configuration schema from the official repository
- **YAML Integration**: Seamlessly reads and writes `.mega-linter.yml` files

## Usage

### Opening the Configuration Editor

There are several ways to open the MegaLinter configuration editor:

1. **Command Palette**: 
   - Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
   - Type "MegaLinter: Open Configuration"
   - Press Enter

2. **Context Menu**: 
   - Right-click on a `.mega-linter.yml` or `.megalinter.yml` file in the Explorer
   - Select "MegaLinter: Open Configuration"

3. **Workspace Detection**:
   - If you have an existing `.mega-linter.yml` file in your workspace root, the command will open it
   - If no configuration file exists, a new one will be created in your workspace root

### Configuring MegaLinter

1. Open the configuration editor using any of the methods above
2. Fill in the form fields according to your linting requirements
3. All fields are validated based on MegaLinter's JSON Schema
4. Click "Save Configuration" to save your changes to `.mega-linter.yml`
5. The extension will display a confirmation message when the configuration is saved

### Form Features

- **Field Validation**: All fields are validated according to MegaLinter's schema requirements
- **Type-Appropriate Inputs**: The form automatically generates appropriate input types (text, number, checkbox, etc.) based on the schema
- **Nested Properties**: Complex nested configurations are supported with collapsible sections
- **Array Support**: Add, remove, and reorder array items
- **Help Text**: Field descriptions from the schema are displayed as help text

## Installation

### From VSIX Package

1. Download the `.vsix` file from the releases page
2. In VS Code, go to Extensions view (`Ctrl+Shift+X`)
3. Click the "..." menu at the top of the Extensions view
4. Select "Install from VSIX..."
5. Choose the downloaded `.vsix` file

### From Source

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run build` to build the extension
4. Press `F5` in VS Code to launch the extension in debug mode

## Development

### Prerequisites

- Node.js 18.x or higher
- npm 8.x or higher
- Visual Studio Code 1.75.0 or higher

### Building

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Build for development (with watch mode)
npm run watch

# Compile without optimization
npm run compile
```

### Debugging

The repository includes `.vscode/launch.json` and `.vscode/tasks.json` for easy debugging:

1. **Open the project in VS Code**
   ```bash
   code .
   ```

2. **Start debugging** (Option 1: Quick Launch)
   - Press `F5` to build and launch the Extension Development Host
   - A new VS Code window will open with the extension loaded

3. **Start debugging** (Option 2: Debug View)
   - Open the Debug view (`Ctrl+Shift+D` / `Cmd+Shift+D`)
   - Select "Run Extension" from the dropdown
   - Click the green play button or press `F5`

4. **Using the debugger**
   - Set breakpoints in your TypeScript files (`src/**/*.ts`, `src/**/*.tsx`)
   - The debugger will pause at breakpoints
   - Use the Debug Console to inspect variables
   - Check the Extension Host Console for extension logs
   - Check the WebView Developer Tools for React app debugging

5. **Debugging the WebView**
   - After launching the extension, open the configuration UI
   - In the Extension Development Host, press `Ctrl+Shift+P` / `Cmd+Shift+P`
   - Type "Developer: Open Webview Developer Tools"
   - This opens Chrome DevTools for the React application

6. **Hot Reload**
   - In a separate terminal, run `npm run watch`
   - After making changes, press `Ctrl+R` / `Cmd+R` in the Extension Development Host to reload

### Debug Configurations

The project includes two debug configurations:

- **Run Extension**: Launches the extension for manual testing
- **Extension Tests**: Runs automated tests (when available)

### Troubleshooting Debugging

- **Extension doesn't load**: Run `npm run build` and restart debugging
- **Breakpoints not hit**: Ensure source maps are generated (check `webpack.config.js`)
- **WebView not working**: Check Developer Console for errors (`Help > Toggle Developer Tools`)
- **Build errors**: Delete `node_modules` and `dist`, then run `npm install && npm run build`

### Project Structure

```
.
├── src/
│   ├── extension.ts           # Extension entry point
│   ├── configurationPanel.ts  # WebView panel manager
│   ├── types.d.ts            # TypeScript type definitions
│   └── webview/
│       ├── index.tsx         # WebView entry point
│       ├── App.tsx           # Main React component
│       └── styles.css        # WebView styles
├── dist/                     # Build output
├── package.json             # Extension manifest
├── tsconfig.json           # TypeScript configuration
└── webpack.config.js       # Webpack configuration
```

### Technologies Used

- **TypeScript**: Primary language for extension and webview code
- **React**: UI framework for the configuration form
- **React JSONSchema Form (@rjsf/core)**: Automatic form generation from JSON Schema
- **js-yaml**: YAML parsing and serialization
- **Webpack**: Module bundling
- **AJV**: JSON Schema validation

## About MegaLinter

MegaLinter is an Open Source tool for CI/CD workflows that analyzes the consistency of your code, IAC, configuration, and scripts across 50+ languages, formats, tooling formats, and other formats. For more information, visit the [MegaLinter repository](https://github.com/oxsecurity/megalinter).

## Configuration Schema

This extension uses the official MegaLinter configuration schema available at:
https://github.com/oxsecurity/megalinter/blob/main/megalinter/descriptors/schemas/megalinter-configuration.jsonschema.json

## License

This project is licensed under the MIT License.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues and feature requests, please use the [GitHub issue tracker](https://github.com/nvuillam/vscode-megalinter/issues).
