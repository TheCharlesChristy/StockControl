#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const stateDir = path.join(repoRoot, ".dev-server");
const pidFile = path.join(stateDir, "dev-server.pid");
const logFile = path.join(stateDir, "dev-server.log");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const ensureStateDir = () => {
  fs.mkdirSync(stateDir, { recursive: true });
};

const appendLog = (text) => {
  ensureStateDir();
  fs.appendFileSync(logFile, text, "utf8");
};

const readPid = () => {
  if (!fs.existsSync(pidFile)) {
    return undefined;
  }

  try {
    const value = fs.readFileSync(pidFile, "utf8").trim();
    return value.length > 0 ? Number(value) : undefined;
  } catch {
    return undefined;
  }
};

const writePid = (pid) => {
  ensureStateDir();
  fs.writeFileSync(pidFile, String(pid), "utf8");
};

const removePid = () => {
  if (fs.existsSync(pidFile)) {
    fs.rmSync(pidFile, { force: true });
  }
};

const isProcessRunning = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const stopProcessTree = (pid) => {
  if (!isProcessRunning(pid)) {
    return false;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Ignore cleanup failures.
      }
    }
  }

  return true;
};

const start = () => {
  const existingPid = readPid();
  if (existingPid !== undefined && isProcessRunning(existingPid)) {
    console.log(`Dev server already running with PID ${existingPid}.`);
    return;
  }

  if (existingPid !== undefined) {
    removePid();
  }

  ensureStateDir();
  appendLog(`[${new Date().toISOString()}] Starting dev stack\n`);

  const child = spawn(pnpmCommand, ["dev"], {
    cwd: repoRoot,
    detached: true,
    env: { ...process.env, FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    appendLog(text);
    process.stdout.write(text);
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    appendLog(text);
    process.stderr.write(text);
  });

  child.on("error", (error) => {
    appendLog(`[${new Date().toISOString()}] Failed to start dev server: ${error.message}\n`);
    console.error(`Failed to start dev server: ${error.message}`);
  });

  child.on("exit", (code) => {
    if (code !== 0) {
      appendLog(`[${new Date().toISOString()}] Dev server exited with code ${code}.\n`);
    }
    if (readPid() !== undefined && Number(readPid()) === child.pid) {
      removePid();
    }
  });

  if (child.pid === undefined) {
    console.error("Could not determine the child process ID.");
    return;
  }

  writePid(child.pid);
  console.log(`Started dev server with PID ${child.pid}.`);
};

const stop = () => {
  const existingPid = readPid();
  if (existingPid === undefined || !isProcessRunning(existingPid)) {
    removePid();
    console.log("Dev server is not running.");
    return;
  }

  stopProcessTree(existingPid);
  removePid();
  appendLog(`[${new Date().toISOString()}] Stopped dev server.\n`);
  console.log(`Stopped dev server (PID ${existingPid}).`);

  spawnSync(pnpmCommand, ["services:down"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
};

const status = () => {
  const existingPid = readPid();
  if (existingPid === undefined) {
    console.log("Dev server status: stopped");
    return;
  }

  if (!isProcessRunning(existingPid)) {
    removePid();
    console.log("Dev server status: stopped");
    return;
  }

  console.log(`Dev server status: running (PID ${existingPid})`);
  console.log(`Log file: ${logFile}`);
};

const logs = () => {
  ensureStateDir();
  if (!fs.existsSync(logFile)) {
    fs.writeFileSync(logFile, "", "utf8");
  }

  const content = fs.readFileSync(logFile, "utf8");
  const lines = content.split(/\r?\n/).filter((line) => line.length > 0);
  const tail = 80;
  if (lines.length > 0) {
    console.log(lines.slice(-tail).join("\n"));
  }

  const watcher = fs.watch(logFile, (eventType) => {
    if (eventType !== "change") {
      return;
    }

    const updated = fs.readFileSync(logFile, "utf8");
    const lastLine = updated.split(/\r?\n/).slice(-1)[0] ?? "";
    if (lastLine.length > 0) {
      process.stdout.write(`${lastLine}\n`);
    }
  });

  const handleExit = () => {
    watcher.close();
    process.exit(0);
  };

  process.on("SIGINT", handleExit);
  process.on("SIGTERM", handleExit);
};

const command = process.argv[2] ?? "status";

switch (command) {
  case "start":
    start();
    break;
  case "stop":
    stop();
    break;
  case "status":
    status();
    break;
  case "logs":
    logs();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error("Use: start, stop, status, or logs");
    process.exitCode = 1;
}
