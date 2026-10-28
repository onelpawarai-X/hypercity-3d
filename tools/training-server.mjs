#!/usr/bin/env node
/**
 * Training relay for HyperCity 3D.
 *
 * The game runs in a browser, which cannot accept inbound connections. This
 * small relay sits between the game and an external trainer:
 *
 *     trainer (Python / Node)  <--ws-->  relay  <--ws-->  game (browser)
 *
 * The browser connects out to the relay and identifies itself; the relay then
 * forwards every trainer command to the browser and routes the reply back by
 * message id. Trainers therefore speak the same JSON protocol the in-page
 * window.HyperCity API uses, with no knowledge of the browser.
 *
 *   node tools/training-server.mjs [--port 12001]
 *
 * Then, from Python:
 *
 *   import json, websockets, asyncio
 *
 *   async def main():
 *       async with websockets.connect("ws://localhost:12001") as ws:
 *           await ws.send(json.dumps({"id": 1, "cmd": "make", "archetype": "soldier"}))
 *           made = json.loads(await ws.recv())["env"]      # -> "env_7"
 *
 *           for i in range(1000):
 *               await ws.send(json.dumps({"id": 100 + i, "cmd": "observe", "env": made}))
 *               obs = json.loads(await ws.recv())["obs"]
 *               action = my_policy(obs)
 *               await ws.send(json.dumps({"id": 100 + i, "cmd": "step",
 *                                         "env": made, "action": action}))
 *               print(json.loads(await ws.recv()))
 */
import { WebSocketServer } from 'ws';
import http from 'node:http';

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const PORT = portArg >= 0 ? Number(args[portArg + 1]) : 12001;

const log = (...a) => console.log(`[relay ${new Date().toISOString().slice(11, 19)}]`, ...a);

let browser = null;
let messageCount = 0;
const pending = new Map(); // id -> { resolve, timer }
let nextProxyId = 1;

/** Send a command to the browser and await its reply. */
function askBrowser(message, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    if (!browser || browser.readyState !== 1) {
      reject(new Error('game is not connected to the relay'));
      return;
    }
    const id = message.id ?? `p${nextProxyId++}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout waiting for reply to "${message.cmd}"`));
    }, timeoutMs);
    pending.set(id, { resolve, timer });
    browser.send(JSON.stringify({ ...message, id }));
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      gameConnected: !!browser && browser.readyState === 1,
      messages: messageCount,
    }));
    return;
  }
  res.writeHead(404);
  res.end('HyperCity 3D training relay. Connect over WebSocket.\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  log('client connected from', req.socket.remoteAddress);
  let role = null;

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.__hypercity_client === 'browser') {
      role = 'browser';
      browser = ws;
      log('game connected — relay ready');
      ws.send(JSON.stringify({ ok: true, role: 'browser', relay: true }));
      return;
    }

    if (role !== 'browser') role = role || 'trainer';
    messageCount++;

    if (role === 'browser') {
      const p = pending.get(msg.id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(msg.id);
        p.resolve(msg);
      }
      return;
    }

    try {
      const reply = await askBrowser(msg);
      ws.send(JSON.stringify(reply));
    } catch (err) {
      ws.send(JSON.stringify({ id: msg.id ?? null, ok: false, error: String(err.message || err) }));
    }
  });

  ws.on('close', () => {
    if (ws === browser) {
      browser = null;
      log('game disconnected');
      for (const [id, p] of pending) {
        clearTimeout(p.timer);
        p.resolve({ id, ok: false, error: 'game disconnected' });
      }
      pending.clear();
    } else {
      log('trainer disconnected');
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  log(`listening on ws://0.0.0.0:${PORT}  (health: http://localhost:${PORT}/health)`);
  log('waiting for the game to connect…');
});
