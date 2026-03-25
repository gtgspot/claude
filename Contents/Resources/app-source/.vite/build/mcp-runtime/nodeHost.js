#!/usr/bin/env node
"use strict";
const path = require("node:path");
const node_stream = require("node:stream");
const node_url = require("node:url");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const [entryPoint, ...args] = process.argv.slice(2);
if (!entryPoint) {
  console.error("Error: No entry point specified");
  process.exit(1);
}
process.parentPort.once("message", (e) => {
  if (e.data.type !== "init" || !e.ports || !e.ports[0]) {
    console.error("Error: Expected init message with MessagePort");
    process.exit(1);
  }
  const port = e.ports[0];
  const stdoutWrite = function(chunk, encodingOrCallback, callback) {
    port.postMessage({ type: "stdout", content: chunk.toString() });
    let cb;
    if (typeof encodingOrCallback === "function") {
      cb = encodingOrCallback;
    } else if (callback) {
      cb = callback;
    }
    if (cb) {
      process.nextTick(cb);
    }
    return true;
  };
  process.stdout.write = stdoutWrite;
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const stderrWrite = function(chunk, encodingOrCallback, callback) {
    port.postMessage({ type: "stderr", content: chunk.toString() });
    if (typeof encodingOrCallback === "function") {
      return originalStderrWrite(chunk, encodingOrCallback);
    } else {
      return originalStderrWrite(chunk, encodingOrCallback, callback);
    }
  };
  process.stderr.write = stderrWrite;
  const stdinStream = new node_stream.Readable({
    read() {
    }
  });
  if (process.stdin) {
    const methods = [
      "read",
      "push",
      "unshift",
      "pause",
      "resume",
      "pipe",
      "unpipe",
      "on",
      "once",
      "removeListener",
      "removeAllListeners",
      "setEncoding",
      "destroy",
      "isPaused",
      "readableLength",
      "readable"
    ];
    for (const method of methods) {
      if (typeof stdinStream[method] === "function") {
        process.stdin[method] = stdinStream[method].bind(
          stdinStream
        );
      }
    }
    Object.defineProperty(process.stdin, "readableHighWaterMark", {
      get: () => stdinStream.readableHighWaterMark,
      configurable: true
    });
    Object.defineProperty(process.stdin, "readableLength", {
      get: () => stdinStream.readableLength,
      configurable: true
    });
    Object.defineProperty(process.stdin, "destroyed", {
      get: () => stdinStream.destroyed,
      configurable: true
    });
  }
  port.on("message", (event) => {
    if (event.data.type === "stdin") {
      stdinStream.push(event.data.data + "\n");
    }
  });
  port.start();
  process.argv = [
    process.platform === "win32" ? "node.exe" : "node",
    entryPoint,
    ...args
  ];
  try {
    const absolutePath = path__namespace.resolve(entryPoint);
    delete require.cache[absolutePath];
    import(node_url.pathToFileURL(absolutePath).toString()).catch((error) => {
      console.error("Failed to load MCP server:", error);
      process.exit(1);
    });
  } catch (error) {
    console.error("Failed to load MCP server:", error);
    process.exit(1);
  }
});
process.on("SIGTERM", () => {
  process.exit(0);
});
process.on("SIGINT", () => {
  process.exit(0);
});
