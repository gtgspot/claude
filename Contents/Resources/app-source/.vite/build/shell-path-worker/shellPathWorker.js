"use strict";
const node_fs = require("node:fs");
const node_os = require("node:os");
const path = require("node:path");
const node_child_process = require("node:child_process");
function getDisclaimerBinaryPath() {
  {
    const contentsPath = path.dirname(process.resourcesPath);
    return path.join(contentsPath, "Helpers", "disclaimer");
  }
}
function getUntrustedLaunchOptions(options) {
  if (process.platform !== "darwin") {
    return options;
  }
  const disclaimerPath = getDisclaimerBinaryPath();
  return {
    cmd: disclaimerPath,
    args: [options.cmd, ...options.args]
  };
}
async function spawnAsync(cmd, args = [], options = {}) {
  const untrusted = getUntrustedLaunchOptions({ cmd, args });
  try {
    return await spawnAsyncDirect(untrusted.cmd, untrusted.args, options);
  } catch (error) {
    if (untrusted.cmd !== cmd && error instanceof Error) {
      const isEnoent = error.message.includes("ENOENT");
      if (isEnoent) {
        throw new Error(
          `Failed to spawn ${cmd} (disclaimer binary not found): ${error.message}`
        );
      }
      throw new Error(
        `Failed to spawn ${cmd} (via disclaimer): ${error.message}`
      );
    }
    throw error;
  }
}
const DEFAULT_MAX_BUFFER = 512 * 1024 * 1024;
function spawnAsyncDirect(cmd, args = [], options = {}) {
  const {
    ignoreExitCode,
    maxBuffer = DEFAULT_MAX_BUFFER,
    ...spawnOptions
  } = options;
  return new Promise((resolve, reject) => {
    var _a, _b;
    const proc = node_child_process.spawn(cmd, args, {
      ...spawnOptions,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    let totalBytes = 0;
    let killed = false;
    const onData = (chunks) => (data) => {
      totalBytes += data.length;
      if (totalBytes > maxBuffer) {
        killed = true;
        proc.kill();
        return;
      }
      chunks.push(data);
    };
    (_a = proc.stdout) == null ? void 0 : _a.on("data", onData(stdout));
    (_b = proc.stderr) == null ? void 0 : _b.on("data", onData(stderr));
    proc.on("error", (error) => {
      reject(new Error(`Failed to spawn ${cmd}: ${error.message}`));
    });
    let exitGraceTimer;
    proc.on("exit", () => {
      exitGraceTimer = setTimeout(() => {
        var _a2, _b2;
        (_a2 = proc.stdout) == null ? void 0 : _a2.destroy();
        (_b2 = proc.stderr) == null ? void 0 : _b2.destroy();
      }, 1e3);
    });
    proc.on("close", (code) => {
      if (exitGraceTimer) {
        clearTimeout(exitGraceTimer);
      }
      if (killed) {
        reject(
          new Error(
            `${cmd} output exceeded maxBuffer limit (${maxBuffer} bytes)`
          )
        );
        return;
      }
      const result = {
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
        code
      };
      if (!ignoreExitCode && code !== 0) {
        const error = new Error(
          `${cmd} exited with code ${code}: ${result.stderr || result.stdout}`
        );
        error.result = result;
        reject(error);
        return;
      }
      resolve(result);
    });
  });
}
const SHELL_TIMEOUT_MS = 4e3;
const PATH_SENTINEL = "___CLAUDE_PATH_EXTRACT___";
const CC_ENV_EXTRACT_LIST = /* @__PURE__ */ new Set([
  "PATH",
  // Config / paths
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_TMPDIR",
  // Shell
  "CLAUDE_CODE_SHELL",
  "CLAUDE_CODE_SHELL_PREFIX",
  // API config
  "ANTHROPIC_BASE_URL",
  // Git commit signing (SSH agent for SSH-based signing, GPG_TTY for GPG passphrase prompts)
  "SSH_AUTH_SOCK",
  "GPG_TTY",
  // SSL/TLS certificates (for enterprise proxies that perform SSL inspection)
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  // OTEL (opt-in telemetry)
  "CLAUDE_CODE_ENABLE_TELEMETRY",
  "CLAUDE_CODE_OTEL_HEADERS_HELPER_DEBOUNCE_MS",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "OTEL_EXPORTER_OTLP_PROTOCOL",
  "OTEL_LOGS_EXPORTER",
  "OTEL_LOGS_EXPORT_INTERVAL",
  "OTEL_LOG_USER_PROMPTS",
  "OTEL_METRICS_EXPORTER",
  "OTEL_METRICS_INCLUDE_ACCOUNT_UUID",
  "OTEL_METRICS_INCLUDE_SESSION_ID",
  "OTEL_METRICS_INCLUDE_VERSION",
  "OTEL_METRIC_EXPORT_INTERVAL",
  "OTEL_RESOURCE_ATTRIBUTES"
]);
const COMMON_SHELLS = [
  {
    path: "/bin/zsh",
    hints: [path.resolve(node_os.homedir(), ".zshrc")]
  },
  { path: "/bin/bash", hints: [path.resolve(node_os.homedir(), ".bashrc")] },
  { path: "/bin/sh" }
];
function getSafeShell() {
  var _a;
  const envShell = process.env.SHELL;
  if ((envShell == null ? void 0 : envShell.startsWith("/")) && node_fs.existsSync(envShell)) {
    return envShell;
  }
  for (const shell of COMMON_SHELLS) {
    if (node_fs.existsSync(shell.path) && ((_a = shell.hints) == null ? void 0 : _a.some((hint) => node_fs.existsSync(hint)))) {
      return shell.path;
    }
  }
  for (const shell of COMMON_SHELLS) {
    if (node_fs.existsSync(shell.path)) {
      return shell.path;
    }
  }
  return "/bin/sh";
}
async function extractPathFromShell() {
  var _a;
  if (process.platform === "win32") {
    return process.env.PATH || "";
  }
  const shell = getSafeShell();
  const { stdout } = await spawnAsync(
    shell,
    ["-l", "-i", "-c", `echo "${PATH_SENTINEL}$PATH"`],
    {
      timeout: SHELL_TIMEOUT_MS,
      env: {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        SHELL: process.env.SHELL,
        USER: process.env.USER,
        // Disable auto-update prompts from tools like oh-my-zsh
        DISABLE_AUTO_UPDATE: "true",
        ZSH_DISABLE_COMPFIX: "true"
      }
    }
  );
  const match = stdout.match(new RegExp(`${PATH_SENTINEL}(.*)$`, "m"));
  return ((_a = match == null ? void 0 : match[1]) == null ? void 0 : _a.trim()) || process.env.PATH || "";
}
function isCCEnvVar(name) {
  return CC_ENV_EXTRACT_LIST.has(name);
}
const ENV_SENTINEL = "___CLAUDE_ENV_EXTRACT___";
async function extractShellEnvironment() {
  if (process.platform === "win32") {
    const result2 = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== void 0 && isCCEnvVar(key)) {
        result2[key] = value;
      }
    }
    return result2;
  }
  const shell = getSafeShell();
  const { stdout } = await spawnAsync(
    shell,
    ["-l", "-i", "-c", `echo "${ENV_SENTINEL}"; env`],
    {
      timeout: SHELL_TIMEOUT_MS,
      env: {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        SHELL: process.env.SHELL,
        USER: process.env.USER,
        // Disable auto-update prompts from tools like oh-my-zsh
        DISABLE_AUTO_UPDATE: "true",
        ZSH_DISABLE_COMPFIX: "true"
      }
    }
  );
  const sentinelIdx = stdout.indexOf(ENV_SENTINEL);
  if (sentinelIdx === -1) {
    return { PATH: process.env.PATH || "" };
  }
  const envOutput = stdout.slice(sentinelIdx + ENV_SENTINEL.length + 1).trim();
  const result = {};
  let currentKey = null;
  let currentValue = null;
  for (const line of envOutput.split("\n")) {
    const eqIdx = line.indexOf("=");
    if (eqIdx > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(line.slice(0, eqIdx))) {
      if (currentKey !== null && currentValue !== null && isCCEnvVar(currentKey)) {
        result[currentKey] = currentValue;
      }
      currentKey = line.slice(0, eqIdx);
      currentValue = line.slice(eqIdx + 1);
    } else if (eqIdx > 0) {
      if (currentKey !== null && currentValue !== null && isCCEnvVar(currentKey)) {
        result[currentKey] = currentValue;
      }
      currentKey = null;
      currentValue = null;
    } else if (currentKey !== null && currentValue !== null) {
      currentValue += "\n" + line;
    }
  }
  if (currentKey !== null && currentValue !== null && isCCEnvVar(currentKey)) {
    result[currentKey] = currentValue;
  }
  if (!result.PATH) {
    result.PATH = process.env.PATH || "";
  }
  return result;
}
process.parentPort.once("message", (e) => {
  var _a;
  if (e.data.type !== "init" || !((_a = e.ports) == null ? void 0 : _a[0])) {
    process.exit(1);
  }
  const port = e.ports[0];
  port.on("message", async (event) => {
    if (event.data.type === "getPath") {
      try {
        if (process.platform === "win32") {
          port.postMessage({ type: "result", path: process.env.PATH || "" });
          return;
        }
        const path2 = await extractPathFromShell();
        port.postMessage({ type: "result", path: path2 });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        port.postMessage({ type: "error", message });
      }
    } else if (event.data.type === "getEnvironment") {
      try {
        const env = await extractShellEnvironment();
        port.postMessage({ type: "envResult", env });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        port.postMessage({ type: "error", message });
      }
    }
  });
  port.start();
});
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
