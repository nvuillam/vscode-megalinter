import axios from "axios";
import { logMegaLinter } from "../outputChannel";

export type RunnerVersionsInfo = { versions: string[]; latest: string | null };

const RUNNER_VERSIONS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export class RunnerVersionService {
  private _cache: { timestamp: number; info: RunnerVersionsInfo } | null = null;

  async getRunnerVersions(): Promise<RunnerVersionsInfo> {
    const now = Date.now();
    if (this._cache && now - this._cache.timestamp < RUNNER_VERSIONS_CACHE_TTL_MS) {
      const ageMs = now - this._cache.timestamp;
      logMegaLinter(
        `Run view: versions cache hit | age=${ageMs}ms size=${this._cache.info.versions.length}`,
      );
      return this._cache.info;
    }

    const info = await this.fetchRunnerVersions();
    this._cache = { timestamp: now, info };
    return info;
  }

  private async fetchRunnerVersions(): Promise<RunnerVersionsInfo> {
    let versions: string[] = [];
    let latest: string | null = null;

    const fetchStart = Date.now();
    try {
      logMegaLinter("Run view: fetching MegaLinter versions from GitHub releases…");
      const tags = await fetchMegalinterGithubReleaseTags();
      logMegaLinter(
        `Run view: GitHub releases fetched in ${Date.now() - fetchStart}ms | tags=${tags.length}`,
      );
      const normalized = tags
        .map(normalizeReleaseTag)
        .filter((v): v is string => !!v)
        .filter((v) => isAtLeastSemver(v, "9.4.0"))
        .sort(compareSemverDesc)
        .slice(0, 10);

      const hasEligible = normalized.length > 0;
      latest = hasEligible ? "latest" : null;

      versions = ["beta", ...(hasEligible ? ["latest"] : []), ...normalized, "alpha"];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logMegaLinter(
        `Run view: GitHub releases fetch failed in ${Date.now() - fetchStart}ms | ${msg}`,
      );
      // If GitHub is unreachable (offline, rate limited, etc.), show only channels.
      versions = ["beta", "alpha"];
    }

    if (versions.length === 0) {
      versions = ["beta", "alpha"];
    }

    versions = Array.from(new Set(versions));

    logMegaLinter(`Run view: versions resolved (${versions.length}) [${versions.join(", ")}]`);

    return { versions, latest };
  }
}

function fetchMegalinterGithubReleaseTags(): Promise<string[]> {
  // Use the GitHub API to list releases. Unauthenticated access is rate limited.
  // If unreachable, caller falls back to "latest".
  const url = "https://api.github.com/repos/oxsecurity/megalinter/releases?per_page=10";

  return axios
    .get(url, {
      headers: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        "User-Agent": "vscode-megalinter",
        // eslint-disable-next-line @typescript-eslint/naming-convention
        Accept: "application/vnd.github+json",
      },
      timeout: 8000,
    })
    .then((response) => {
      const json = response.data as any;
      if (!Array.isArray(json)) {
        return [];
      }

      const tags = json
        .map((r: any) => (typeof r?.tag_name === "string" ? r.tag_name : null))
        .filter((t: any): t is string => typeof t === "string");
      return tags;
    });
}

function normalizeReleaseTag(tag: string): string | null {
  const trimmed = String(tag || "").trim();
  const withoutV = trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
  // Only keep semver-ish tags; ignore other release naming.
  return /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(withoutV) ? withoutV : null;
}

function compareSemverDesc(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);

  // Unknown versions go last
  if (!pa && !pb) {
    return b.localeCompare(a);
  }
  if (!pa) {
    return 1;
  }
  if (!pb) {
    return -1;
  }

  if (pa.major !== pb.major) {
    return pb.major - pa.major;
  }
  if (pa.minor !== pb.minor) {
    return pb.minor - pa.minor;
  }
  if (pa.patch !== pb.patch) {
    return pb.patch - pa.patch;
  }

  // Stable releases should come before prereleases
  if (pa.prerelease && !pb.prerelease) {
    return 1;
  }
  if (!pa.prerelease && pb.prerelease) {
    return -1;
  }

  return (pb.prerelease || "").localeCompare(pa.prerelease || "");
}

function parseSemver(
  v: string,
): { major: number; minor: number; patch: number; prerelease?: string } | null {
  const m = /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z.-]+))?$/.exec(v);
  if (!m) {
    return null;
  }
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] || undefined,
  };
}

export function isValidSemver(v: string): boolean {
  return parseSemver(v) !== null;
}

function isAtLeastSemver(v: string, min: string): boolean {
  const pv = parseSemver(v);
  const pm = parseSemver(min);
  if (!pv || !pm) {
    return false;
  }

  if (pv.major !== pm.major) {
    return pv.major > pm.major;
  }
  if (pv.minor !== pm.minor) {
    return pv.minor > pm.minor;
  }
  return pv.patch >= pm.patch;
}
