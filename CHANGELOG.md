# Change Log

## [0.0.5] - 2026-02-15

### Added

- Age-based background color for blame annotations (green for newest commits, dark red for oldest)
- Configuration options for blame background colors (`blameBackgroundEnabled`, `blameNewestColor`, `blameOldestColor`)

### Fixed

- Bug where author name showed as "Unknown" for the first line of each commit in blame view

## [0.0.4] - 2026-02-14

### Added

- Git Blame functionality with toggle support and configuration options
- Command to copy commit SHA from blame annotations
- Command to retrieve GitHub remote URL from blame
- View commit files directly from blame annotations

### Changed

- Enhanced GitService and GitHistoryProvider to support submodules
- Improved file path handling for better compatibility
- Updated git icon SVG for improved visual representation
- Added file status indicators to README

## \[0.0.3\] - 2026-02-14

### Added

- MIT License
- Command to copy commit SHA from history view
- View changed files for any commit
- Back navigation from commit details to history

### Changed

- Updated README with features and usage instructions

## \[0.0.2\] - 2026-02-14

### Added

- Load more commits functionality
- Refresh command for history view
- View diff command for commits

## \[0.0.1\] - 2026-02-14

### Added

- Initial release
- Git History sidebar view
- Display file commit history in sidebar
- Basic diff viewing functionality