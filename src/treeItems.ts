import * as vscode from 'vscode';
import * as path from 'path';

export interface CommitData {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export class CommitItem extends vscode.TreeItem {
  constructor(
    public readonly commit: CommitData,
    public readonly filePath: string
  ) {
    const maxLength = 60;
    const displayMessage = commit.message.length > maxLength
      ? commit.message.substring(0, maxLength) + '...'
      : commit.message;

    super(displayMessage, vscode.TreeItemCollapsibleState.None);

    this.description = `${commit.author} • ${formatRelativeTime(commit.date)}`;
    this.tooltip = `${commit.message}\n\nAuthor: ${commit.author}\nDate: ${commit.date}\nHash: ${commit.hash}`;
    this.contextValue = 'commit';
    this.iconPath = new vscode.ThemeIcon('git-commit');

    // Clicking on commit only shows diff for current file, doesn't change sidebar view
    this.command = {
      command: 'gitHistory.viewDiff',
      title: 'View Diff',
      arguments: [commit.hash, filePath]
    };
  }
}

export class FolderItem extends vscode.TreeItem {
  constructor(
    public readonly folderName: string,
    public readonly folderPath: string,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed
  ) {
    super(folderName, collapsibleState);
    this.contextValue = 'folder';
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

export type FileStatus = 'modified' | 'added' | 'deleted' | 'unchanged';

export class FileItem extends vscode.TreeItem {
  constructor(
    public readonly fileName: string,
    public readonly commitHash: string,
    public readonly filePath: string,
    public readonly isCurrentFile: boolean = false,
    public readonly status: FileStatus = 'modified'
  ) {
    super(fileName, vscode.TreeItemCollapsibleState.None);

    this.tooltip = `View diff for ${filePath}`;
    this.contextValue = isCurrentFile ? 'currentFile' : 'file';
    
    // Set icon and color based on status
    let iconColor: vscode.ThemeColor | undefined;
    let iconName = 'file';
    
    switch (status) {
      case 'added':
        iconColor = new vscode.ThemeColor('gitDecoration.addedResourceForeground');
        iconName = 'file-add';
        break;
      case 'deleted':
        iconColor = new vscode.ThemeColor('gitDecoration.deletedResourceForeground');
        iconName = 'file-remove';
        break;
      case 'modified':
        iconColor = new vscode.ThemeColor('gitDecoration.modifiedResourceForeground');
        break;
      default:
        iconColor = undefined;
    }
    
    // Highlight current file with a different icon and color
    if (isCurrentFile) {
      this.iconPath = new vscode.ThemeIcon(iconName, new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
      this.label = `${fileName} (current)`;
    } else {
      this.iconPath = new vscode.ThemeIcon(iconName, iconColor);
    }

    this.command = {
      command: 'gitHistory.viewDiff',
      title: 'View Diff',
      arguments: [commitHash, filePath]
    };
  }
}

export class LoadMoreItem extends vscode.TreeItem {
  constructor(
    public readonly filePath: string,
    public readonly nextPage: number
  ) {
    super('Load more commits...', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('refresh');
    this.command = {
      command: 'gitHistory.loadMore',
      title: 'Load More',
      arguments: [filePath, nextPage]
    };
  }
}

export class EmptyStateItem extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

export class BackButtonItem extends vscode.TreeItem {
  constructor() {
    super('← Back to commit history', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('arrow-left');
    this.command = {
      command: 'gitHistory.backToHistory',
      title: 'Back to History'
    };
  }
}

export class FoldAllButtonItem extends vscode.TreeItem {
  constructor() {
    super('Fold all', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('collapse-all');
    this.command = {
      command: 'gitHistory.foldAll',
      title: 'Fold All'
    };
  }
}

export class UnfoldAllButtonItem extends vscode.TreeItem {
  constructor() {
    super('Unfold all', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('expand-all');
    this.command = {
      command: 'gitHistory.unfoldAll',
      title: 'Unfold All'
    };
  }
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) {return 'just now';}
  if (diffMins < 60) {return `${diffMins}m ago`;}
  if (diffHours < 24) {return `${diffHours}h ago`;}
  if (diffDays < 30) {return `${diffDays}d ago`;}
  return date.toLocaleDateString();
}
