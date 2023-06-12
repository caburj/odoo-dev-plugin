# odoo-dev-plugin

Switching to different branches very often? Want to debug odoo inside VS Code?
This plugin can help.

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

- Open the folder (or workspace) that contains the `odoo`, `enterprise` and/or
  `upgrade` repositories.
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

### Settings

- Branch Name as DB (`odooDev.branchNameAsDB`)
- Pull Base Branch on Create (`odooDev.pullBaseOnCreate`)
- Config Path (`odooDev.odooConfigPath`)
- Notes Folder (`odooDev.notesFolder`)
- Auto Stash (`odooDev.autoStash`)
- Auto Test (`odooDev.autoTest`)

### Commands

**Branches management**

- Odoo Dev: Fetch
- Odoo Dev: Create
- Odoo Dev: Fetch/Create
- Odoo Dev: Delete / Odoo Dev: Remove
- Odoo Dev: Checkout / Odoo Dev: Select
- Odoo Dev: Fetch Stable
- Odoo Dev: Reset Active Branch

**Starting/Debugging**

- Odoo Dev: Config File
- Odoo Dev: Start Fresh Server
- Odoo Dev: Start Server
- Odoo Dev: Debug Server
- Odoo Dev: Start Server With Install...
- Odoo Dev: Debug Server With Install...
- Odoo Dev: Start Server With Update...
- Odoo Dev: Debug Server With Update...
- Odoo Dev: Stop Active Server
- Odoo Dev: Open Chrome (Debug)

**Useful Links**

- Odoo Dev: Pull Request (odoo)
- Odoo Dev: Pull Request (enterprise)
- Odoo Dev: Pull Request (upgrade)
- Odoo Dev: Runbot

**Misc**

- Odoo Dev: Drop Active DB
- Odoo Dev: Get Test Tag
- Odoo Dev: Open Chrome
- Odoo Dev: Linked Note
- Odoo Dev: Is Addon Dependent On?
- Odoo Dev: Copy Branch Name

## Known Limitations

- Doesn't support workflows that utilize worktrees.
- It can only recognize `odoo`, `enterprise` and `upgrade`.
  - Would be nice to support repositories for custom addons.

## Questions you might ask (FAQ)

- Why is the `Odoo Dev: Start Server` command not using the correct python
  interpreter?
  - Run the command `Python: Select Interpreter` to specify the python
    interpeter that will be used in your current workspace.
- Why did you waste your time on this?
  - I don't know. Perhaps I just want to learn more about VS Code extension
    creation.

## Release Notes

### 0.1.0

- initial release

### 0.1.1

- fix: use user's python selection
- fix: always show the branches

### 0.1.2

- imp: remove sourceFolder config and infer from loaded repositories
- imp: use vscode icons instead of custom

### 0.1.3

- fix: update readme

### 0.1.4

- imp: rebase active branch command
- imp: fetch based on fork name

### 0.1.5

- fix: look for the correct remote
- fix: do not assume origin as the main remote
- imp: start server button at status bar

### 0.1.6

- start/debug odoo shell
- ask user to locate config file

### 0.1.8

- no more active branch state
- take into account repositories of custom addons
  - enterprise repo can be thought as one of them

### 0.1.9

- fix debugging chrome
  - issue because of incorrect source map path overrides
