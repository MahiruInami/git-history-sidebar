import { simpleGit, SimpleGit } from 'simple-git';
import { CacheManager } from './cacheManager';

export interface CommitInfo {
  hash: string;
  date: string;
  message: string;
  author: string;
  authorEmail: string;
}

export class GitService {
  private git: SimpleGit;
  private cache: CacheManager;
  private isGitRepo: boolean = false;
  private initializationPromise: Promise<void>;

  constructor(private workspaceRoot: string) {
    this.git = simpleGit(workspaceRoot);
    this.cache = new CacheManager();
    this.initializationPromise = this.checkGitRepo();
  }

  private async checkGitRepo(): Promise<void> {
    try {
      this.isGitRepo = await this.git.checkIsRepo();
    } catch {
      this.isGitRepo = false;
    }
  }

  async isValidRepo(): Promise<boolean> {
    await this.initializationPromise;
    return this.isGitRepo;
  }

  async getLog(filePath: string, page: number = 0): Promise<CommitInfo[]> {
    await this.initializationPromise;
    if (!this.isGitRepo) {
      return [];
    }

    const cacheKey = `log:${filePath}:${page}`;
    const cached = this.cache.get<CommitInfo[]>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const result = await this.git.log({
        file: filePath,
        '--follow': null,
        '--max-count': 50,
        '--skip': page * 50,
        format: {
          hash: '%H',
          date: '%ai',
          message: '%s',
          author: '%an',
          authorEmail: '%ae'
        }
      });

      const commits = result.all.map(log => ({
        hash: log.hash,
        date: log.date,
        message: log.message,
        author: (log as any).author_name || log.author,
        authorEmail: (log as any).author_email || (log as any).authorEmail
      }));

      this.cache.set(cacheKey, commits, { filePath });
      return commits;
    } catch (error) {
      console.error('Error fetching git log:', error);
      return [];
    }
  }

  async getChangedFiles(commitHash: string): Promise<{path: string; status: 'added' | 'modified' | 'deleted' | 'unchanged'}[]> {
    const cacheKey = `files:${commitHash}`;
    const cached = this.cache.get<{path: string; status: 'added' | 'modified' | 'deleted' | 'unchanged'}[]>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Get file names and their status
      // Note: Options must come before commit hash
      const result = await this.git.show(['--name-status', '--pretty=format:', commitHash]);
      console.log('Git show result:', result);
      const lines = result.split('\n').filter(f => f.trim());
      
      const files: {path: string; status: 'added' | 'modified' | 'deleted' | 'unchanged'}[] = [];
      
      for (const line of lines) {
        // Match status and file path (handles renames with RXXX status too)
        const match = line.match(/^([AMDRT]\d*)\s+(.+)$/);
        if (match) {
          const status = match[1];
          const filePath = match[2];
          let fileStatus: 'added' | 'modified' | 'deleted' | 'unchanged';
          
          if (status.startsWith('A')) {
            fileStatus = 'added';
          } else if (status.startsWith('M')) {
            fileStatus = 'modified';
          } else if (status.startsWith('D')) {
            fileStatus = 'deleted';
          } else if (status.startsWith('R')) {
            fileStatus = 'modified'; // Renamed files are treated as modified
          } else if (status.startsWith('T')) {
            fileStatus = 'modified'; // Type changed files are treated as modified
          } else {
            fileStatus = 'unchanged';
          }
          
          files.push({ path: filePath, status: fileStatus });
        }
      }

      console.log('Parsed files:', files);
      this.cache.set(cacheKey, files, { filePath: '', commitHash });
      return files;
    } catch (error) {
      console.error('Error fetching changed files:', error);
      return [];
    }
  }

  async getParentCommit(commitHash: string): Promise<string | null> {
    try {
      return await this.git.revparse([`${commitHash}^`]);
    } catch {
      return null;
    }
  }

  async getFileContent(commitHash: string, filePath: string): Promise<string> {
    const cacheKey = `content:${commitHash}:${filePath}`;
    const cached = this.cache.get<string>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Convert absolute path to relative path from workspace root
      const relativePath = this.getRelativePath(filePath);
      console.log('Getting file content for:', relativePath, 'from commit:', commitHash);
      const content = await this.git.show([`${commitHash}:${relativePath}`]);
      this.cache.set(cacheKey, content, { filePath, commitHash });
      return content;
    } catch (error) {
      console.error('Error fetching file content:', error);
      return '';
    }
  }

  getRelativePath(absolutePath: string): string {
    // Normalize paths for cross-platform compatibility
    const normalizedWorkspace = this.workspaceRoot.replace(/\\/g, '/');
    const normalizedPath = absolutePath.replace(/\\/g, '/');
    
    if (normalizedPath.startsWith(normalizedWorkspace)) {
      let relativePath = normalizedPath.slice(normalizedWorkspace.length);
      // Remove leading slash if present
      if (relativePath.startsWith('/')) {
        relativePath = relativePath.slice(1);
      }
      return relativePath;
    }
    
    // If it's already a relative path, return as-is
    return absolutePath.replace(/\\/g, '/');
  }

  invalidateCache(filePath?: string): void {
    this.cache.invalidate(filePath);
  }
}
