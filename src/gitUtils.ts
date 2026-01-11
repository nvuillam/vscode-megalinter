import * as fs from 'fs';
import * as path from 'path';

const readTextFileIfExists = (filePath: string): string | null => {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
};

export const getGitDir = (folderPath: string): string | null => {
  try {
    const dotGitPath = path.join(folderPath, '.git');
    if (!fs.existsSync(dotGitPath)) {
      return null;
    }

    const stat = fs.lstatSync(dotGitPath);
    if (stat.isDirectory()) {
      return dotGitPath;
    }

    if (stat.isFile()) {
      const content = readTextFileIfExists(dotGitPath);
      const match = content?.match(/^gitdir:\s*(.+)\s*$/m);
      if (!match || !match[1]) {
        return null;
      }

      const gitDirRaw = match[1].trim();
      const gitDirPath = path.isAbsolute(gitDirRaw) ? gitDirRaw : path.resolve(folderPath, gitDirRaw);
      const dirStat = fs.existsSync(gitDirPath) ? fs.lstatSync(gitDirPath) : null;
      return dirStat?.isDirectory() ? gitDirPath : null;
    }

    return null;
  } catch {
    return null;
  }
};

export const isGitRepository = (folderPath: string): boolean => {
  return getGitDir(folderPath) !== null;
};

export const getGitOriginRepositoryName = (folderPath: string): string | null => {
  try {
    const gitDir = getGitDir(folderPath);
    if (!gitDir) {
      return null;
    }

    const configPath = path.join(gitDir, 'config');
    const configText = readTextFileIfExists(configPath);
    if (!configText) {
      return null;
    }

    const lines = configText.split(/\r?\n/);

    let inOrigin = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const sectionMatch = trimmed.match(/^\[(.+?)\]$/);
      if (sectionMatch) {
        inOrigin = sectionMatch[1] === 'remote "origin"';
        continue;
      }

      if (!inOrigin) {
        continue;
      }

      const urlMatch = trimmed.match(/^url\s*=\s*(.+)$/);
      if (!urlMatch || !urlMatch[1]) {
        continue;
      }

      const url = urlMatch[1].trim();
      const withoutGit = url.replace(/\.git$/i, '');
      const slashParts = withoutGit.split('/');
      const lastSegment = slashParts[slashParts.length - 1] || '';
      const colonParts = lastSegment.split(':');
      const repo = colonParts[colonParts.length - 1];
      return repo || null;
    }

    return null;
  } catch {
    return null;
  }
};
