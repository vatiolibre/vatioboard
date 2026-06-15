#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { createServer } from "vite";

const MANIFEST_PATH = "public/img/vin-fixtures/manifest.json";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs() {
  const args = new Map();
  for (const arg of process.argv.slice(2)) {
    const [key, ...valueParts] = arg.replace(/^--/, "").split("=");
    args.set(key, valueParts.length ? valueParts.join("=") : "1");
  }
  return args;
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
    if (code === 0) return candidate;
  }

  throw new Error("Chromium was not found. Set CHROMIUM_PATH to run VIN OCR fixture verification.");
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
  if (!response.ok) response = await fetch(endpoint);
  if (!response.ok) throw new Error(`Could not create Chromium target: HTTP ${response.status}`);
  const target = await response.json();
  if (!target.webSocketDebuggerUrl) {
    throw new Error("Chromium target did not include a page websocket URL.");
  }
  return openWebSocket(target.webSocketDebuggerUrl);
}

function fixtureExpression(fixture) {
  return `
    (async () => {
      const fixture = ${JSON.stringify(fixture)};
      const mod = await import("/src/apps/delivery-checklist/delivery-checklist-vin-scanner.ts");
      const artifacts = [];
      const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("Could not read OCR artifact."));
        reader.readAsDataURL(blob);
      });
      const result = await mod.recognizeDeliveryVinFromImageSource(fixture.url, {
        mode: "frame-then-search",
        debug: true,
        debugLabel: fixture.id,
        onProgress(progress) {
          window.__deliveryVinOcrProgress = progress;
        },
        async onDebugArtifact(artifact) {
          artifacts.push({
            name: artifact.name,
            kind: artifact.kind,
            mimeType: artifact.mimeType,
            width: artifact.width,
            height: artifact.height,
            regionIndex: artifact.regionIndex,
            attempt: artifact.attempt,
            variant: artifact.variant,
            region: artifact.region,
            bytes: artifact.blob.size,
            dataUrl: await blobToDataUrl(artifact.blob),
          });
        },
      });
      await mod.terminateDeliveryVinOcrWorker();
      return {
        fixture,
        result: {
          vin: result.vin,
          rawText: result.rawText,
          confidence: result.confidence || 0,
          attempts: result.attempts || 0,
          debug: result.debug,
        },
        artifacts,
      };
    })()
  `;
}

async function evaluateFixture(page, fixture) {
  const evaluation = await page.send("Runtime.evaluate", {
    expression: fixtureExpression(fixture),
    awaitPromise: true,
    returnByValue: true,
    timeout: 180000,
  });
  if (evaluation.exceptionDetails) {
    throw new Error(evaluation.exceptionDetails.text || "VIN OCR fixture evaluation failed.");
  }
  return evaluation.result?.value;
}

async function saveArtifacts(rootDir, fixtureResult) {
  const fixture = fixtureResult.fixture;
  const safeId = String(fixture.id || basename(fixture.url)).replace(/[^a-z0-9_.-]+/gi, "-").toLowerCase();
  const fixtureDir = join(rootDir, safeId);
  await mkdir(fixtureDir, { recursive: true });
  const artifactManifest = fixtureResult.artifacts.map(({ dataUrl, ...artifact }) => artifact);
  await writeFile(
    join(fixtureDir, "debug.json"),
    JSON.stringify({
      fixture,
      result: fixtureResult.result,
      artifacts: artifactManifest,
    }, null, 2),
  );
  for (const artifact of fixtureResult.artifacts) {
    const [, base64 = ""] = String(artifact.dataUrl || "").split(",");
    if (!base64) continue;
    await writeFile(join(fixtureDir, artifact.name), Buffer.from(base64, "base64"));
  }
}

async function main() {
  const args = parseArgs();
  const saveArtifactsDir = args.get("save-artifacts") || "";
  const saveAllArtifacts = args.has("save-all-artifacts");
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));

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
  const userDataDir = await mkdtemp(join(tmpdir(), "vatioboard-vin-ocr-fixtures-"));
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

    const rows = [];
    const failures = [];
    for (const fixture of manifest) {
      const fixtureResult = await evaluateFixture(page, fixture);
      const expected = String(fixture.expectedVin || "");
      const recognized = String(fixtureResult?.result?.vin || "");
      const shouldRecognize = fixture.shouldRecognize !== false;
      const passed = shouldRecognize ? recognized === expected : recognized !== expected;
      rows.push({
        id: fixture.id,
        scenario: fixture.scenario,
        expected,
        recognized: recognized || "<empty>",
        attempts: fixtureResult?.result?.attempts || 0,
        confidence: Math.round(fixtureResult?.result?.confidence || 0),
        passed,
      });
      if (!passed) failures.push(fixtureResult);
      if (saveArtifactsDir && (saveAllArtifacts || !passed)) {
        await saveArtifacts(saveArtifactsDir, fixtureResult);
      }
    }

    console.table(rows);
    const requiredFailures = failures.filter((entry) => entry.fixture.shouldRecognize !== false);
    if (requiredFailures.length) {
      throw new Error(`${requiredFailures.length} required VIN OCR fixture(s) failed.`);
    }
    console.log(`Delivery VIN OCR fixtures passed: ${rows.filter((row) => row.passed).length}/${rows.length}`);
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
