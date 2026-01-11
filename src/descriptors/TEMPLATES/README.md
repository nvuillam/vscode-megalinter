# TEMPLATES

This folder is an **optional offline cache** for MegaLinter linter configuration templates.

By default, the extension will try to fetch templates from the upstream MegaLinter repository (`TEMPLATES/…`). If you want the extension to work without network access (or to pin specific template versions), you can place copies of the needed template files here.

If you copy a template to your local repository in `.github/linters`, MegaLinter will use it at runtime.

The file(s) will be parsed at run time on the local branch to load all rules needed to run the **MegaLinter** **GitHub** Action.
The **GitHub** Action will inform the user via the **Checks API** on the status and success of the process.
