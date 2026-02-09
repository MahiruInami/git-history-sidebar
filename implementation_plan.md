There are list of features:

1\. Extension button on side panel

2\. When user clicks it shows it own side panel on the left.

3\. Side panel shows history of changes for current file with commit comment.

4\. When user clicks on commit it shows list of files that were changes in that commit and opens current file diff for that commit.

# Implementation Plan: Git History & Diff Extension

## Phase 1: Scaffolding

- [ ] **Install Dependencies**

- [ ] Install `simple-git` for handling Git commands easily.

  - `npm install simple-git`

- [ ] **Asset Preparation**

- [ ] Create an `images` folder.

  - Add an SVG icon for the Activity Bar button (e.g., `git-icon.svg`).

## Phase 2: Manifest Configuration (`package.json`)

- [ ] **Define View Container (Side Panel Button)**

- [ ] Add `contributes.viewsContainers`.

  - Set `activitybar` location.
  - Define `id`, `title`, and `icon`.

- [ ] **Define View (The Sidebar Content)**

- [ ] Add `contributes.views`.

  - Map the view to the `id` defined in the View Container.
  - Set the view type to `tree` (we will use a `TreeDataProvider`).

- [ ] **Define Commands**

- [ ] `gitHistory.refresh`: To manually reload history.

  - `gitHistory.viewDiff`: Internal command to open the diff view.

## Phase 3: Core Logic - Git Service

- [ ] **Create** `GitService` Class

- [ ] Initialize `simple-git` instance based on the current workspace folder.

- [ ] \*\*Implement `getLog(filePath: string)**`

- [ ] Use `git log` to fetch history for the specific file.

  - Return an array of objects containing: `hash`, `date`, `message`, `author`.

- [ ] \*\*Implement `getChangedFiles(commitHash: string)**`

- [ ] Use `git show --name-only` (or similar) to get the list of files modified in that commit.

- [ ] \*\*Implement `getFileContent(commitHash: string, filePath: string)**`

- [ ] Use `git show hash:path` to retrieve the content of a file at a specific commit (needed for the left side of the Diff view).

## Phase 4: UI Implementation - Tree Data Provider

- [ ] **Create** `GitHistoryProvider` Class

- [ ] Implement `vscode.TreeDataProvider`.

- [ ] **Define Tree Items**

- [ ] **CommitItem**: Represents a specific commit.

  - `label`: Commit message.
  - `description`: Author & relative time.
  - `collapsibleState`: `Collapsed` (to show files inside).
  - `contextValue`: `'commit'`.
  - **FileItem**: Represents a file changed in that commit.
  - `label`: Filename.
  - `command`: Triggers `gitHistory.viewDiff`.
  - `collapsibleState`: `None`.

- [ ] \*\*Implement `getChildren(element?)**`

- [ ] **If** `element` is undefined: Call `GitService.getLog` for the *currently active editor's file*. Return `CommitItem`s.

  - **If** `element` is a Commit: Call `GitService.getChangedFiles`. Return `FileItem`s.

## Phase 5: Interaction Logic & Diff View

- [ ] **Register the Provider**

- [ ] In `extension.ts`, register `GitHistoryProvider` with `window.registerTreeDataProvider`.

- [ ] **Handle Active Editor Changes**

- [ ] Listen to `window.onDidChangeActiveTextEditor`.

  - When the user switches files, trigger the provider to refresh so the sidebar updates to the new file's history.

- [ ] **Implement Diff Logic (**`gitHistory.viewDiff`)

- [ ] This command is triggered when a user clicks a `FileItem`.

  - **Step 1**: Get the content of the file from the *previous* commit (or the specific commit selected) using `GitService`.
  - **Step 2**: Create a `vscode.Uri` scheme (e.g., `git-history://...`) or write to a temp file to provide the "Original" content.
  - **Step 3**: Execute `vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title)`.
  - `leftUri`: The readonly version from the specific commit.
  - `rightUri`: The current file on disk (or the file at the specific commit, depending on desired behavior).

## Phase 6: Polish & Edge Cases

- [ ] **Handling Non-Git Workspaces**

- [ ] Add checks to ensure the workspace is a valid git repo. Show a message if not.

- [ ] **Handling File Renames**

- [ ] Ensure `git log --follow` is used if tracking history across renames is desired.

- [ ] **Empty States**

- [ ] If no file is open, show a "Open a file to see git history" message in the tree view (return a generic `TreeItem`).

- [ ] **Loading States**

- [ ] Show a "Loading..." item while fetching git logs to prevent UI freezing.

---

### Suggested File Structure

```text
src/
├── extension.ts          # Entry point, registers provider & commands
├── gitService.ts         # Wrapper for simple-git
├── historyProvider.ts    # TreeDataProvider implementation
├── treeItems.ts          # Custom TreeItem classes (CommitItem, FileItem)
└── utils.ts              # Helper functions (date formatting, etc.)
```