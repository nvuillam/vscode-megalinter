# Quick Start Guide

## For Users

### Installation
1. Download the `.vsix` file from releases
2. In VS Code: Extensions → "..." menu → "Install from VSIX..."
3. Select the downloaded file

### First Use
1. Open a workspace/folder in VS Code
2. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
3. Type "MegaLinter: Open Configuration"
4. Configure your linting preferences
5. Click "Save Configuration"

That's it! Your `.mega-linter.yml` file is ready to use with MegaLinter.

## For Developers

### Setup
```bash
git clone https://github.com/nvuillam/vscode-megalinter.git
cd vscode-megalinter
npm install
```

### Development
```bash
# Build
npm run build

# Watch mode (auto-rebuild on changes)
npm run watch

# Debug
# Press F5 in VS Code to launch Extension Development Host
# The .vscode/launch.json file is included for easy debugging
```

### Debugging Steps

1. **Open the project in VS Code**
2. **Press F5** to start debugging
3. A new VS Code window (Extension Development Host) will open
4. In the new window, test the extension
5. Set breakpoints in your source files to debug
6. Use `Ctrl+Shift+P` → "Developer: Open Webview Developer Tools" to debug the React UI

For detailed debugging information, see the main README.md file.

### Testing
1. Press `F5` to launch Extension Development Host
2. In the new window, open a workspace
3. Run the "MegaLinter: Open Configuration" command
4. Test the functionality

### Building for Distribution
```bash
# Build production version
npm run build

# Package as .vsix (requires vsce)
npm install -g @vscode/vsce
npm run package
```

## Key Files

- `src/extension.ts` - Extension entry point
- `src/configurationPanel.ts` - WebView manager
- `src/webview/App.tsx` - React UI component
- `src/webview/styles.css` - UI styles
- `webpack.config.js` - Build configuration

## Common Issues

### Build fails
- Run `npm install` to ensure all dependencies are installed
- Check Node.js version (requires 18+)

### Extension doesn't load in debug
- Rebuild: `npm run build`
- Reload window: `Ctrl+R` / `Cmd+R` in Extension Development Host

### Form doesn't appear
- Check internet connection (schema is fetched from GitHub)
- Check Developer Console for errors (Help → Toggle Developer Tools)

## More Information

- Full documentation: `README.md`
- User guide: `EXTENSION_GUIDE.md`
- Contributing: `CONTRIBUTING.md`
- Testing: `TESTING.md`
