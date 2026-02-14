import * as vscode from 'vscode';
import * as path from 'path';
import { GitService } from './gitService';
import { GitHistoryProvider } from './historyProvider';
import { GitHistoryContentProvider } from './contentProvider';
import { GitWatcher } from './gitWatcher';
import { GitBlameProvider } from './blameProvider';

let gitService: GitService | undefined;
let historyProvider: GitHistoryProvider | undefined;
let blameProvider: GitBlameProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log('Git History Sidebar extension is now active!');

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  
  if (workspaceRoot) {
    gitService = new GitService(workspaceRoot);
    
    // Initialize asynchronously
    (async () => {
      const isValid = await gitService!.isValidRepo();
      
      if (isValid) {
        historyProvider = new GitHistoryProvider(gitService!);

        const treeView = vscode.window.createTreeView('gitHistoryView', {
          treeDataProvider: historyProvider,
          showCollapseAll: true
        });

        const contentProvider = new GitHistoryContentProvider(gitService!);
        context.subscriptions.push(
          vscode.workspace.registerTextDocumentContentProvider('git-history', contentProvider)
        );

        // Initialize blame provider
        console.log('[GitHistory] Initializing blame provider...');
        blameProvider = new GitBlameProvider(gitService!);
        context.subscriptions.push({ dispose: () => blameProvider?.dispose() });
        console.log('[GitHistory] Blame provider initialized');

        const gitWatcher = new GitWatcher(workspaceRoot, () => {
          gitService?.invalidateCache();
          historyProvider?.refresh();
        });

        context.subscriptions.push(treeView);
        context.subscriptions.push({ dispose: () => gitWatcher.dispose() });
      } else {
        console.log('Not a git repository');
      }
    })();
  } else {
    console.log('No workspace folder found');
  }

  // Register commands regardless of initialization state
  context.subscriptions.push(
    vscode.commands.registerCommand('gitHistory.refresh', () => {
      if (gitService && historyProvider) {
        gitService.invalidateCache();
        historyProvider.refresh();
      } else {
        vscode.window.showWarningMessage('Git History: No workspace or not a git repository');
      }
    }),

    vscode.commands.registerCommand('gitHistory.viewDiff', async (commitHash: string, filePath: string) => {
      if (!gitService || !workspaceRoot) {
        vscode.window.showWarningMessage('Git History: No workspace or not a git repository');
        return;
      }
      
      try {
        const parentHash = await gitService.getParentCommit(commitHash, filePath);

        if (!parentHash) {
          vscode.window.showInformationMessage('This is the first commit');
          return;
        }

        // DON'T change sidebar view - just show the diff
        // Compare parent commit with current commit (not with file on disk)
        const leftUri = vscode.Uri.parse(`git-history://${parentHash}/${filePath}`);
        const rightUri = vscode.Uri.parse(`git-history://${commitHash}/${filePath}`);

        await vscode.commands.executeCommand('vscode.diff',
          leftUri,
          rightUri,
          `${path.basename(filePath)} (${commitHash.substring(0, 7)})`,
          { preview: true }
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Error opening diff: ${error}`);
      }
    }),

    vscode.commands.registerCommand('gitHistory.loadMore', async (filePath: string, page: number) => {
      if (historyProvider) {
        await historyProvider.loadMore(filePath, page);
      } else {
        vscode.window.showWarningMessage('Git History: No workspace or not a git repository');
      }
    }),

    vscode.commands.registerCommand('gitHistory.backToHistory', () => {
      historyProvider?.clearFocusedCommit();
    }),

    vscode.commands.registerCommand('gitHistory.viewCommitFiles', async (item: any) => {
      if (!gitService) {
        vscode.window.showWarningMessage('Git History: No workspace or not a git repository');
        return;
      }
      
      // Extract commit hash from the TreeItem
      let commitHash: string;
      if (typeof item === 'string') {
        commitHash = item;
      } else if (item && item.commit && item.commit.hash) {
        commitHash = item.commit.hash;
      } else {
        console.error('Invalid item passed to viewCommitFiles:', item);
        return;
      }
      
      // Set the focused commit so sidebar shows all files from this commit
      historyProvider?.setFocusedCommit(commitHash);
    }),

    vscode.commands.registerCommand('gitHistory.copyCommitSha', async (item: any) => {
      // Extract commit hash from the TreeItem
      let commitHash: string;
      if (typeof item === 'string') {
        commitHash = item;
      } else if (item && item.commit && item.commit.hash) {
        commitHash = item.commit.hash;
      } else {
        console.error('Invalid item passed to copyCommitSha:', item);
        return;
      }
      
      // Copy to clipboard
      await vscode.env.clipboard.writeText(commitHash);
      vscode.window.showInformationMessage(`Copied commit SHA: ${commitHash.substring(0, 7)}`);
    }),

    vscode.commands.registerCommand('gitHistory.toggleBlame', async () => {
      console.log('[GitHistory] Toggle command triggered');
      if (blameProvider) {
        console.log('[GitHistory] Blame provider exists, calling toggle');
        await blameProvider.toggle();
        console.log('[GitHistory] Toggle completed');
      } else {
        console.log('[GitHistory] Blame provider not initialized');
        vscode.window.showWarningMessage('Git History: Blame provider not initialized');
      }
    }),

    vscode.commands.registerCommand('gitHistory.copyCommitShaFromBlame', async (commitHash: string) => {
      if (!commitHash) {
        return;
      }
      
      // Copy to clipboard
      await vscode.env.clipboard.writeText(commitHash);
      vscode.window.showInformationMessage(`Copied commit SHA: ${commitHash.substring(0, 7)}`);
    }),

  );
}

export function deactivate() {}
