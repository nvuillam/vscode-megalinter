import { spawn } from "child_process";
import { logMegaLinter } from "../outputChannel";

export type Engine = "docker" | "podman";

export type EngineStatus = {
  available: boolean;
  running: boolean;
  details?: string;
};

const ENGINE_STATUS_CACHE_TTL_MS = 10 * 1000;

export class EngineStatusService {
  private _cache: { timestamp: number; statuses: Record<Engine, EngineStatus> } | null = null;

  async detect(force?: boolean): Promise<Record<Engine, EngineStatus>> {
    const now = Date.now();
    if (!force && this._cache && now - this._cache.timestamp < ENGINE_STATUS_CACHE_TTL_MS) {
      const ageMs = now - this._cache.timestamp;
      logMegaLinter(`Run view: using cached engine status | age=${ageMs}ms`);
      return this._cache.statuses;
    }

    const [docker, podman] = await Promise.all([this.detectEngine("docker"), this.detectEngine("podman")]);
    const statuses: Record<Engine, EngineStatus> = { docker, podman };
    this._cache = { timestamp: now, statuses };

    logMegaLinter(
      `Run view: engine status | ` +
        `docker=${docker.available ? (docker.running ? "available" : "not started") : "not installed"} ` +
        `podman=${podman.available ? (podman.running ? "available" : "not started") : "not installed"}`,
    );
    return statuses;
  }

  private async detectEngine(engine: Engine): Promise<EngineStatus> {
    const cmd = process.platform === "win32" ? `${engine}.exe` : engine;

    try {
      const ok = await execWithTimeout(cmd, ["info"], 10000);
      return { available: true, running: ok, details: ok ? "running" : "not running" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // If executable is missing, mark unavailable
      if (/ENOENT/i.test(msg) || /not found/i.test(msg)) {
        return { available: false, running: false, details: "not installed" };
      }

      // Executable exists but info failed -> treat as installed but not running
      return { available: true, running: false, details: "not running" };
    }
  }
}

function execWithTimeout(command: string, args: string[], timeoutMs: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
    });

    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve(false);
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      if (settled) {
        return;
      }
      settled = true;
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) {
        return;
      }
      settled = true;
      resolve(code === 0);
    });
  });
}
