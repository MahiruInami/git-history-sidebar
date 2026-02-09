# Git History Sidebar

A VSCode extension that displays git commit history for the current file in a dedicated sidebar panel, with easy navigation through commits and changed files.

## Features

- **Commit History Sidebar**: View all commits that modified the current file directly in a sidebar panel
- **Quick Diff View**: Click any commit to see what changed in that file for that specific commit
- **Changed Files Browser**: View all files modified in a commit with folder tree structure
- **Current File Highlighting**: Automatically highlights and expands to the current file in the changed files view
- **One-Click Actions**:
  - Copy commit SHA to clipboard
  - View all changed files in a commit
  - Navigate back to commit history
- **Pagination**: Load more commits as needed (50 at a time)
- **Auto-refresh**: Sidebar updates automatically when you switch files or git operations occur

## How to Use

1. **Open the Sidebar**: Click the Git History icon in the Activity Bar (left side of VSCode)
2. **View Commit History**: Open any file in your git repository to see its commit history
3. **View Diff**: Click on any commit to see the diff for the current file
4. **Browse Changed Files**: Click the folder icon (📁) on a commit to see all files changed in that commit
5. **Copy SHA**: Click the clipboard icon (📋) to copy the commit SHA
6. **Navigate**: Use the "← Back to commit history" button to return to the commit list

## Requirements

- VSCode 1.108.0 or higher
- Git repository (workspace must be initialized with git)
- Node.js dependencies (installed automatically):
  - `simple-git`: For git operations

## Extension Settings

This extension currently does not add any VS Code settings.

## Known Issues

- The fold/unfold all buttons for the file tree are not available due to VSCode TreeView API limitations. Use the built-in "Collapse All" button in the view title or manually expand/collapse folders.

## Release Notes

### 1.0.0

Initial release with core features:

- Commit history sidebar for current file
- Diff view between commit and parent
- Changed files browser with folder tree
- File status indicators (added/modified/deleted)
- Current file highlighting
- Copy commit SHA functionality
- Pagination support
- Auto-refresh on file changes and git operations

---

## Development

### Building

```bash
npm install
npm run compile
```

### Testing

Press `F5` to open a new VSCode window with the extension loaded.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT