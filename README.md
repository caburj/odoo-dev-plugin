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

- Open settings and search for "odoo dev".
  - Look for the `Source Folder` setting and specify the directory where `odoo`,
    `enterprise` and/or `upgrade` repositories are cloned.
  - Also look for `Odoo Config Path` setting to specify the path of the config
    file to use when starting the odoo server.
- Open command palette and type "odoo dev" to see the list of available
  commands.

## Recommendations

- Install [pydevd-odoo](https://github.com/odoo-ide/pydevd-odoo) for better
  display of the recordset objects during debugging.

## Contributions

### Settings

- Source Folder (`odooDev.sourceFolder`)
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

## Release Notes

### 0.1.0

Initial release.
