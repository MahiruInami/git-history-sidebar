import * as vscode from 'vscode';
import { GitService } from './gitService';

export class GitHistoryContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange: vscode.EventEmitter<vscode.Uri> = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange: vscode.Event<vscode.Uri> = this._onDidChange.event;

  constructor(private gitService: GitService) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    // URI format: git-history://{commitHash}/{filePath}
    // The authority contains the commit hash, path contains the file path
    const commitHash = uri.authority;
    const filePath = uri.path.startsWith('/') ? uri.path.slice(1) : uri.path;
    
    if (!commitHash || !filePath) {
      console.error('Invalid URI format:', uri.toString());
      return '';
    }

    console.log(`Fetching content for commit: ${commitHash}, file: ${filePath}`);
    const content = await this.gitService.getFileContent(commitHash, filePath);
    console.log(`Content length: ${content.length}`);
    return content;
  }
}
