import * as vscode from 'vscode';

export class GitWatcher {
  private disposables: vscode.Disposable[] = [];
  private onChangeCallback: () => void;

  constructor(
    private gitRoot: string,
    onChange: () => void
  ) {
    this.onChangeCallback = onChange;
    this.setupWatcher();
  }

  private setupWatcher(): void {
    const gitPattern = new vscode.RelativePattern(this.gitRoot, '.git/**/*');
    const watcher = vscode.workspace.createFileSystemWatcher(gitPattern);

    let timeout: NodeJS.Timeout | null = null;
    const debouncedChange = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(() => {
        this.onChangeCallback();
      }, 500);
    };

    watcher.onDidChange(debouncedChange);
    watcher.onDidCreate(debouncedChange);
    watcher.onDidDelete(debouncedChange);

    this.disposables.push(watcher);
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
  }
}
