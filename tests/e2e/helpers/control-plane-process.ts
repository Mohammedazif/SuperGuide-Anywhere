import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { appDatabaseUrl } from "../../helpers/db";
import { EXTENSION_ID, REPO_ROOT } from "./launch";

async function freePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close((error) => {
        if (error) rejectPort(error);
        else resolvePort(port);
      });
    });
  });
}

export interface ControlPlaneProcess {
  baseUrl: string;
  port: number;
  stop(): Promise<void>;
}

export async function spawnControlPlane(
  options: { agentLoop?: "on" | "off"; port?: number; dailyTaskQuota?: string } = {},
): Promise<ControlPlaneProcess> {
  const port = options.port ?? (await freePort());
  // The API lives on localhost while fixture sites live on 127.0.0.1: the staged test
  // manifest pre-holds 127.0.0.1 only, so requests to the API stay ordinary CORS requests
  // carrying an Origin header, exactly as in production where the API host is never a
  // granted site.
  const baseUrl = `http://localhost:${port}`;
  const child: ChildProcess = spawn(
    "node",
    ["--import", "tsx", join(REPO_ROOT, "apps/control-plane/src/main.ts")],
    {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        SGA_DATABASE_URL: appDatabaseUrl(),
        SGA_PORT: String(port),
        SGA_PUBLIC_ORIGIN: baseUrl,
        ANTHROPIC_API_KEY: process.env["ANTHROPIC_API_KEY"] ?? "unused-in-transport-e2e",
        SGA_DEVICE_SIGNING_KEY: randomBytes(32).toString("base64"),
        SGA_ALLOWED_EXTENSION_IDS: `chrome-extension://${EXTENSION_ID}`,
        SGA_LOG_LEVEL: "warn",
        SGA_AGENT_LOOP: options.agentLoop ?? "off",
        ...(options.dailyTaskQuota === undefined
          ? {}
          : { SGA_DAILY_TASK_QUOTA: options.dailyTaskQuota }),
      },
    },
  );
  const stderr: string[] = [];
  child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk.toString()));

  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const response = await fetch(`${baseUrl}/v1/quota`);
      if (response.status === 403) break;
    } catch {
      if (child.exitCode !== null) {
        throw new Error(`control plane exited ${child.exitCode}\n${stderr.join("")}`);
      }
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`control plane did not start\n${stderr.join("")}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }

  return {
    baseUrl,
    port,
    stop: async () => {
      child.kill("SIGTERM");
      await new Promise((resolveExit) => {
        child.on("exit", resolveExit);
        setTimeout(resolveExit, 3_000);
      });
    },
  };
}
