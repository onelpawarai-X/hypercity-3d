"""End-to-end check of the agent-training API over the relay."""
import asyncio, json, random
import websockets

async def main():
    async with websockets.connect("ws://localhost:12001", max_size=8_000_000) as ws:
        async def call(msg):
            await ws.send(json.dumps(msg))
            while True:
                rep = json.loads(await ws.recv())
                if rep.get("id") == msg.get("id"):
                    return rep

        stats = await call({"id": 1, "cmd": "stats"})
        print("stats:", json.dumps(stats.get("stats", stats))[:220])

        made = await call({"id": 2, "cmd": "make", "archetype": "xbot"})
        env_id = made["env"]
        print("env:", env_id, "agent:", made.get("agentId"),
              "obsSize:", made.get("observationSize"))
        reset = await call({"id": 3, "cmd": "reset", "env": env_id, "seed": 7})
        print("reset obs:", reset.get("obs"))

        total_reward, steps, last = 0.0, 0, None
        for i in range(300):
            action = [1.0, 0.0, random.uniform(-0.6, 0.6), 1.0]
            rep = await call({"id": 100 + i, "cmd": "step", "env": env_id, "action": action})
            total_reward += rep.get("reward", 0.0)
            steps += 1
            last = rep
            if rep.get("done"):
                await call({"id": 9000 + i, "cmd": "reset", "env": env_id})
        print(f"stepped {steps} times, total reward {total_reward:.2f}")
        print("last:", json.dumps(last)[:220])

        snap = await call({"id": 500, "cmd": "snapshot"})
        agents = snap.get("agents") or snap.get("snapshot") or []
        print("agents in world:", len(agents))
        await call({"id": 501, "cmd": "close", "env": env_id})
        print("RL loop OK")

asyncio.run(main())
