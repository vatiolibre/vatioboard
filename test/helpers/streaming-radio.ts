import { createServer, type ServerResponse } from "node:http";

/** Real chunked PCM stream: an old response can hang while new GETs stay healthy. */
export async function createStreamingRadio() {
  const sampleRate = 8000;
  const chunk = Buffer.alloc(sampleRate / 4 * 2);
  for (let i = 0; i < chunk.length / 2; i++) {
    chunk.writeInt16LE(Math.round(2200 * Math.sin(i * Math.PI * 440 / sampleRate)), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(0x7ffffff0, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(0x7ffffff0 - 36, 40);
  const connections: { response: ServerResponse; timer: ReturnType<typeof setInterval>; bytes: number; hanging: boolean; readonly deliveredSeconds: number }[] = [];
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "audio/wav", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
    response.write(header);
    // Four seconds buffered before paced delivery; no finite route.fulfill body.
    for (let i = 0; i < 16; i++) response.write(chunk);
    const connection = {
      response, bytes: header.length + 16 * chunk.length, hanging: false,
      get deliveredSeconds() { return (this.bytes - header.length) / (sampleRate * 2); },
      timer: setInterval(() => {
        if (!connection.hanging && !response.destroyed) {
          response.write(chunk);
          connection.bytes += chunk.length;
        }
      }, 250),
    };
    connections.push(connection);
    response.on("close", () => clearInterval(connection.timer));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Streaming fixture failed to bind");
  return {
    url: `http://127.0.0.1:${address.port}/live.wav`,
    connections,
    interrupt(kind: "half-open" | "disconnect") {
      for (const connection of connections) {
        connection.hanging = true;
        if (kind === "disconnect") connection.response.destroy();
      }
    },
    async close() {
      for (const { timer, response } of connections) { clearInterval(timer); response.destroy(); }
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
