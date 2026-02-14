import { simpleGit, SimpleGit } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs';
import { CacheManager } from './cacheManager';

export interface CommitInfo {
  hash: string;
  date: string;
  message: string;
  author: string;
  authorEmail: string;
}

export interface BlameLineInfo {
  lineNumber: number;
  commitHash: string;
  author: string;
  date: string;
  summary: string;
}

interface GitRepoInfo {
  root: string;
  git: SimpleGit;
}

export class GitService {
  private mainGit: SimpleGit;
  private cache: CacheManager;
  private isGitRepo: boolean = false;
  private initializationPromise: Promise<void>;
  private submoduleRepos: Map<string, GitRepoInfo> = new Map();

  constructor(private workspaceRoot: string) {
    this.mainGit = simpleGit(workspaceRoot);
    this.cache = new CacheManager();
    this.initializationPromise = this.initializeRepos();
  }

  private async initializeRepos(): Promise<void> {
    try {
      this.isGitRepo = await this.mainGit.checkIsRepo();
      if (this.isGitRepo) {
        await this.detectSubmodules();
      }
    } catch {
      this.isGitRepo = false;
    }
  }

  private async detectSubmodules(): Promise<void> {
    try {
      // Get list of submodules
      const result = await this.mainGit.subModule(['status']);
      const lines = result.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        // Parse submodule status line: [+- ]<commit> <path> (<branch>)
        const match = line.match(/^\s*[+-\s]?([a-f0-9]+)\s+(\S+)/);
        if (match) {
          const submodulePath = match[2];
          const fullPath = path.join(this.workspaceRoot, submodulePath);
          
          // Check if this is actually a git repo
          const submoduleGit = simpleGit(fullPath);
          const isRepo = await submoduleGit.checkIsRepo();
          
          if (isRepo) {
            this.submoduleRepos.set(submodulePath, {
              root: fullPath,
              git: submoduleGit
            });
            console.log('Detected submodule:', submodulePath);
          }
        }
      }
    } catch (error) {
      console.log('No submodules detected or error:', error);
    }
  }

  private getRepoForFile(filePath: string): GitRepoInfo | null {
    const normalizedFile = path.normalize(filePath);
    
    // Check if file is in a submodule
    for (const [submodulePath, repoInfo] of this.submoduleRepos.entries()) {
      const fullSubmodulePath = path.join(this.workspaceRoot, submodulePath);
      if (normalizedFile.startsWith(path.normalize(fullSubmodulePath))) {
        return repoInfo;
      }
    }
    
    // Return main repo
    if (this.isGitRepo) {
      return { root: this.workspaceRoot, git: this.mainGit };
    }
    
    return null;
  }

  private getRelativePathForRepo(filePath: string, repoRoot: string): string {
    const normalizedFile = path.normalize(filePath);
    const normalizedRepo = path.normalize(repoRoot);
    
    if (normalizedFile.startsWith(normalizedRepo)) {
      let relativePath = normalizedFile.slice(normalizedRepo.length);
      // Remove leading path separator
      if (relativePath.startsWith(path.sep)) {
        relativePath = relativePath.slice(1);
      }
      return relativePath.replace(/\\/g, '/');
    }
    
    return filePath.replace(/\\/g, '/');
  }

  async isValidRepo(): Promise<boolean> {
    await this.initializationPromise;
    return this.isGitRepo || this.submoduleRepos.size > 0;
  }

  async getLog(filePath: string, page: number = 0): Promise<CommitInfo[]> {
    await this.initializationPromise;
    
    const repo = this.getRepoForFile(filePath);
    if (!repo) {
      return [];
    }

    const cacheKey = `log:${filePath}:${page}`;
    const cached = this.cache.get<CommitInfo[]>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const relativePath = this.getRelativePathForRepo(filePath, repo.root);
      const result = await repo.git.log({
        file: relativePath,
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

      const commits = result.all.map((log: any) => ({
        hash: log.hash,
        date: log.date,
        message: log.message,
        author: log.author_name || log.author,
        authorEmail: log.author_email || log.authorEmail
      }));

      this.cache.set(cacheKey, commits, { filePath });
      return commits;
    } catch (error) {
      console.error('Error fetching git log:', error);
      return [];
    }
  }

  async getChangedFiles(commitHash: string, filePath?: string): Promise<{path: string; status: 'added' | 'modified' | 'deleted' | 'unchanged'}[]> {
    const cacheKey = `files:${commitHash}`;
    const cached = this.cache.get<{path: string; status: 'added' | 'modified' | 'deleted' | 'unchanged'}[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // Determine which repo to use
    let git: SimpleGit;
    if (filePath) {
      const repo = this.getRepoForFile(filePath);
      if (!repo) return [];
      git = repo.git;
    } else {
      git = this.mainGit;
    }

    try {
      // Get file names and their status
      // Note: Options must come before commit hash
      const result = await git.show(['--name-status', '--pretty=format:', commitHash]);
      console.log('Git show result:', result);
      const lines = result.split('\n').filter((line: string) => line.trim());
      
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

  async getParentCommit(commitHash: string, filePath?: string): Promise<string | null> {
    try {
      let git: SimpleGit;
      if (filePath) {
        const repo = this.getRepoForFile(filePath);
        if (!repo) return null;
        git = repo.git;
      } else {
        git = this.mainGit;
      }
      return await git.revparse([`${commitHash}^`]);
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

    const repo = this.getRepoForFile(filePath);
    if (!repo) {
      return '';
    }

    try {
      // Convert absolute path to relative path from repo root
      const relativePath = this.getRelativePathForRepo(filePath, repo.root);
      console.log('Getting file content for:', relativePath, 'from commit:', commitHash);
      const content = await repo.git.show([`${commitHash}:${relativePath}`]);
      this.cache.set(cacheKey, content, { filePath, commitHash });
      return content;
    } catch (error) {
      console.error('Error fetching file content:', error);
      return '';
    }
  }

  invalidateCache(filePath?: string): void {
    this.cache.invalidate(filePath);
  }

  async getGitHubRemoteUrl(filePath?: string): Promise<string | null> {
    try {
      let git: SimpleGit;
      if (filePath) {
        const repo = this.getRepoForFile(filePath);
        if (!repo) return null;
        git = repo.git;
      } else {
        git = this.mainGit;
      }
      
      const remotes = await git.getRemotes(true);
      const origin = remotes.find(r => r.name === 'origin');
      
      if (!origin) {
        return null;
      }
      
      // Parse GitHub URL
      const url = origin.refs.fetch || origin.refs.push;
      if (!url) {
        return null;
      }
      
      // Handle different GitHub URL formats
      // https://github.com/owner/repo.git
      // git@github.com:owner/repo.git
      let match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
      if (match) {
        return `https://github.com/${match[1]}/${match[2]}`;
      }
      
      return null;
    } catch (error) {
      console.error('Error getting GitHub remote:', error);
      return null;
    }
  }

  async getBlame(filePath: string): Promise<BlameLineInfo[]> {
    await this.initializationPromise;
    
    const repo = this.getRepoForFile(filePath);
    if (!repo) {
      return [];
    }

    const cacheKey = `blame:${filePath}`;
    const cached = this.cache.get<BlameLineInfo[]>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const relativePath = this.getRelativePathForRepo(filePath, repo.root);
      const result = await repo.git.raw(['blame', '--porcelain', relativePath]);
      
      const blameInfo = this.parseBlameOutput(result);
      this.cache.set(cacheKey, blameInfo, { filePath });
      return blameInfo;
    } catch (error) {
      console.error('Error fetching git blame:', error);
      return [];
    }
  }

  private parseBlameOutput(output: string): BlameLineInfo[] {
    const lines = output.split('\n');
    const blameInfo: BlameLineInfo[] = [];
    const commitCache: Map<string, Partial<BlameLineInfo>> = new Map();
    let currentCommitHash: string = '';

    for (const line of lines) {
      if (line.match(/^[a-f0-9]{40} \d+ \d+/)) {
        // New line entry: hash original-line line-number
        const parts = line.split(' ');
        currentCommitHash = parts[0];
        const lineNumber = parseInt(parts[2], 10);
        
        // Get cached commit info or create new
        let commitInfo = commitCache.get(currentCommitHash);
        if (!commitInfo) {
          commitInfo = { commitHash: currentCommitHash };
          commitCache.set(currentCommitHash, commitInfo);
        }
        
        // Push the line with current commit info
        blameInfo.push({
          lineNumber: lineNumber,
          commitHash: currentCommitHash,
          author: commitInfo.author || 'Unknown',
          date: commitInfo.date || new Date().toISOString(),
          summary: commitInfo.summary || ''
        });
      } else if (line.startsWith('author ')) {
        const author = line.substring(7);
        if (currentCommitHash) {
          const commitInfo = commitCache.get(currentCommitHash);
          if (commitInfo) {
            commitInfo.author = author;
          }
        }
      } else if (line.startsWith('author-time ')) {
        const timestamp = parseInt(line.substring(12), 10);
        if (currentCommitHash) {
          const commitInfo = commitCache.get(currentCommitHash);
          if (commitInfo) {
            commitInfo.date = new Date(timestamp * 1000).toISOString();
          }
        }
      } else if (line.startsWith('summary ')) {
        const summary = line.substring(8);
        if (currentCommitHash) {
          const commitInfo = commitCache.get(currentCommitHash);
          if (commitInfo) {
            commitInfo.summary = summary;
          }
        }
      }
    }

    // Sort by line number
    blameInfo.sort((a, b) => a.lineNumber - b.lineNumber);
    return blameInfo;
  }
}
