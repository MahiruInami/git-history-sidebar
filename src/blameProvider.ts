import * as vscode from 'vscode';
import { GitService, BlameLineInfo } from './gitService';

export class GitBlameProvider {
  private textDecorationType: vscode.TextEditorDecorationType;
  private hoverDecorationType: vscode.TextEditorDecorationType;
  private enabled: boolean = true;
  private currentEditor: vscode.TextEditor | undefined;
  private blameData: Map<string, BlameLineInfo[]> = new Map();

  constructor(private gitService: GitService) {
    // Decoration type for the visible text (no hover)
    this.textDecorationType = vscode.window.createTextEditorDecorationType({
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
      before: {
        color: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'),
        fontStyle: 'italic',
        fontWeight: 'normal',
        margin: '0 15px 0 0'
      }
    });

    // Decoration type for hover area (invisible, narrow range)
    this.hoverDecorationType = vscode.window.createTextEditorDecorationType({
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
      opacity: '0' // Invisible
    });

    // Listen for configuration changes
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('gitHistory.showBlame')) {
        this.updateEnabledState();
      }
    });

    // Listen for active editor changes
    vscode.window.onDidChangeActiveTextEditor(editor => {
      this.currentEditor = editor;
      if (editor && this.enabled) {
        this.showBlame(editor);
      }
    });

    // Listen for document changes (save)
    vscode.workspace.onDidSaveTextDocument(document => {
      const editor = vscode.window.visibleTextEditors.find(e => e.document === document);
      if (editor && this.enabled) {
        this.showBlame(editor);
      }
    });

    // Register command to view commit files from blame
    vscode.commands.registerCommand('gitHistory.viewBlameCommit', async (commitHash: string, filePath: string) => {
      if (!commitHash) {
        return;
      }
      
      // First, show the commit files in the sidebar
      await vscode.commands.executeCommand('gitHistory.viewCommitFiles', {
        commit: { hash: commitHash },
        filePath: filePath
      });
      
      // Then, open the diff for the current file
      await vscode.commands.executeCommand('gitHistory.viewDiff', commitHash, filePath);
    });

    // Initial state
    this.updateEnabledState();
    if (vscode.window.activeTextEditor && this.enabled) {
      this.currentEditor = vscode.window.activeTextEditor;
      this.showBlame(vscode.window.activeTextEditor);
    }
  }

  private updateEnabledState(): void {
    const config = vscode.workspace.getConfiguration('gitHistory');
    this.enabled = config.get('showBlame', true);
    
    if (!this.enabled) {
      this.clearBlame();
    } else if (this.currentEditor) {
      this.showBlame(this.currentEditor);
    }
  }

  async toggle(): Promise<void> {
    console.log('[GitHistory] Toggle blame called');
    const config = vscode.workspace.getConfiguration('gitHistory');
    this.enabled = !this.enabled;
    console.log(`[GitHistory] Blame enabled: ${this.enabled}`);
    
    await config.update('showBlame', this.enabled, true);
    console.log('[GitHistory] Config updated');
    
    if (this.enabled && this.currentEditor) {
      console.log('[GitHistory] Showing blame for current editor');
      await this.showBlame(this.currentEditor);
      console.log('[GitHistory] Blame display complete');
    } else {
      console.log('[GitHistory] Clearing blame');
      this.clearBlame();
    }
  }

  private clearBlame(): void {
    vscode.window.visibleTextEditors.forEach(editor => {
      editor.setDecorations(this.textDecorationType, []);
      editor.setDecorations(this.hoverDecorationType, []);
    });
    this.blameData.clear();
  }

  private async showBlame(editor: vscode.TextEditor): Promise<void> {
    console.log(`[GitHistory] showBlame called for: ${editor.document.fileName}`);
    const filePath = editor.document.fileName;
    const uri = editor.document.uri;
    
    if (uri.scheme !== 'file') {
      console.log('[GitHistory] Skipping - not a file scheme');
      return;
    }

    if (filePath.includes('git-history')) {
      console.log('[GitHistory] Skipping - git-history file');
      return;
    }

    try {
      console.log('[GitHistory] Fetching blame data...');
      const blameInfo = await this.gitService.getBlame(filePath);
      console.log(`[GitHistory] Got ${blameInfo?.length || 0} blame entries`);
      
      if (!blameInfo || blameInfo.length === 0) {
        console.log('[GitHistory] No blame data found');
        return;
      }

      // Get GitHub URL if available
      const githubUrl = await this.gitService.getGitHubRemoteUrl(filePath);

      // Clear existing decorations first
      editor.setDecorations(this.textDecorationType, []);
      editor.setDecorations(this.hoverDecorationType, []);
      console.log('[GitHistory] Cleared existing decorations');

      this.blameData.set(filePath, blameInfo);

      const textDecorations: vscode.DecorationOptions[] = [];
      const hoverDecorations: vscode.DecorationOptions[] = [];

      for (const lineInfo of blameInfo) {
        const lineIndex = lineInfo.lineNumber - 1;
        if (lineIndex < 0 || lineIndex >= editor.document.lineCount) {
          continue;
        }

        const line = editor.document.lineAt(lineIndex);
        const relativeTime = this.formatRelativeTime(lineInfo.date);
        const author = this.truncateAuthor(lineInfo.author, 12);
        const text = `${author} (${relativeTime})`;

        // Create hover message
        const hoverMessage = new vscode.MarkdownString();
        hoverMessage.appendMarkdown(`**${lineInfo.author}**  \n`);
        hoverMessage.appendMarkdown(`${lineInfo.summary}  \n`);
        hoverMessage.appendMarkdown(`\`\`\`\n${lineInfo.commitHash.substring(0, 7)}\n\`\`\`  \n\n`);
        hoverMessage.appendMarkdown(`[View Changed Files](command:gitHistory.viewBlameCommit?${encodeURIComponent(JSON.stringify([lineInfo.commitHash, filePath]))})`);
        hoverMessage.appendMarkdown(` | [Copy SHA](command:gitHistory.copyCommitShaFromBlame?${encodeURIComponent(JSON.stringify([lineInfo.commitHash]))})`);
        
        // Add GitHub link if available
        if (githubUrl) {
          const commitUrl = `${githubUrl}/commit/${lineInfo.commitHash}`;
          hoverMessage.appendMarkdown(`  \n[View on GitHub](${commitUrl})`);
        }
        
        hoverMessage.isTrusted = true;

        const range = line.range;

        // Text decoration (visible, no hover)
        const textDecoration: vscode.DecorationOptions = {
          range: range,
          renderOptions: {
            before: {
              contentText: text
            }
          }
        };
        textDecorations.push(textDecoration);

        // Hover decoration (invisible, narrow range at start of line, has hover)
        // Create a zero-width range at the very beginning of the line
        const hoverRange = new vscode.Range(lineIndex, 0, lineIndex, 0);
        const hoverDecoration: vscode.DecorationOptions = {
          range: hoverRange,
          hoverMessage: hoverMessage
        };
        hoverDecorations.push(hoverDecoration);
      }

      console.log(`[GitHistory] Setting ${textDecorations.length} text decorations and ${hoverDecorations.length} hover decorations`);
      editor.setDecorations(this.textDecorationType, textDecorations);
      editor.setDecorations(this.hoverDecorationType, hoverDecorations);
      console.log('[GitHistory] Decorations set successfully');
    } catch (error) {
      console.error('[GitHistory] Error showing blame:', error);
    }
  }

  private truncateAuthor(author: string, maxLength: number): string {
    if (author.length <= maxLength) {
      return author;
    }
    return author.substring(0, maxLength - 2) + '..';
  }

  private formatRelativeTime(dateStr: string): string {
    const date = new Date(dateStr);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  dispose(): void {
    this.textDecorationType.dispose();
    this.hoverDecorationType.dispose();
  }
}
