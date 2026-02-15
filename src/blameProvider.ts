import * as vscode from 'vscode';
import { GitService, BlameLineInfo } from './gitService';

export class GitBlameProvider {
  private textDecorationType: vscode.TextEditorDecorationType;
  private hoverDecorationType: vscode.TextEditorDecorationType;
  private enabled: boolean = true;
  private currentEditor: vscode.TextEditor | undefined;
  private blameData: Map<string, BlameLineInfo[]> = new Map();
  private fontSize: number;
  private fontFamily: string;
  private backgroundEnabled: boolean;
  private newestColor: string;
  private oldestColor: string;

  constructor(private gitService: GitService) {
    const config = vscode.workspace.getConfiguration('gitHistory');
    this.fontSize = config.get('blameFontSize', 12);
    this.fontFamily = config.get('blameFontFamily', 'Menlo, Monaco, \'Courier New\', monospace');
    this.backgroundEnabled = config.get('blameBackgroundEnabled', false);
    this.newestColor = config.get('blameNewestColor', '#1a3d1a');
    this.oldestColor = config.get('blameOldestColor', '#3d1a1a');

    this.textDecorationType = this.createTextDecorationType();

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
      if (e.affectsConfiguration('gitHistory.blameFontSize') || e.affectsConfiguration('gitHistory.blameFontFamily') || e.affectsConfiguration('gitHistory.blameBackgroundEnabled') || e.affectsConfiguration('gitHistory.blameNewestColor') || e.affectsConfiguration('gitHistory.blameOldestColor')) {
        this.updateFontSettings();
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

      // Calculate unique commits for background coloring
      const uniqueCommits: string[] = [];
      if (this.backgroundEnabled) {
        const seen = new Set<string>();
        for (const lineInfo of blameInfo) {
          if (!seen.has(lineInfo.commitHash)) {
            seen.add(lineInfo.commitHash);
            uniqueCommits.push(lineInfo.commitHash);
          }
        }
      }

      // Fixed widths for consistent alignment
      const dateWidth = 10; // DD/MM/YYYY
      const authorWidth = 12;
      const totalWidth = dateWidth + 1 + authorWidth; // date + space + author
      
      for (const lineInfo of blameInfo) {
        const lineIndex = lineInfo.lineNumber - 1;
        if (lineIndex < 0 || lineIndex >= editor.document.lineCount) {
          continue;
        }

        const line = editor.document.lineAt(lineIndex);
        const relativeTime = this.formatRelativeTime(lineInfo.date);
        const author = this.truncateAuthor(lineInfo.author, authorWidth);
        const annotationText = `${relativeTime}\u00A0${author}`;
        // Ensure the entire annotation has a fixed width
        const text = annotationText + '\u00A0'.repeat(totalWidth - annotationText.length);

        // Create hover message
        const hoverMessage = new vscode.MarkdownString();
        hoverMessage.appendMarkdown(`**Commit:** [${lineInfo.commitHash.substring(0, 7)}](command:gitHistory.viewBlameCommit?${encodeURIComponent(JSON.stringify([lineInfo.commitHash, filePath]))})  \n`);
        hoverMessage.appendMarkdown(`**Author:** ${lineInfo.author}${lineInfo.authorEmail ? ` ${lineInfo.authorEmail}` : ''}  \n`);
        const date = new Date(lineInfo.date);
        hoverMessage.appendMarkdown(`**Date:** ${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}  \n`);
        
        // Add GitHub link if available
        if (githubUrl) {
          const commitUrl = `${githubUrl}/commit/${lineInfo.commitHash}`;
          hoverMessage.appendMarkdown(`[Copy sha](command:gitHistory.copyCommitShaFromBlame?${encodeURIComponent(JSON.stringify([lineInfo.commitHash]))}) &nbsp; | &nbsp; [View on GitHub](${commitUrl})  \n`);
        } else {
          hoverMessage.appendMarkdown(`[Copy sha](command:gitHistory.copyCommitShaFromBlame?${encodeURIComponent(JSON.stringify([lineInfo.commitHash]))})  \n`);
        }
        
        hoverMessage.appendMarkdown(`\n`);
        hoverMessage.appendMarkdown(`${lineInfo.summary}  \n`);
        
        hoverMessage.isTrusted = true;

        const range = line.range;

        // Calculate background color based on commit index (grouped by unique commits)
        let backgroundColor: string | undefined;
        if (this.backgroundEnabled && uniqueCommits.length > 1) {
          const commitIndex = uniqueCommits.indexOf(lineInfo.commitHash);
          const ratio = commitIndex / (uniqueCommits.length - 1);
          backgroundColor = this.interpolateColor(this.newestColor, this.oldestColor, ratio);
        }

        // Text decoration (visible, no hover)
        const textDecoration: vscode.DecorationOptions = {
          range: range,
          renderOptions: {
            before: {
              contentText: text,
              backgroundColor: backgroundColor
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
      return author + '\u00A0'.repeat(maxLength - author.length);
    }
    return author.substring(0, maxLength - 2) + '..';
  }

  private formatRelativeTime(dateStr: string): string {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return '\u00A0\u00A0-\u00A0/\u00A0-\u00A0/\u00A0\u00A0';
    }
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  dispose(): void {
    this.textDecorationType.dispose();
    this.hoverDecorationType.dispose();
  }

  private createTextDecorationType(): vscode.TextEditorDecorationType {
    const beforeOptions: any = {
      color: '#acacac',
      fontStyle: 'normal',
      fontWeight: 'normal',
      margin: '0 15px 0 0'
    };
    
    if (this.fontSize) {
      beforeOptions.fontSize = `${this.fontSize}px`;
    }
    if (this.fontFamily) {
      beforeOptions.fontFamily = this.fontFamily;
    }
    
    const options: vscode.DecorationRenderOptions = {
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
      before: beforeOptions
    };
    
    return vscode.window.createTextEditorDecorationType(options);
  }

  private updateFontSettings(): void {
    const config = vscode.workspace.getConfiguration('gitHistory');
    this.fontSize = config.get('blameFontSize', 12);
    this.fontFamily = config.get('blameFontFamily', 'Menlo, Monaco, \'Courier New\', monospace');
    this.backgroundEnabled = config.get('blameBackgroundEnabled', false);
    this.newestColor = config.get('blameNewestColor', '#1a3d1a');
    this.oldestColor = config.get('blameOldestColor', '#3d1a1a');
    
    this.textDecorationType.dispose();
    this.textDecorationType = this.createTextDecorationType();
    
    if (this.currentEditor && this.enabled) {
      this.showBlame(this.currentEditor);
    }
  }

  private interpolateColor(color1: string, color2: string, ratio: number): string {
    const hex = (c: string) => parseInt(c, 16);
    const r1 = hex(color1.slice(1, 3));
    const g1 = hex(color1.slice(3, 5));
    const b1 = hex(color1.slice(5, 7));
    const r2 = hex(color2.slice(1, 3));
    const g2 = hex(color2.slice(3, 5));
    const b2 = hex(color2.slice(5, 7));
    
    const r = Math.round(r1 + (r2 - r1) * ratio);
    const g = Math.round(g1 + (g2 - g1) * ratio);
    const b = Math.round(b1 + (b2 - b1) * ratio);
    
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
}
