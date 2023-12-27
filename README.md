# odoo-dev-plugin

Switch between projects, debug without configuration

## Features

- Create, fetch, checkout dev branches
- Start/debug odoo server
- Configure to start/debug test file or selected test method
- Start chrome browser to debug JS in the editor
- Dependency tree of the addons

## Demo

- Switching branch: https://youtu.be/1dwnZ488Xfs
- Debugging: https://youtu.be/GP794cqC9RI

## Getting started

- Open the folder (or workspace) that contains the `odoo`, `upgrade` and/or
  custom addons repositories.
  - Check the Odoo Dev Activity Bar on the left to see if the repositories are
    loaded.
- Open the settings and search for "odoo dev".
  - Look for `Config Path` setting to specify the path of the config file that
    will be used for starting the odoo server.
- Open command palette and type "odoo dev" to see the list of available
  commands.

## Recommendations

- Install [pydevd-odoo](https://github.com/odoo-ide/pydevd-odoo) for better
  display of the recordset objects during debugging.
- Install the Python extension (`ms-python.python`). The selected python
  interpreter using this extension will be used to run the odoo server.

## Contributions

See "Feature Contributions" in the plugin page.

## Known Limitations

- Doesn't support workflows that utilize worktrees.

## Questions you might ask (FAQ)

- Why is the `Odoo Dev: Start Server` command not using the correct python
  interpreter?
  - Run the command `Python: Select Interpreter` to specify the python
    interpeter that will be used in your current workspace.
- Why did you waste your time on this?
  - I don't know. Perhaps I just want to learn more about VS Code extension
    creation.
  - It's actually not easy to track many tasks. This helped me a lot in
    switching between them.
