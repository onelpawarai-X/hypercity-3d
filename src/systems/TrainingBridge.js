/**
 * External training bridge.
 *
 * HyperCity 3D is meant to be a place where large agents can be trained, not
 * just played. This bridge exposes the whole simulation over a tiny JSON
 * protocol on three transports at once:
 *
 *   - window.HyperCity            (in-page, for the console or a test script)
 *   - window.postMessage          (for an embedding page / iframe harness)
 *   - WebSocket  ws://host:PORT   (for a Python / Node trainer)
 *
 * The message set is a minimal gym-style API:
 *
 *   { id, cmd: "envs"                     }        list environments
 *   { id, cmd: "reset", env, seed?, opts? }         start an episode
 *   { id, cmd: "step",  env, action }               one fixed step
 *   { id, cmd: "observe", env }                     observation only
 *   { id, cmd: "spawn", archetype, x, z }           add an agent
 *   { id, cmd: "despawn", agent }                   remove an agent
 *   { id, cmd: "goal", agent, x, z }                scripted navigation
 *   { id, cmd: "snapshot" }                         all agent states
 *   { id, cmd: "stats" }                            world + agent statistics
 *   { id, cmd: "spawnVehicle", type, x, z, yaw }    add a vehicle
 *   { id, cmd: "clearVehicles" }
 *   { id, cmd: "setTime", t }                       time of day 0..1
 *   { id, cmd: "teleport", x, z }                   move the player
 *   { id, cmd: "freeze", value }                    pause the simulation
 *
 * Every reply echoes `id` so a trainer can pipeline requests.
 */

/** A single-agent environment view over the shared world. */
class AgentEnv {
  constructor(game, agentId) {
    this.game = game;
    this.agentId = agentId;
    this.actionSpace = { shape: [4], low: [-1, -1, -1, 0], high: [1, 1, 1, 1] };
    this.observationSize = 9;
  }

  reset({ seed, x, z, yaw, goal } = {}) {
    if (seed !== undefined) this.game.seedRandom(seed);
    const obs = this.game.agents.reset(this.agentId, { x, z, yaw });
    if (goal) this.game.agents.setGoal(this.agentId, goal[0], goal[1]);
    return { obs };
  }

  step(action) {
    const r = this.game.agents.step(this.agentId, action);
    if (!r) return { obs: null, reward: 0, done: true, info: { error: 'no such agent' } };
    return r;
  }

  observe() {
    return { obs: this.game.agents.observe(this.agentId) };
  }

  close() {
    this.game.agents.remove(this.agentId);
  }
}

export class TrainingBridge {
  constructor(game, { port = 12001 } = {}) {
    this.game = game;
    this.port = port;
    this.envs = new Map();
    this.ws = null;
    this.clients = new Set();
    this.messageCount = 0;
    this._installWindowApi();
    this._installPostMessage();
    this._installWebSocket();
  }

  _installWindowApi() {
    const api = {
      version: '1.0.0',
      /** Direct access for debugging and notebooks. */
      game: this.game,
      request: (msg) => this.handle(msg),
      createEnv: (archetype, opts = {}) => this.createEnv(archetype, opts),
      envs: () => [...this.envs.keys()],
      /** Convenience: run n random steps on an env and return the rewards. */
      rollout: (envId, steps = 100, policy = null) => this.rollout(envId, steps, policy),
    };
    window.HyperCity = api;
  }

  _installPostMessage() {
    window.addEventListener('message', (e) => {
      const data = e.data;
      if (!data || data.__hypercity !== true) return;
      const reply = this.handle(data);
      reply.__hypercity = true;
      (e.source || window).postMessage(reply, '*');
    });
  }

