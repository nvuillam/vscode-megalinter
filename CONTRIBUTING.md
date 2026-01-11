# Contributing to MegaLinter Configuration Extension

Thank you for your interest in contributing to the MegaLinter Configuration extension! This document provides guidelines and instructions for contributing.

## Code of Conduct

This project adheres to a code of conduct. By participating, you are expected to uphold this code. Please be respectful and constructive in all interactions.

## How to Contribute

### Reporting Bugs

Before creating a bug report:
1. Check the [existing issues](https://github.com/nvuillam/vscode-megalinter/issues) to avoid duplicates
2. Gather relevant information about the bug

When submitting a bug report, include:
- A clear, descriptive title
- Steps to reproduce the issue
- Expected behavior
- Actual behavior
- VS Code version
- Extension version
- Operating system
- Screenshots if applicable
- Any error messages from the VS Code Developer Tools console

### Suggesting Enhancements

Enhancement suggestions are welcome! Please:
1. Use a clear, descriptive title
2. Provide a detailed description of the proposed feature
3. Explain why this feature would be useful
4. Include mockups or examples if applicable

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Make your changes** following the coding standards
3. **Test your changes** thoroughly
4. **Update documentation** if needed
5. **Commit your changes** with clear commit messages
6. **Push to your fork** and submit a pull request

#### Pull Request Guidelines

- Keep changes focused - one feature/fix per PR
- Write clear commit messages
- Update tests if applicable
- Update documentation for new features
- Ensure all builds and tests pass
- Follow the existing code style

## Development Setup

### Prerequisites

- Node.js 18.x or higher
- npm 8.x or higher
- VS Code 1.75.0 or higher
- Git

### Getting Started

1. **Clone the repository**
   ```bash
   git clone https://github.com/nvuillam/vscode-megalinter.git
   cd vscode-megalinter
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the extension**
   ```bash
   npm run build
   ```

   Notes:
   - `npm run compile` builds a development bundle into `dist/` (fast, recommended while iterating).
   - `npm run build` builds the production bundle into `dist/`.

4. **Open in VS Code**
   ```bash
   code .
   ```

5. **Start debugging**
   - Press `F5` to launch the Extension Development Host
   - This opens a new VS Code window with your extension loaded

### Development Workflow

1. **Watch mode** for automatic rebuilding:
   ```bash
   npm run watch
   ```

2. **Make your changes** in the `src/` directory

3. **Test in Extension Development Host**:
   - Press `F5` in VS Code to launch
   - Test your changes in the new window
   - Use `Ctrl+R` / `Cmd+R` to reload the extension

   Tips:
   - The repo includes a debug launch configuration “Run Extension” (see `.vscode/launch.json`) that runs `npm: compile` before starting.
   - To debug the React UI: `Developer: Open Webview Developer Tools`.

4. **Check for linting errors**:
   ```bash
   npm run lint
   ```

   If you see a warning about an unsupported TypeScript version from `@typescript-eslint/typescript-estree`, prefer using `npm ci` (uses `package-lock.json`) for consistent toolchain versions, or pin a compatible TypeScript version locally.

5. **Build for production**:
   ```bash
   npm run build
   ```

## Project Structure

```
vscode-megalinter/
├── src/
│   ├── extension.ts           # Extension entry point
│   ├── configurationPanel.ts  # Configuration editor WebView panel
│   ├── customFlavorPanel.ts   # Custom Flavor Builder WebView panel
│   ├── configTreeProvider.ts  # Tree view/provider helpers
│   ├── panelIcon.ts           # Panel icon resolution
│   ├── types.d.ts             # TypeScript declarations
│   ├── descriptors/           # Bundled MegaLinter descriptor YAML + schemas
│   ├── shared/                # Code shared between extension + webview
│   └── webview/               # React WebView bundle (config UI + flavor UI)
│       ├── index.tsx          # WebView entry: selects App vs FlavorApp
│       ├── App.tsx            # Main configuration UI
│       ├── FlavorApp.tsx      # Custom flavor builder UI
│       ├── components/        # Reusable React components
│       ├── hooks/             # Custom hooks
│       ├── types/             # Central TS types
│       └── styles.css         # WebView styles
├── dist/                      # Webpack build output (extension.js + webview.js)
├── node_modules/            # Dependencies (gitignored)
├── package.json             # Extension manifest
├── tsconfig.json           # TypeScript config
├── webpack.config.js       # Webpack config
└── README.md               # Main documentation
```

## Coding Standards

### TypeScript

- Use TypeScript for all new code
- Enable strict type checking
- Provide types for function parameters and return values
- Avoid `any` types when possible; prefer typed message payloads for WebView ↔ extension communication
- Use `import type { ... } from '...'` for type-only imports

### React

- Use functional components with hooks
- Keep components focused and single-purpose
- Use meaningful component and prop names
- Prefer extracting logic into hooks under `src/webview/hooks/`

### WebView Security

- Keep the Content Security Policy strict (nonce-based scripts).
- Prefer `webview.asWebviewUri` + `vscode.Uri.joinPath` for any resource paths.
- Avoid introducing new remote calls unless necessary; if you do, add timeouts and handle offline behavior.

### Styling

- Use CSS custom properties (CSS variables) for theming
- Follow VS Code's theming conventions
- Use semantic class names
- Keep styles scoped to components

### Git Commits

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation changes
- `style:` for code style changes (formatting, etc.)
- `refactor:` for code refactoring
- `test:` for test changes
- `chore:` for maintenance tasks

Example:
```
feat: add support for custom schema URLs
fix: resolve issue with array field validation
docs: update README with new configuration options
```

## Testing

### Manual Testing

1. Launch the Extension Development Host (`F5`)
2. Test the following scenarios:
   - Opening configuration from command palette
   - Opening configuration from context menu
   - Opening the Custom Flavor Builder
   - Creating a new configuration file
   - Loading an existing configuration file
   - Editing and saving configuration
   - Form validation
   - Error handling

For a full checklist, see `TESTING.md`.

### Testing Checklist

Before submitting a PR, verify:
- [ ] Extension activates correctly
- [ ] Command appears in command palette
- [ ] WebView loads without errors
- [ ] Schema fetches successfully
- [ ] Configuration loads correctly
- [ ] Configuration saves correctly
- [ ] Form validation works
- [ ] Error messages are clear
- [ ] UI looks correct in both light and dark themes
- [ ] No console errors in VS Code Developer Tools

## Building for Distribution

To create a `.vsix` package:

1. Install `vsce`:
   ```bash
   npm install -g @vscode/vsce
   ```

2. Package the extension:
   ```bash
   npm run package
   ```

   Note: `npm run package` expects `vsce` to be installed (globally is simplest).

3. The `.vsix` file will be created in the project root

## Documentation

When adding new features:
- Update `README.md` with user-facing changes
- Update `EXTENSION_GUIDE.md` with detailed usage instructions
- Update `CHANGELOG.md` following Keep a Changelog format
- Add inline code comments for complex logic

## Questions?

If you have questions:
- Check existing documentation
- Search through issues
- Create a new issue with the "question" label

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Recognition

Contributors will be acknowledged in the project's README and release notes.

Thank you for contributing to the MegaLinter Configuration extension!
