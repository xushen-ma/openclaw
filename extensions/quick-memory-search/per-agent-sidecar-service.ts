import { spawn, type ChildProcess } from "node:child_process";

export type QuickMemorySidecarConfig = {
  perAgentBaseUrl: string;
  scriptPath: string;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
};

export type QuickMemorySidecarStatus = {
  enabled: boolean;
  managed: boolean;
  running: boolean;
  pid?: number;
  baseUrl?: string;
  host?: string;
  port?: number;
  scriptPath?: string;
  restarts: number;
  lastExit?: { code: number | null; signal: NodeJS.Signals | null; at: string };
  reason?: string;
};

const MAX_RESTART_DELAY_MS = 5_000;

function parseLocalUrl(
  rawUrl: string,
): { ok: true; host: string; port: number; baseUrl: string } | { ok: false; reason: string } {
  if (!rawUrl.trim()) return { ok: false, reason: "per-agent base URL is not configured" };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: `invalid per-agent base URL: ${rawUrl}` };
  }

  if (url.protocol !== "http:") {
    return { ok: false, reason: `unsupported protocol for managed sidecar: ${url.protocol}` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "authenticated per-agent URL not supported for managed sidecar" };
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    return {
      ok: false,
      reason: `per-agent URL must be host:port only (got path ${url.pathname})`,
    };
  }

  const host = url.hostname;
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if (!localHosts.has(host)) {
    return {
      ok: false,
      reason: `per-agent URL host is not local (${host}); skipping managed sidecar`,
    };
  }

  const parsedPort = Number(url.port || "8091");
  if (!Number.isFinite(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
    return { ok: false, reason: `invalid per-agent URL port: ${url.port}` };
  }

  return {
    ok: true,
    host,
    port: parsedPort,
    baseUrl: `http://${host}:${parsedPort}`,
  };
}

export function createQuickMemoryPerAgentSidecarService(config: QuickMemorySidecarConfig) {
  const target = parseLocalUrl(config.perAgentBaseUrl);
  let child: ChildProcess | null = null;
  let stopping = false;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let restartCount = 0;
  let lastExit: QuickMemorySidecarStatus["lastExit"];

  const clearRestartTimer = () => {
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
  };

  const status = (): QuickMemorySidecarStatus => ({
    enabled: true,
    managed: target.ok,
    running: Boolean(child && child.exitCode === null),
    pid: child?.pid,
    baseUrl: target.ok ? target.baseUrl : config.perAgentBaseUrl,
    host: target.ok ? target.host : undefined,
    port: target.ok ? target.port : undefined,
    scriptPath: config.scriptPath,
    restarts: restartCount,
    lastExit,
    reason: target.ok ? undefined : target.reason,
  });

  const scheduleRestart = () => {
    if (!target.ok || stopping) return;
    clearRestartTimer();
    const delayMs = Math.min(1_000 * Math.max(1, restartCount), MAX_RESTART_DELAY_MS);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      startChild();
    }, delayMs);
  };

  const startChild = () => {
    if (!target.ok || stopping || child) return;

    try {
      const env = {
        ...process.env,
        OV_PER_AGENT_HTTP_HOST: target.host,
        OV_PER_AGENT_HTTP_PORT: String(target.port),
      };
      child = spawn(process.execPath, [config.scriptPath], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout?.on("data", (chunk) => {
        const text = String(chunk).trim();
        if (text) config.logger.info(`[quick-memory-sidecar] ${text}`);
      });
      child.stderr?.on("data", (chunk) => {
        const text = String(chunk).trim();
        if (text) config.logger.warn(`[quick-memory-sidecar] ${text}`);
      });
      child.on("error", (err) => {
        config.logger.error(`[quick-memory-sidecar] failed to start: ${String(err)}`);
      });
      child.on("exit", (code, signal) => {
        const exitedPid = child?.pid;
        child = null;
        lastExit = { code, signal, at: new Date().toISOString() };
        if (stopping) return;
        restartCount += 1;
        config.logger.warn(
          `[quick-memory-sidecar] exited (pid=${exitedPid ?? "unknown"}, code=${String(code)}, signal=${String(signal)}); restarting`,
        );
        scheduleRestart();
      });

      config.logger.info(
        `[quick-memory-sidecar] started (pid=${child.pid ?? "unknown"}, url=${target.baseUrl}, script=${config.scriptPath})`,
      );
    } catch (err) {
      config.logger.error(`[quick-memory-sidecar] spawn error: ${String(err)}`);
      scheduleRestart();
    }
  };

  const stopChild = async () => {
    stopping = true;
    clearRestartTimer();
    if (!child) return;

    const proc = child;
    child = null;
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const killer = setTimeout(() => {
        if (proc.exitCode === null) {
          try {
            proc.kill("SIGKILL");
          } catch {
            // noop
          }
        }
      }, 2_000);

      proc.once("exit", (code, signal) => {
        clearTimeout(killer);
        lastExit = { code, signal, at: new Date().toISOString() };
        done();
      });

      try {
        proc.kill("SIGTERM");
      } catch {
        clearTimeout(killer);
        done();
      }
    });
  };

  return {
    status,
    service: {
      id: "quick-memory-search.per-agent-sidecar",
      start: async () => {
        stopping = false;
        if (!target.ok) {
          config.logger.info(`[quick-memory-sidecar] not managed: ${target.reason}`);
          return;
        }
        startChild();
      },
      stop: async () => {
        await stopChild();
      },
    },
  };
}
