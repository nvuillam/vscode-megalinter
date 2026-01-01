# MegaLinter Configuration Extension - User Guide

## Overview

This extension provides a visual interface for configuring MegaLinter, a comprehensive linting tool. Instead of manually editing YAML configuration files, you can use a form-based interface that validates your settings against MegaLinter's official schema.

## Getting Started

### First Time Setup

1. **Open your project in VS Code**
   - Make sure you have a workspace folder open

2. **Open the Configuration Editor**
   - Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
   - Type "MegaLinter: Open Configuration"
   - Press Enter

3. **Configure MegaLinter**
   - The extension will create a new `.mega-linter.yml` file if one doesn't exist
   - Fill in the form fields based on your project's needs
   - Click "Save Configuration" when done

### Editing an Existing Configuration

If you already have a `.mega-linter.yml` file:

1. **Option 1: Using Command Palette**
   - Press `Ctrl+Shift+P` / `Cmd+Shift+P`
   - Type "MegaLinter: Open Configuration"
   - The extension will load your existing configuration

2. **Option 2: Using Context Menu**
   - Find your `.mega-linter.yml` file in the Explorer
   - Right-click on it
   - Select "MegaLinter: Open Configuration"

## Understanding the Form

The configuration form is automatically generated from MegaLinter's JSON Schema. Here's what you'll see:

### Field Types

- **Text Fields**: For string values like `APPLY_FIXES` or `DEFAULT_WORKSPACE`
- **Number Fields**: For numeric values like `PARALLEL_PROCESS_COUNT`
- **Checkboxes**: For boolean values like `SHOW_ELAPSED_TIME`
- **Dropdown Menus**: For fields with predefined options
- **Arrays**: For lists of values (e.g., list of linters to enable)
- **Objects**: For nested configuration structures

### Validation

- **Required Fields**: Marked with a red asterisk (*)
- **Format Validation**: Fields are validated according to their type (number, email, URL, etc.)
- **Schema Constraints**: Values must match MegaLinter's schema requirements
- **Error Messages**: Displayed below invalid fields with clear descriptions

### Working with Arrays

Many MegaLinter settings use arrays (lists). Here's how to work with them:

1. **Add Items**: Click the "+" or "Add" button
2. **Remove Items**: Click the "-" or "Remove" button next to each item
3. **Reorder Items**: Use the up/down arrow buttons (if available)

### Working with Nested Objects

Some configuration options have nested structures:

1. Expand sections by clicking on them
2. Fill in nested fields just like top-level fields
3. Collapse sections to keep the form organized

## Common Configuration Options

Here are some commonly used MegaLinter settings you might want to configure:

### Basic Settings

- **APPLY_FIXES**: Whether to automatically apply fixes
- **DEFAULT_WORKSPACE**: Default workspace directory
- **SHOW_ELAPSED_TIME**: Display elapsed time for each linter

### Linter Control

- **ENABLE**: List of linters to enable
- **DISABLE**: List of linters to disable
- **ENABLE_LINTERS**: Enable specific linters by name
- **DISABLE_LINTERS**: Disable specific linters by name

### Performance

- **PARALLEL_PROCESS_COUNT**: Number of parallel processes

### Output

- **LOG_LEVEL**: Logging verbosity level
- **FORMATTERS_DISABLE_ERRORS**: Whether to disable formatter errors

## Saving Your Configuration

1. **Review Your Changes**: Scroll through the form to verify your settings
2. **Fix Validation Errors**: Address any red error messages
3. **Click "Save Configuration"**: The button is at the bottom of the form
4. **Confirmation**: You'll see a success message when the file is saved

## Tips and Best Practices

### Tip 1: Start Simple
Begin with a minimal configuration and add options as needed. You don't need to fill in every field.

### Tip 2: Use Validation
The form prevents invalid configurations. If a field shows an error, read the message carefully, it tells you what's wrong.

### Tip 3: Refer to MegaLinter Docs
For detailed information about specific settings, visit [MegaLinter's documentation](https://megalinter.io/).

### Tip 4: Version Control
Commit your `.mega-linter.yml` file to version control so your team uses the same linting configuration.

### Tip 5: Test Your Configuration
After saving, test your MegaLinter configuration by running MegaLinter in your project:
```bash
npx mega-linter-runner
```

## Troubleshooting

### Problem: Configuration Won't Load
**Solution**: 
- Check if your `.mega-linter.yml` file has valid YAML syntax
- Try opening the file in a text editor to see if there are syntax errors
- Create a new configuration file using the extension

### Problem: Schema Not Loading
**Solution**:
- Check your internet connection (the extension fetches the schema from GitHub)
- Wait a moment and try reopening the configuration editor
- Check VS Code's Developer Tools for error messages

### Problem: Changes Not Saving
**Solution**:
- Check file permissions in your workspace directory
- Verify you have write access to the workspace
- Look for error messages in the VS Code notification area

### Problem: Form Looks Broken
**Solution**:
- Reload VS Code window (`Ctrl+Shift+P` / `Cmd+Shift+P` → "Reload Window")
- Rebuild the extension if using from source: `npm run build`
- Check the VS Code Developer Console for JavaScript errors

## Advanced Usage

### Custom Schema Location
The extension automatically fetches the latest schema from MegaLinter's GitHub repository. This ensures you always have the most up-to-date configuration options.

### Multiple Configuration Files
While MegaLinter typically uses one `.mega-linter.yml` file per project, you can use the context menu to edit specific files if you have multiple configurations.

### Integrating with CI/CD
After configuring MegaLinter using this extension:

1. Commit your `.mega-linter.yml` file
2. Add MegaLinter to your CI/CD pipeline
3. Your CI/CD system will use the configuration you created

Example GitHub Actions workflow:
```yaml
- name: MegaLinter
  uses: oxsecurity/megalinter@v7
```

## Keyboard Shortcuts

While in the configuration form:
- **Tab**: Move to next field
- **Shift+Tab**: Move to previous field
- **Enter**: Submit form (save configuration)
- **Esc**: (In some contexts) Cancel or close

## Getting Help

- **MegaLinter Documentation**: https://megalinter.io/
- **Extension Issues**: https://github.com/nvuillam/vscode-megalinter/issues
- **MegaLinter Issues**: https://github.com/oxsecurity/megalinter/issues

## Feature Requests and Bug Reports

If you encounter issues or have ideas for improvements:

1. Check existing issues on the GitHub repository
2. Create a new issue with:
   - Clear description of the problem/feature
   - Steps to reproduce (for bugs)
   - Expected vs actual behavior
   - VS Code version and extension version

## About the Technology

This extension uses:
- **React**: For the user interface
- **React JSONSchema Form**: For automatic form generation
- **VS Code WebView API**: For embedding the React app
- **js-yaml**: For YAML parsing and generation
- **AJV**: For JSON Schema validation

The form is dynamically generated based on MegaLinter's official JSON Schema, ensuring compatibility with all MegaLinter features.
