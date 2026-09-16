import express from "express";
import dgram from "node:dgram";
import http from "node:http";
import { WebSocketServer } from "ws";
import { TelloSimulator } from "./simulator.js";

const PORT = Number(process.env.PORT || 3000);
const UDP_PORT = Number(process.env.TELLO_PORT || 8889);
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const sim = new TelloSimulator();
const videoStats = { frames: 0, bytes: 0, packets: 0, lastFrameAt: null };

app.use(express.json());
app.use(express.static(new URL("../public", import.meta.url).pathname));
app.get("/vendor/playcanvas/playcanvas.mjs", (_req, res) => res.sendFile(new URL("../node_modules/playcanvas/build/playcanvas.mjs", import.meta.url).pathname));

app.get("/api/state", (_req, res) => res.json(sim.snapshot()));
app.get("/api/telemetry", (_req, res) => res.type("text/plain").send(sim.telemetry()));
app.get("/api/video-status", (_req, res) => res.json({ ...videoStats, clients: videoClients?.size ?? 0 }));
app.post("/api/command", (req, res) => {
  const command = req.body?.command;
  if (!command) return res.status(400).json({ error: "command is required" });
  const response = sim.execute(command);
  res.status(response.startsWith("error") ? 400 : 200).json({ command, response, state: sim.snapshot() });
});
app.post("/api/reset", (_req, res) => { sim.reset(); res.json(sim.snapshot()); });

const udp = dgram.createSocket("udp4");
const telemetryClients = new Map();
const videoClients = new Map();
udp.on("message", (message, remote) => {
  const command = message.toString().trim();
  const response = sim.execute(command);
  udp.send(response, remote.port, remote.address);
  telemetryClients.set(`${remote.address}:8890`, { address: remote.address, port: 8890, seen: Date.now() });
  if (command.toLowerCase() === "streamon") videoClients.set(remote.address, { address: remote.address, port: 11111, seen: Date.now() });
  if (command.toLowerCase() === "streamoff") videoClients.delete(remote.address);
});
udp.on("error", error => console.error("UDP error:", error.message));
udp.bind(UDP_PORT, "0.0.0.0", () => console.log(`OFLSim UDP API listening on udp://0.0.0.0:${UDP_PORT}`));

setInterval(() => {
  const payload = JSON.stringify({ type: "state", data: sim.snapshot() });
  for (const client of wss.clients) if (client.readyState === 1) client.send(payload);
}, 50);

setInterval(() => {
  const payload = sim.telemetry();
  for (const [key, client] of telemetryClients) {
    if (Date.now() - client.seen > 300000) telemetryClients.delete(key);
    else udp.send(payload, client.port, client.address);
  }
}, 100);

let previous = performance.now();
setInterval(() => {
  const now = performance.now();
  sim.tick(Math.min((now - previous) / 1000, 0.1));
  previous = now;
}, 20);

wss.on("connection", socket => {
  socket.send(JSON.stringify({ type: "state", data: sim.snapshot() }));
  socket.on("message", (data, isBinary) => {
    if (!isBinary || !sim.state.streaming) return;
    const frame = Buffer.from(data);
    videoStats.frames += 1;
    videoStats.bytes += frame.length;
    videoStats.lastFrameAt = Date.now();
    for (const client of videoClients.values()) {
      client.seen = Date.now();
      for (let offset = 0; offset < frame.length; offset += 1200) {
        videoStats.packets += 1;
        udp.send(frame.subarray(offset, offset + 1200), client.port, client.address);
      }
    }
  });
});
server.listen(PORT, () => console.log(`OFLSim: http://localhost:${PORT}`));

process.once("SIGINT", () => { if (udp.address()) udp.close(); server.close(() => process.exit(0)); });
