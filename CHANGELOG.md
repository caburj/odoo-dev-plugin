# Change Log

All notable changes to the "odoo-dev-plugin" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.1.19] - 2023-11-09

### Added

- Status bar item to toggle with/without demo when starting instances.

## [0.1.18]

### Added

- Log debug session configuration in the output.

## [0.1.17]

### Added

- Simplier object when python debugging.

## [0.1.16]

### Added

- Allow deleting merged branches.

## [0.1.15]

### Added
- Ask to checkout if branch to fetch is already present.

## [0.1.14]

### Fixed

- Better default shortcuts.

### Added

- Push active branch command.

## [0.1.13]

### Added

- Default keyboad shortcuts.
- Opening pr links will ask for branch if not selected.

## [0.1.12]

### Fixed

- Limit db name to 63 characters.
- When no selected addons, don't append `-i <addon>` when starting server.

## [0.1.11]

### Fixed

- cd to the odoo repo before running command.

### Added

- 'Go to test method' command.
- Description of commands in readme.

## [0.1.9]

### Fixed

- Issue when debugging in chrome.

## [0.1.8]

### Removed

- No more active branch state.

### Added

- Take into account repositories of custom addons.
  - Enterprise repo can be thought as one of them.

## [0.1.6]

### Added

- Start/debug odoo shell commands.
- Ask user to locate config file.

## [0.1.5]

### Fixed

- Look for the correct remote.
- Do not assume origin as the main remote.

### Added

- Start server button at status bar.

## [0.1.4]

### Added

- Rebase active branch command.
- Fetch based on fork name.

## [0.1.3]

### Added

- Update readme.

## [0.1.2]

### Added

- Remove sourceFolder config and infer from loaded repositories.
- Use vscode icons instead of custom.

## [0.1.1]

### Fixed

- Use user's python selection.
- Always show the branches.

## [0.1.0]

- Initial release.
