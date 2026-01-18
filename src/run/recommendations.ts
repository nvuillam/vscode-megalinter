import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import * as vscode from "vscode";
import type { RunRecommendation } from "../shared/webviewMessages";
import { logMegaLinter } from "../outputChannel";

export class RecommendationsService {
  private readonly metadataCache = new Map<string, { label?: string; author?: string }>();

  async load(reportFolderPath: string): Promise<RunRecommendation[]> {
    const configPath = path.join(reportFolderPath, "IDE-config", ".vscode", "extensions.json");

    if (!fs.existsSync(configPath)) {
      return [];
    }

    try {
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = JSON.parse(raw) as any;
      const rawRecommendations = Array.isArray(parsed?.recommendations)
        ? (parsed.recommendations as unknown[])
        : [];

      const cleaned = rawRecommendations
        .filter((r: unknown): r is string => typeof r === "string")
        .map((r: string) => r.trim())
        .filter(Boolean);

      const seen = new Set<string>();
      const unique = cleaned.filter((id: string) => {
        const key = id.toLowerCase();
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });

      if (!unique.length) {
        return [];
      }

      const installedMap = new Map<string, vscode.Extension<any>>(
        vscode.extensions.all.map((ext) => [ext.id.toLowerCase(), ext]),
      );

      const recs: RunRecommendation[] = await Promise.all(
        unique.map(async (extensionId: string) => {
          const lowered = extensionId.toLowerCase();
          const installedExt = installedMap.get(lowered);
          const meta = await this.resolveMetadata(extensionId, installedExt);

          return {
            extensionId,
            installed: Boolean(installedExt),
            label: meta.label || inferLabelFromExtensionId(extensionId),
            author: meta.author || inferAuthorFromExtensionId(extensionId),
          } satisfies RunRecommendation;
        }),
      );

      return recs;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logMegaLinter(`Run view: failed to parse recommended extensions | ${msg}`);
      return [];
    }
  }

  private async resolveMetadata(
    extensionId: string,
    installedExt?: vscode.Extension<any>,
  ): Promise<{ label: string; author: string }> {
    const cacheKey = extensionId.toLowerCase();
    const cached = this.metadataCache.get(cacheKey);
    if (cached?.label && cached?.author) {
      return { label: cached.label, author: cached.author };
    }

    let label =
      typeof installedExt?.packageJSON?.displayName === "string"
        ? installedExt.packageJSON.displayName.trim()
        : "";

    let author =
      typeof installedExt?.packageJSON?.publisherDisplayName === "string"
        ? installedExt.packageJSON.publisherDisplayName.trim()
        : typeof installedExt?.packageJSON?.publisher === "string"
          ? installedExt.packageJSON.publisher.trim()
          : "";

    if (!label || !author) {
      const marketplace = await fetchExtensionMetadataFromMarketplace(extensionId);
      if (marketplace) {
        if (!label && marketplace.label) {
          label = marketplace.label.trim();
        }
        if (!author && marketplace.author) {
          author = marketplace.author.trim();
        }
      }
    }

    if (!label) {
      label = inferLabelFromExtensionId(extensionId);
    }

    if (!author) {
      author = inferAuthorFromExtensionId(extensionId);
    }

    const meta = { label, author };
    this.metadataCache.set(cacheKey, meta);
    return meta;
  }
}

function inferLabelFromExtensionId(extensionId: string): string {
  if (!extensionId) {
    return "";
  }

  const trimmed = extensionId.trim();
  const withoutPublisher = trimmed.includes(".") ? trimmed.slice(trimmed.indexOf(".") + 1) : trimmed;
  const parts = withoutPublisher.split(/[-._]/g).filter(Boolean);
  if (parts.length === 0) {
    return trimmed;
  }

  const words = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  return words.join(" ");
}

function inferAuthorFromExtensionId(extensionId: string): string {
  if (!extensionId) {
    return "";
  }

  const trimmed = extensionId.trim();
  const publisher = trimmed.includes(".") ? trimmed.slice(0, trimmed.indexOf(".")) : trimmed;
  const parts = publisher.split(/[-._]/g).filter(Boolean);
  if (parts.length === 0) {
    return publisher;
  }

  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

async function fetchExtensionMetadataFromMarketplace(
  extensionId: string,
): Promise<{ label?: string; author?: string } | null> {
  const trimmed = typeof extensionId === "string" ? extensionId.trim() : "";
  if (!trimmed || !trimmed.includes(".")) {
    return null;
  }

  const url = "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery";
  const body = {
    filters: [
      {
        criteria: [{ filterType: 7, value: trimmed }],
        pageNumber: 1,
        pageSize: 1,
        sortBy: 0,
        sortOrder: 0,
      },
    ],
    // Include metadata + latest version without payload heavy assets.
    flags: 914,
  };

  try {
    const response = await axios.post(url, body, {
      headers: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        "Content-Type": "application/json",
        // eslint-disable-next-line @typescript-eslint/naming-convention
        Accept: "application/json;api-version=7.1-preview.1",
      },
      timeout: 4000,
    });

    const ext = response.data?.results?.[0]?.extensions?.[0];
    if (!ext) {
      return null;
    }

    const label = typeof ext.displayName === "string" ? ext.displayName : undefined;
    const author =
      typeof ext.publisher?.displayName === "string"
        ? ext.publisher.displayName
        : typeof ext.publisher?.publisherName === "string"
          ? ext.publisher.publisherName
          : undefined;

    return { label, author };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logMegaLinter(`Run view: marketplace lookup failed for ${trimmed} | ${msg}`);
    return null;
  }
}
