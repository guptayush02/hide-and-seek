# Hide and Seek (multiplayer)

Quick scaffold for a multiplayer hide-and-seek demo using Express (Socket.IO) and Vite + React + Three.js.

Server:
- folder: `server`
- Start (install then run):

```bash
cd server
npm install
npm run dev   # or npm start
```

Client:
- folder: `client`
- Start (install then run):

```bash
cd client
npm install
npm run dev
```

Notes:
- The server runs on port 4000 by default. The client expects `http://localhost:4000` for Socket.IO.
- This is a minimal scaffold: game state is held in-memory and optionally persisted to MongoDB if `MONGO_URI` is set.
- Open multiple browser windows to simulate multiple players; use lobby to join as `hider` or `seeker`.

Gameplay (updated):
- Animated 3D home map with kitchen, bedroom, hall, balconey, and garden hide spots.
- Character avatars are animated (walk/caught states) instead of simple balls.
- Clear HUD shows phase, timer, hidden room, nearby warning, and caught notifications.
- Seeker catches hiders by moving within catch distance during seeking phase.

Controls:
- Move: `WASD` or arrow keys.
- Hide in nearest hide spot: `H` key or `Hide (nearest)` button.

Additional server endpoints:
- `POST /auth` - create a lightweight user id. Request body: `{ name }`. Response: `{ userId, name }`.
- `GET /games` - list recent saved games (requires `MONGO_URI`).
- `GET /games/:id` - fetch a saved game snapshot by DB id.

Anti-cheat & auth:
- The server performs simple movement validation (max speed). Clients receive `teleportDetected` if updates exceed allowed speed.

Client controls & features:
- Move with WASD / Arrow keys.
- Press `Hide (nearest)` to set a hidden location (or press `h` as a shortcut).
- When seeker approaches a hider a glow appears; when close enough the server emits `playerCaught` and a caught animation plays.
