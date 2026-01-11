import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_OWNER = 'oxsecurity';
const DEFAULT_REPO = 'megalinter';
const DEFAULT_REF = 'main';

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function loadDotEnv(dotEnvPath, { verbose } = { verbose: false }) {
  try {
    const content = await readFile(dotEnvPath, 'utf8');
    const lines = content.split(/\r?\n/);

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const withoutExport = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
      const eqIndex = withoutExport.indexOf('=');
      if (eqIndex <= 0) {
        continue;
      }

      const key = withoutExport.slice(0, eqIndex).trim();
      const value = stripQuotes(withoutExport.slice(eqIndex + 1));

      if (!key) {
        continue;
      }

      // Do not override real env vars (CLI/CI should win over .env)
      if (process.env[key] === undefined) {
        process.env[key] = value;
        if (verbose) {
          // eslint-disable-next-line no-console
          console.log(`Loaded ${key} from .env`);
        }
      }
    }
  } catch (err) {
    // Ignore if .env doesn't exist
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return;
    }
    throw err;
  }
}

function parseArgs(argv) {
  const args = {
    owner: DEFAULT_OWNER,
    repo: DEFAULT_REPO,
    ref: DEFAULT_REF,
    clean: true,
    verbose: false,
    dryRun: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    switch (value) {
      case '--owner':
        args.owner = argv[++i] ?? args.owner;
        break;
      case '--repo':
        args.repo = argv[++i] ?? args.repo;
        break;
      case '--ref':
        args.ref = argv[++i] ?? args.ref;
        break;
      case '--no-clean':
        args.clean = false;
        break;
      case '--clean':
        args.clean = true;
        break;
      case '--verbose':
        args.verbose = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        if (value.startsWith('-')) {
          throw new Error(`Unknown argument: ${value}`);
        }
        break;
    }
  }

  return args;
}

function printHelp() {
  // eslint-disable-next-line no-console
  console.log(`sync-megalinter

Downloads descriptor assets from the upstream MegaLinter repository into this extension.

Usage:
  node ./scripts/sync-megalinter.mjs [options]

Options:
  --ref <ref>       Git ref (branch/tag/sha). Default: ${DEFAULT_REF}
  --owner <owner>   GitHub owner. Default: ${DEFAULT_OWNER}
  --repo <repo>     GitHub repo. Default: ${DEFAULT_REPO}
  --clean           Delete destination folders before sync (default)
  --no-clean        Do not delete destination folders first
  --dry-run         Print what would happen, but do not write files
  --verbose         More logging

Auth:
  Set GITHUB_TOKEN in env or in a local .env file to avoid rate limits (optional).
`);
}

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

async function rimraf(targetPath) {
  await rm(targetPath, { recursive: true, force: true });
}

