# Testing Checklist for MegaLinter Configuration Extension

## Pre-Testing Setup
- [ ] Build the extension: `npm run build`
- [ ] Launch Extension Development Host: Press F5 in VS Code

## Extension Activation Tests
- [ ] Extension loads without errors in Extension Host
- [ ] Check Developer Console (Help > Toggle Developer Tools) for errors
- [ ] Verify extension appears in Extensions list

## Command Palette Tests
- [ ] Open Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
- [ ] Type "MegaLinter"
- [ ] Verify "MegaLinter: Open Configuration" command appears
- [ ] Execute the command
- [ ] Verify WebView opens

## WebView Loading Tests
- [ ] Verify "MegaLinter Configuration" tab opens
- [ ] Check that loading indicator appears initially
- [ ] Verify schema loads successfully from GitHub
- [ ] Check that form appears after schema loads
- [ ] Verify no errors in Developer Console

## New Configuration Tests (No Existing File)
- [ ] Open a workspace with no .mega-linter.yml file
- [ ] Run "MegaLinter: Open Configuration" command
- [ ] Verify form loads with empty/default values
- [ ] Fill in some test values (e.g., APPLY_FIXES: "all")
- [ ] Click "Save Configuration" button
- [ ] Verify success message appears
- [ ] Check that .mega-linter.yml file was created in workspace root
- [ ] Open the file and verify YAML is properly formatted

## Existing Configuration Tests
- [ ] Create a .mega-linter.yml file with test content:
  ```yaml
  APPLY_FIXES: all
  SHOW_ELAPSED_TIME: true
  LOG_LEVEL: INFO
  ```
- [ ] Right-click on the file in Explorer
- [ ] Verify "MegaLinter: Open Configuration" appears in context menu
- [ ] Click the context menu item
- [ ] Verify WebView opens with existing values loaded
- [ ] Verify form fields contain the correct values from the file

## Form Validation Tests
- [ ] Try to enter invalid values in form fields
- [ ] Verify validation errors appear
- [ ] Try to save with validation errors
- [ ] Verify form prevents saving invalid data

## Edit and Save Tests
- [ ] Load existing configuration
- [ ] Modify some values
- [ ] Click "Save Configuration"
- [ ] Verify success message
- [ ] Close the WebView
- [ ] Open the .mega-linter.yml file in text editor
- [ ] Verify changes were saved correctly

## Array Field Tests
- [ ] Find an array field in the form (e.g., ENABLE, DISABLE)
- [ ] Add items using the "+" button
- [ ] Remove items using the "-" button
- [ ] Verify items can be reordered (if available)
- [ ] Save and verify array is correctly formatted in YAML

## Boolean Field Tests
- [ ] Toggle boolean fields (checkboxes)
- [ ] Save configuration
- [ ] Verify booleans are saved as true/false in YAML

## Number Field Tests
- [ ] Enter numeric values
- [ ] Try entering non-numeric values (should be prevented)
- [ ] Verify numbers are saved correctly

## Theme Compatibility Tests
- [ ] Test with VS Code Light Theme
  - Verify form is readable
  - Verify buttons are visible
  - Verify colors match theme
- [ ] Test with VS Code Dark Theme
  - Verify form is readable
  - Verify buttons are visible
  - Verify colors match theme

## Error Handling Tests
- [ ] Disconnect from internet
- [ ] Try to open configuration
- [ ] Verify appropriate error message about schema loading
- [ ] Reconnect and verify recovery

## Edge Cases
- [ ] Test with workspace containing multiple .mega-linter.yml variants
- [ ] Test with no workspace open (should show error)
- [ ] Test with read-only file system (should show error on save)
- [ ] Test with very large configuration file

## Performance Tests
- [ ] Open configuration
- [ ] Measure time to load
- [ ] Verify no lag when typing in fields
- [ ] Verify no lag when saving

## Cross-Platform Tests (if possible)
- [ ] Test on Windows
- [ ] Test on macOS
- [ ] Test on Linux

## Build and Package Tests
- [ ] Run `npm run build` successfully
- [ ] Run `npm run lint` with no errors
- [ ] Package with `vsce package` (if vsce is installed)
- [ ] Install .vsix file in clean VS Code instance
- [ ] Verify extension works after installation

## Documentation Tests
- [ ] Follow README instructions
- [ ] Verify all documented features work
- [ ] Verify example configuration file is valid
- [ ] Check that all links in documentation work

## Cleanup Tests
- [ ] Close WebView
- [ ] Verify no memory leaks (check Task Manager/Activity Monitor)
- [ ] Reopen WebView
- [ ] Verify state is properly restored

## Results Summary
Record any issues found:
- Issue 1:
- Issue 2:
- etc.

## Sign-Off
- Tester Name: _______________
- Date: _______________
- Build Version: _______________
- Result: PASS / FAIL