  _installWebSocket() {
    // A trainer connects to the relay (tools/training-server.mjs). The relay
    // is proxied by the dev server at /relay, so this also works when the
    // game is served over HTTPS through a tunnel. If no relay is running the
    // game simply continues without it, so failures here are non-fatal.
    try {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${proto}://${location.host}/relay`;
      const ws = new WebSocket(url);
      ws.onopen = () => {
        this.ws = ws;
        this.clients.add(ws);
        ws.send(JSON.stringify({ __hypercity_client: 'browser' }));
      };
      ws.onmessage = async (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.relay) return; // relay's own hello
        const reply = await this.handle(msg);
        try { ws.send(JSON.stringify(reply)); } catch {}
      };
      ws.onclose = () => { this.ws = null; };
      ws.onerror = () => { this.ws = null; };
    } catch {
      this.ws = null;
    }
  }

  async createEnv(archetype = 'citizen', opts = {}) {
    const w = this.game.world;
    const rp = w.randomRoadPoint();
    const agentId = await this.game.spawnAgent(archetype, rp.x, rp.z, rp.yaw, opts);
    const env = new AgentEnv(this.game, agentId);
    const envId = `env_${agentId}`;
    this.envs.set(envId, env);
    return {
      env: envId, agentId,
      actionSpace: env.actionSpace, observationSize: env.observationSize,
    };
  }

  /**
   * Run a batch of steps locally. `policy` may be a function name registered
   * on window (for browser-driven experiments) or omitted for a random walk.
   */
  rollout(envId, steps, policy) {
    const env = this.envs.get(envId);
    if (!env) return { error: 'no such env' };
    const rewards = [];
    let obs = env.observe().obs;
    for (let i = 0; i < steps; i++) {
      let action;
      if (typeof policy === 'function') action = policy(obs, i);
      else action = [Math.random() * 2 - 1, 0, Math.random() * 2 - 1, Math.random()];
      const r = env.step(action);
      obs = r.obs;
      rewards.push(r.reward);
      if (r.done) break;
    }
    const mean = rewards.reduce((a, b) => a + b, 0) / (rewards.length || 1);
    return { steps: rewards.length, meanReward: mean, rewards };
  }

  /** The single entry point every transport funnels through. */
  async handle(msg) {
    this.messageCount++;
    const id = msg.id ?? null;
    try {
      const result = await this._dispatch(msg);
      return { id, ok: true, ...result };
    } catch (err) {
      return { id, ok: false, error: String(err?.message || err) };
    }
  }

  async _dispatch(msg) {
    const g = this.game;
    const cmd = msg.cmd;
    switch (cmd) {
      case 'ping':
        return { pong: true, version: '1.0.0' };

      case 'stats': {
        const s = g.stats();
        return { stats: s };
      }

      case 'envs':
        return { envs: [...this.envs.keys()], count: this.envs.size };

      case 'make': {
        const created = await this.createEnv(msg.archetype, msg.opts);
        return created;
      }

      case 'reset': {
        const env = this.envs.get(msg.env);
        if (!env) throw new Error('no such env');
        return env.reset(msg);
      }

      case 'step': {
        const env = this.envs.get(msg.env);
        if (!env) throw new Error('no such env');
        return env.step(msg.action);
      }

      case 'observe': {
        const env = this.envs.get(msg.env);
        if (!env) throw new Error('no such env');
        return env.observe();
      }

      case 'close': {
        const env = this.envs.get(msg.env);
        if (env) { env.close(); this.envs.delete(msg.env); }
        return { closed: !!env };
      }

      case 'spawn': {
        const rp = g.world.randomRoadPoint();
        const x = msg.x ?? rp.x, z = msg.z ?? rp.z;
        const agentId = await g.spawnAgent(msg.archetype || 'citizen', x, z, msg.yaw ?? rp.yaw, msg.opts || {});
        return { agent: agentId };
      }

      case 'despawn':
        return { removed: g.agents.remove(msg.agent) };

      case 'goal':
        return { obs: g.agents.setGoal(msg.agent, msg.x, msg.z, msg.opts) };

      case 'act':
        return { obs: g.agents.act(msg.agent, msg.action) };

      case 'snapshot':
        return { agents: g.agents.snapshot() };

      case 'spawnVehicle': {
        const v = await g.spawnVehicle(msg.type, msg.x, msg.z, msg.yaw ?? 0, msg.y ?? 0);
        return { vehicle: v ? { type: v.type, x: v.position.x, y: v.position.y, z: v.position.z } : null };
      }

      case 'clearVehicles':
        g.vehicles.clear();
        return { cleared: true };

      case 'setTime':
        g.sky.setTimeOfDay(msg.t ?? 0.4);
        return { time: g.sky.timeOfDay, label: g.sky.clockLabel };

      case 'teleport':
        g.teleport(msg.x, msg.z, msg.y ?? 0, msg.yaw);
        return { position: { x: msg.x, y: msg.y ?? 0, z: msg.z } };

      case 'freeze':
        g.frozen = !!msg.value;
        return { frozen: g.frozen };

      case 'control': {
        // Drive the player or a vehicle from an external policy.
        g.setExternalControl(msg.mode, msg.input);
        return { mode: g.mode };
      }

      default:
        throw new Error(`unknown command: ${cmd}`);
    }
  }
}