function createLimiter(max) {
  let active = 0;
  /** @type {Array<() => void>} */
  const queue = [];

  const next = () => {
    const fn = queue.shift();
    if (fn) fn();
  };

  return async (fn) => {
    if (active >= max) {
      await new Promise((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      next();
    }
  };
}

function githubHeaders() {
  const headers = {
    'User-Agent': 'vscode-megalinter-sync-script',
    Accept: 'application/vnd.github+json',
  };

  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const hint = res.status === 403
      ? ' (Tip: set GITHUB_TOKEN to increase GitHub rate limits)'
      : '';
    throw new Error(`GitHub API error ${res.status} for ${url}${hint}\n${body}`);
  }
  return res.json();
}

async function fetchBinary(url) {
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) {
    throw new Error(`Download error ${res.status} for ${url}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function listRepoTree({ owner, repo, ref, remotePath }) {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(remotePath)}?ref=${encodeURIComponent(ref)}`;
  const items = await fetchJson(apiUrl);

  if (!Array.isArray(items)) {
    // When remotePath is a file, GitHub returns a single object.
    return [items];
  }

  return items;
}

/**
 * Recursively downloads a GitHub directory into a local folder.
 *
 * @param {{
 *  owner: string;
 *  repo: string;
 *  ref: string;
 *  remoteDir: string;
 *  localDir: string;
 *  excludeTopLevelNames?: Set<string>;
 *  dryRun: boolean;
 *  verbose: boolean;
 * }} opts
 */
async function syncDirectory(opts) {
  const limiter = createLimiter(8);
  let fileCount = 0;
  let byteCount = 0;

  async function walk(remoteDir, localDir) {
    const entries = await listRepoTree({
      owner: opts.owner,
      repo: opts.repo,
      ref: opts.ref,
      remotePath: remoteDir,
    });

    const normalized = Array.isArray(entries) ? entries : [entries];

    for (const entry of normalized) {
      const entryPath = entry.path;
      const name = entry.name;
      const type = entry.type;

      // Allow excluding some names only at the top-level of the mapping.
      if (remoteDir === opts.remoteDir && opts.excludeTopLevelNames?.has(name)) {
        if (opts.verbose) {
          // eslint-disable-next-line no-console
          console.log(`skip: ${entryPath}`);
        }
        continue;
      }

      const relativePath = path.posix.relative(opts.remoteDir, entryPath);
      const outPath = path.join(opts.localDir, ...relativePath.split('/'));

      if (type === 'dir') {
        if (!opts.dryRun) {
          await ensureDir(outPath);
        }
        await walk(entryPath, outPath);
        continue;
      }

      if (type !== 'file') {
        // e.g. submodule
        continue;
      }

      if (!entry.download_url) {
        throw new Error(`Missing download_url for ${entryPath}`);
      }

      if (opts.verbose) {
        // eslint-disable-next-line no-console
        console.log(`get:  ${entryPath}`);
      }

      const buffer = await limiter(async () => fetchBinary(entry.download_url));
      fileCount += 1;
      byteCount += buffer.byteLength;

      if (!opts.dryRun) {
        await ensureDir(path.dirname(outPath));
        await writeFile(outPath, buffer);
      }
    }
  }

  await walk(opts.remoteDir, opts.localDir);
  return { fileCount, byteCount };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const repoRoot = process.cwd();
  await loadDotEnv(path.join(repoRoot, '.env'), { verbose: args.verbose });
  const localDescriptorsDir = path.join(repoRoot, 'src', 'descriptors');

  const mappings = [
    {
      label: 'descriptors',
      remoteDir: 'megalinter/descriptors',
      localDir: localDescriptorsDir,
      // Local `src/descriptors/TEMPLATES` is sourced from repo root `TEMPLATES`.
      excludeTopLevelNames: new Set(['TEMPLATES']),
    },
    {
      label: 'TEMPLATES',
      remoteDir: 'TEMPLATES',
      localDir: path.join(localDescriptorsDir, 'TEMPLATES'),
    },
  ];

  // eslint-disable-next-line no-console
  console.log(`Syncing from https://github.com/${args.owner}/${args.repo} (ref: ${args.ref})`);
  // eslint-disable-next-line no-console
  console.log(`Destination: ${path.relative(repoRoot, localDescriptorsDir)}`);

  if (args.clean) {
    if (args.dryRun) {
      // eslint-disable-next-line no-console
      console.log(`[dry-run] clean: ${localDescriptorsDir}`);
    } else {
      await rimraf(localDescriptorsDir);
      await ensureDir(localDescriptorsDir);
    }
  } else {
    await ensureDir(localDescriptorsDir);
  }

  let totalFiles = 0;
  let totalBytes = 0;

  for (const mapping of mappings) {
    // eslint-disable-next-line no-console
    console.log(`\n[${mapping.label}] ${mapping.remoteDir} → ${path.relative(repoRoot, mapping.localDir)}`);

    const { fileCount, byteCount } = await syncDirectory({
      owner: args.owner,
      repo: args.repo,
      ref: args.ref,
      remoteDir: mapping.remoteDir,
      localDir: mapping.localDir,
      excludeTopLevelNames: mapping.excludeTopLevelNames,
      dryRun: args.dryRun,
      verbose: args.verbose,
    });

    totalFiles += fileCount;
    totalBytes += byteCount;

    // eslint-disable-next-line no-console
    console.log(`Downloaded ${fileCount} files (${(byteCount / 1024 / 1024).toFixed(2)} MiB)`);
  }

  // eslint-disable-next-line no-console
  console.log(`\nDone: ${totalFiles} files (${(totalBytes / 1024 / 1024).toFixed(2)} MiB)`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
