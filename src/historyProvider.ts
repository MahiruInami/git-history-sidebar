import * as vscode from 'vscode';
import * as path from 'path';
import { GitService } from './gitService';
import { CommitItem, FolderItem, FileItem, LoadMoreItem, EmptyStateItem, BackButtonItem, FoldAllButtonItem, UnfoldAllButtonItem, CommitData, FileStatus } from './treeItems';

export class GitHistoryProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> =
    new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private currentFilePath: string | undefined;
  private loadedCommits: Map<string, CommitData[]> = new Map();
  private currentPage: Map<string, number> = new Map();
  private commitFiles: Map<string, Map<string, vscode.TreeItem[]>> = new Map(); // commitHash -> folderPath -> items
  private focusedCommitHash: string | undefined;
  private allFoldersExpanded: boolean = false;
  private manualFoldState: 'folded' | 'unfolded' | 'auto' = 'auto';

  constructor(private gitService: GitService) {
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) {
        this.handleEditorChange(editor);
      }
    });

    if (vscode.window.activeTextEditor) {
      this.handleEditorChange(vscode.window.activeTextEditor);
    }
  }

  private handleEditorChange(editor: vscode.TextEditor): void {
    const filePath = editor.document.fileName;
    const uri = editor.document.uri;
    
    // Don't change view if we're viewing a diff from git-history scheme
    if (uri.scheme === 'git-history' || filePath.includes('git-history')) {
      return;
    }
    
    // Don't change view if we're viewing a diff editor
    if (uri.scheme === 'diff') {
      return;
    }
    
    // If we have a focused commit, only clear it when user switches to a completely different file
    if (this.focusedCommitHash && filePath !== this.currentFilePath) {
      this.focusedCommitHash = undefined;
    }
    
    this.setCurrentFile(filePath);
  }

  private setCurrentFile(filePath: string): void {
    if (filePath !== this.currentFilePath) {
      this.currentFilePath = filePath;
      this.loadedCommits.delete(filePath);
      this.currentPage.set(filePath, 0);
      this.commitFiles.clear();
      this.refresh();
    }
  }

  setFocusedCommit(commitHash: string): void {
    this.focusedCommitHash = commitHash;
    this.refresh();
  }

  clearFocusedCommit(): void {
    this.focusedCommitHash = undefined;
    this.allFoldersExpanded = false;
    this.manualFoldState = 'auto';
    this.refresh();
  }

  foldAll(): void {
    console.log('Folding all folders');
    this.manualFoldState = 'folded';
    this.allFoldersExpanded = false;
    // Clear the cached tree so it rebuilds with collapsed folders
    if (this.focusedCommitHash) {
      console.log('Clearing cache for commit:', this.focusedCommitHash);
      this.commitFiles.delete(this.focusedCommitHash);
    }
    this.refresh();
  }

  unfoldAll(): void {
    console.log('Unfolding all folders');
    this.manualFoldState = 'unfolded';
    this.allFoldersExpanded = true;
    // Clear the cached tree so it rebuilds with expanded folders
    if (this.focusedCommitHash) {
      console.log('Clearing cache for commit:', this.focusedCommitHash);
      this.commitFiles.delete(this.focusedCommitHash);
    }
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!this.gitService.isValidRepo()) {
      return [new EmptyStateItem('Not a git repository')];
    }

    if (!this.currentFilePath) {
      return [new EmptyStateItem('Open a file to see git history')];
    }

    // If we're focused on a specific commit, show only that commit's files
    if (this.focusedCommitHash && !element) {
      const files = await this.getFilesForCommit(this.focusedCommitHash);
      return [new BackButtonItem(), ...files];
    }

    if (!element) {
      return this.getCommitsForFile(this.currentFilePath);
    }

    if (element instanceof CommitItem) {
      return this.getFilesForCommit(element.commit.hash);
    }

    if (element instanceof FolderItem) {
      // Return cached children for this folder
      const commitHash = this.findCommitHashForFolder(element);
      if (commitHash) {
        const folders = this.commitFiles.get(commitHash);
        if (folders) {
          return folders.get(element.folderPath) || [];
        }
      }
    }

    return [];
  }

  private async getCommitsForFile(filePath: string): Promise<vscode.TreeItem[]> {
    const page = this.currentPage.get(filePath) || 0;
    let commits = this.loadedCommits.get(filePath);

    if (!commits) {
      commits = await this.gitService.getLog(filePath, 0);
      this.loadedCommits.set(filePath, commits);
      this.currentPage.set(filePath, 0);
    }

    if (commits.length === 0) {
      return [new EmptyStateItem('No history found for this file')];
    }

    const items: vscode.TreeItem[] = commits.map(commit =>
      new CommitItem(commit, filePath)
    );

    if (commits.length === 50 * (page + 1)) {
      items.push(new LoadMoreItem(filePath, page + 1));
    }

    return items;
  }

  private async getFilesForCommit(commitHash: string): Promise<vscode.TreeItem[]> {
    console.log('Getting files for commit:', commitHash, 'allFoldersExpanded:', this.allFoldersExpanded, 'manualFoldState:', this.manualFoldState);
    
    // Always rebuild tree when in manual fold state to ensure proper expansion
    const shouldRebuild = !this.commitFiles.has(commitHash) || this.manualFoldState !== 'auto';
    
    if (!shouldRebuild) {
      console.log('Using cached tree');
      const rootFolders = this.commitFiles.get(commitHash)!;
      return rootFolders.get('') || [];
    }

    console.log('Building new tree');
    const files = await this.gitService.getChangedFiles(commitHash, this.currentFilePath);
    const tree = this.buildFileTree(files, commitHash);
    this.commitFiles.set(commitHash, tree);
    
    // Handle folder expansion based on manual fold state
    if (this.manualFoldState === 'unfolded') {
      // All folders already expanded by buildFileTree, nothing to do
      console.log('All folders expanded');
    } else if (this.manualFoldState === 'folded') {
      // All folders collapsed by buildFileTree, nothing to do
      console.log('All folders collapsed');
    } else {
      // Auto mode: expand path to current file
      console.log('Expanding to current file (auto mode)');
      this.expandFoldersToCurrentFile(tree, commitHash);
    }
    
    return tree.get('') || [];
  }

  private expandFoldersToCurrentFile(tree: Map<string, vscode.TreeItem[]>, commitHash: string): void {
    if (!this.currentFilePath) {
      return;
    }
    
    // Get relative path of current file from the appropriate repo
    const repo = this.gitService['getRepoForFile'](this.currentFilePath);
    const relativePath = repo 
      ? this.gitService['getRelativePathForRepo'](this.currentFilePath, repo.root)
      : this.currentFilePath;
    
    // Find which file in the tree matches the current file
    let currentFile: FileItem | undefined;
    for (const [folderPath, items] of tree.entries()) {
      for (const item of items) {
        if (item instanceof FileItem && item.filePath === relativePath) {
          currentFile = item;
          break;
        }
      }
      if (currentFile) {
        break;
      }
    }
    
    if (!currentFile) {
      return;
    }
    
    // Expand all parent folders
    const parts = relativePath.split(/[\\/]/);
    let currentFolderPath = '';
    
    for (let i = 0; i < parts.length - 1; i++) {
      const folderName = parts[i];
      currentFolderPath = currentFolderPath ? `${currentFolderPath}/${folderName}` : folderName;
      
      // Find and expand this folder
      for (const [parentPath, items] of tree.entries()) {
        for (let j = 0; j < items.length; j++) {
          const item = items[j];
          if (item instanceof FolderItem && item.folderPath === currentFolderPath) {
            // Create new expanded folder
            const expandedFolder = new FolderItem(folderName, currentFolderPath, vscode.TreeItemCollapsibleState.Expanded);
            items[j] = expandedFolder;
          }
        }
      }
    }
  }

  private buildFileTree(files: {path: string; status: 'added' | 'modified' | 'deleted' | 'unchanged'}[], commitHash: string): Map<string, vscode.TreeItem[]> {
    const tree = new Map<string, vscode.TreeItem[]>();
    const folderMap = new Map<string, FolderItem>();

    // Sort files by path
    files.sort((a, b) => a.path.localeCompare(b.path));

    for (const fileInfo of files) {
      const filePath = fileInfo.path;
      const parts = filePath.split(/[\\/]/);
      let currentPath = '';

      // Build folder hierarchy
      for (let i = 0; i < parts.length - 1; i++) {
        const folderName = parts[i];
        const parentPath = currentPath;
        currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;

        if (!folderMap.has(currentPath)) {
          const collapsibleState = this.allFoldersExpanded 
            ? vscode.TreeItemCollapsibleState.Expanded 
            : vscode.TreeItemCollapsibleState.Collapsed;
          const folder = new FolderItem(folderName, currentPath, collapsibleState);
          folderMap.set(currentPath, folder);

          // Add to parent's children
          const parentChildren = tree.get(parentPath) || [];
          parentChildren.push(folder);
          tree.set(parentPath, parentChildren);
        }
      }

      // Add file to its parent folder
      const fileName = parts[parts.length - 1];
      const isCurrentFile = this.currentFilePath === filePath || 
                           this.currentFilePath?.endsWith(filePath) ||
                           filePath.endsWith(path.basename(this.currentFilePath || ''));
      
      const file = new FileItem(fileName, commitHash, filePath, isCurrentFile, fileInfo.status);
      const parentPath = currentPath;
      
      const parentChildren = tree.get(parentPath) || [];
      parentChildren.push(file);
      tree.set(parentPath, parentChildren);
    }

    // Sort each folder's children: folders first, then files, both alphabetically
    for (const [folderPath, items] of tree.entries()) {
      items.sort((a, b) => {
        const aIsFolder = a instanceof FolderItem;
        const bIsFolder = b instanceof FolderItem;
        
        if (aIsFolder && !bIsFolder) {
          return -1;
        }
        if (!aIsFolder && bIsFolder) {
          return 1;
        }
        
        return a.label!.toString().localeCompare(b.label!.toString());
      });
    }

    return tree;
  }

  private findCommitHashForFolder(folder: FolderItem): string | undefined {
    for (const [commitHash, folders] of this.commitFiles.entries()) {
      for (const [folderPath, items] of folders.entries()) {
        if (items.includes(folder)) {
          return commitHash;
        }
      }
    }
    return undefined;
  }

  async loadMore(filePath: string, page: number): Promise<void> {
    const newCommits = await this.gitService.getLog(filePath, page);
    const existingCommits = this.loadedCommits.get(filePath) || [];
    this.loadedCommits.set(filePath, [...existingCommits, ...newCommits]);
    this.currentPage.set(filePath, page);
    this.refresh();
  }
}
