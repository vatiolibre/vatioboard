#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { createServer } from "vite";

const EXPECTED_VIN = "7SAYGAEE3RF178432";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    process.env.CHROME_BIN,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const code = await new Promise((resolve) => {
      const child = spawn(candidate, ["--version"], { stdio: "ignore" });
      child.on("error", () => resolve(-1));
      child.on("exit", resolve);
    });
    try {
      if (code === 0) return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error("Chromium was not found. Set CHROMIUM_PATH to run VIN OCR verification.");
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForDevTools(child) {
  let output = "";
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for Chromium DevTools endpoint.\n${output}`));
    }, 20000);

    const handleData = (chunk) => {
      output += String(chunk);
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    };

    child.stdout?.on("data", handleData);
    child.stderr?.on("data", handleData);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Chromium exited early with code ${code}.\n${output}`));
      }
    });
  });
}

function openWebSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", () => reject(new Error(`Could not connect to ${url}`)), { once: true });
  });
}

function createCdpClient(socket) {
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) {
      entry.reject(new Error(message.error.message || JSON.stringify(message.error)));
    } else {
      entry.resolve(message.result);
    }
  });

  return {
    send(method, params = {}) {
      id += 1;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
    },
    close() {
      socket.close();
    },
  };
}

async function createPage(baseUrl, browserWebSocketUrl) {
  const browserUrl = new URL(browserWebSocketUrl);
  const endpoint = `http://${browserUrl.host}/json/new?${encodeURIComponent(baseUrl)}`;
  let response = await fetch(endpoint, { method: "PUT" });
  if (!response.ok) {
    response = await fetch(endpoint);
  }
  if (!response.ok) {
    throw new Error(`Could not create Chromium target: HTTP ${response.status}`);
  }
  const target = await response.json();
  if (!target.webSocketDebuggerUrl) {
    throw new Error("Chromium target did not include a page websocket URL.");
  }
  return openWebSocket(target.webSocketDebuggerUrl);
}

async function main() {
  const server = await createServer({
    logLevel: "error",
    server: {
      host: "127.0.0.1",
      port: await findFreePort(),
    },
  });
  await server.listen();

  const baseUrl = server.resolvedUrls?.local?.[0];
  if (!baseUrl) throw new Error("Vite did not expose a local URL.");

  const chromium = await findChromium();
  const userDataDir = await mkdtemp(join(tmpdir(), "vatioboard-vin-ocr-"));
  const child = spawn(chromium, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let pageSocket;
  try {
    const browserWebSocketUrl = await waitForDevTools(child);
    pageSocket = await createPage(baseUrl, browserWebSocketUrl);
    const page = createCdpClient(pageSocket);
    await page.send("Runtime.enable");
    await delay(500);

    const expression = `
      (async () => {
        const mod = await import("/src/apps/delivery-checklist/delivery-checklist-vin-scanner.ts");
        const result = await mod.recognizeDeliveryVinFromImageSource("/img/sample-vin.jpeg", {
          onProgress(progress) {
            window.__deliveryVinOcrProgress = progress;
          },
        });
        await mod.terminateDeliveryVinOcrWorker();
        return result;
      })()
    `;
    const evaluation = await page.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: 120000,
    });
    if (evaluation.exceptionDetails) {
      throw new Error(evaluation.exceptionDetails.text || "VIN OCR evaluation failed.");
    }
    const result = evaluation.result?.value;
    if (result?.vin !== EXPECTED_VIN) {
      throw new Error(`Expected ${EXPECTED_VIN}, got ${result?.vin || "<empty>"}.\nRaw OCR: ${result?.rawText || ""}`);
    }
    console.log(`Delivery VIN OCR sample passed: ${result.vin}`);
    page.close();
  } finally {
    pageSocket?.close();
    child.kill("SIGTERM");
    await server.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
