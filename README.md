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

### Settings

| Setting Name               | Technical Name             | Description                                                                                                                                                |
| -------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config Path                | `odooDev.odooConfigPath`   | Path to the odoo config file. If not set, the user will be prompted to locate it.                                                                          |
| Notes Folder               | `odooDev.notesFolder`      | Path to the folder where the notes are stored. If not set, the user will be prompted to locate the folder.                                                 |
| Auto Stash                 | `odooDev.autoStash`        | Automatically stash changes before switching branch.                                                                                                       |
| Auto Test                  | `odooDev.autoTest`         | Automatically start the server with `--test-enable` option when the cursor is in a test file. `--test-tags` will be computed based on where the cursor is. |
| Branch Name as DB          | `odooDev.branchNameAsDB`   | Use the branch name as the database name when starting the server. This overrides the db specified in the config file.                                     |
| Pull Base Branch on Create | `odooDev.pullBaseOnCreate` | Pull the base branch first before creating the new branch.                                                                                                 |

### Commands

**Management of dev branches**

The following commands, when executed, are applied to each repository that are
loaded in the workspace.

| Command                 | Description                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Odoo Dev: Create        | Creates the branch using the provided name and checks out to it.                                                                                        |
| Odoo Dev: Fetch         | Fetches remotely the given branch name (will check each remove from the git config) and checks out to it.                                               |
| Odoo Dev: Fetch/Create  | Does `Odoo Dev: Fetch` and if unsuccessful, falls back to `Odoo Dev: Create`.                                                                           |
| Odoo Dev: Delete        | Deletes branch of the given name.                                                                                                                       |
| Odoo Dev: Checkout      | Checks out to the given branch.                                                                                                                         |
| Odoo Dev: Fetch Stable  | Fetches the given stable branch from the official odoo repositories.                                                                                    |
| Odoo Dev: Reset Active  | Fetches the latest version of the active branch from remote and resets the local.                                                                       |
| Odoo Dev: Rebase Active | Fetches the latest version of the active branch's base and rebases the active branch on that updated base. Any conflict should be resolved by the user. |
| Odoo Dev: Select        | Alias for `Odoo Dev: Checkout`                                                                                                                          |
| Odoo Dev: Remove        | Alias for `Odoo Dev: Delete`                                                                                                                            |

**Start server / Debug**

The following commands relies on the `Config Path` setting. If the setting is
not set, the user will be prompted to locate the config file.

| Command                             | Description                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| Odoo Dev: Open Config               | Opens an editor showing the odoo config that will be used when starting the server. |
| Odoo Dev: Start Fresh Server        | Drops the db and starts the server install option using the user-selected addons.   |
| Odoo Dev: Start Server              | Starts the server.                                                                  |
| Odoo Dev: Start Server With Install | Starts the server with install option using the user-selected addons.               |
| Odoo Dev: Start Server With Update  | Starts the server with update option using the user-selected addons.                |

It's possible to start the server where you can put breakpoints in the python
code and VS Code will stop at the breakpoint when reached. Normally, to achieve
this, you'll need a launch configuration. However, the plugin can automatically
generate the launch configuration needed to start the server in debug mode.

| Command                             | Description                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| Odoo Dev: Debug Server              | Starts the server in debug mode.                                                    |
| Odoo Dev: Debug Server With Install | Starts the server in debug mode with install option using the user-selected addons. |
| Odoo Dev: Debug Server With Update  | Starts the server in debug mode with update option using the user-selected addons.  |

NOTE: When `odooDev.autoTest` is enabled, and the cursor is in a test file, the
server will be started with `--test-enable` option. `--test-tag` option will be
added if the cursor is in a test method/class.

**Open Chrome**

| Command                       | Description                                                                                                                                                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Odoo Dev: Open Chrome         | Opens chrome browser automatically navigating to the homepage of the server. Note that the ip of the device is taken into account so that it's already compatible to IoT Box. For example, it automatically navigates to `http://192.12.44.1:8069`. |
| Odoo Dev: Open Chrome (Debug) | Does `Odoo Dev: Open Chrome` in debug mode. This allows the user to debug JS code from the editor.                                                                                                                                                  |

**Useful Links**

Opens the default browser to some useful links related to the selected (or active) branch.

| Command                             | Description                                                     |
| ----------------------------------- | --------------------------------------------------------------- |
| Odoo Dev: Pull Request (odoo)       | Opens the pull request page made for the odoo repository.       |
| Odoo Dev: Pull Request (enterprise) | Opens the pull request page made for the enterprise repository. |
| Odoo Dev: Pull Request (upgrade)    | Opens the pull request page made for the upgrade repository.    |
| Odoo Dev: Runbot                    | Opens the runbot page.                                          |

**Misc**

Some commands that maybe useful.

| Command                          | Description                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Odoo Dev: Go To Test Method      | Given the test method name, the plugin will search for it and opens the test file with cursor highlighting the found test method.                |
| Odoo Dev: Linked Note            | Opens the linked note to the selected branch.                                                                                                    |
| Odoo Dev: Is Addon Dependent On? | User will be asked to select an addon, followed by another addon. Then the command will tell whether the first addon is dependent on the second. |
| Odoo Dev: Copy Branch Name       | Copies the branch name of the active branch.                                                                                                     |
| Odoo Dev: Stop Active Server     | Stops the active server.                                                                                                                         |
| Odoo Dev: Drop Active DB         | Drops the active db.                                                                                                                             |
| Odoo Dev: Get Test Tag           | Gets the test tag of the current cursor position.                                                                                                |

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

### 0.1.11

- cd to the odoo repo before running command
- go to test method command
- description of commands in readme

### 0.1.12

- fix: limit db name to 63 characters
- fix: when no selected addons, don't append `-i <addon>` when starting server
