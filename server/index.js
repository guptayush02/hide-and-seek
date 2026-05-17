require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const { saveGameResult, connect } = require('./gameModel');

function envNumber(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === null || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

const PORT = envNumber('PORT', 4000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const SOCKET_CORS_ORIGIN = process.env.SOCKET_CORS_ORIGIN || CORS_ORIGIN;
const PUBLIC_DIR = process.env.PUBLIC_DIR
  ? (path.isAbsolute(process.env.PUBLIC_DIR) ? process.env.PUBLIC_DIR : path.resolve(__dirname, process.env.PUBLIC_DIR))
  : path.join(__dirname, 'public');
const MAX_PLAYERS_PER_ROOM = envNumber('MAX_PLAYERS_PER_ROOM', 6);
const MAX_SPEED = envNumber('MAX_SPEED', 16); // units per second (anti-cheat, tuned to client movement)
const CATCH_DISTANCE = envNumber('CATCH_DISTANCE', 2);
const READY_KICK_MS = envNumber('READY_KICK_MS', 10000);
const REMATCH_VOTE_TIMEOUT_MS = envNumber('REMATCH_VOTE_TIMEOUT_MS', 10000);

const corsOptions = {
  origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
  credentials: true
}

const app = express();
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: SOCKET_CORS_ORIGIN === '*' ? true : SOCKET_CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
    credentials: true
  }
});

// In-memory store for demo. For production, persist to DB.
const games = {}; // gameId -> {map, players: {id: {role,pos,...}}, state }

function makeUserId() {
  return 'u_' + Math.random().toString(36).slice(2, 10)
}

const HOME_HIDE_SPOTS = [
  { name: 'kitchen', x: -8, z: -6 },
  { name: 'bedroom', x: 8, z: -6 },
  { name: 'hall', x: 0, z: 0 },
  { name: 'balconey', x: 8, z: 6 },
  { name: 'garden', x: -8, z: 6 },
  { name: 'left_hall', x: -6, z: 0.8 },
  { name: 'right_hall', x: 6, z: 0.8 },
  { name: 'back_corridor', x: 0, z: -6.4 },
  { name: 'front_corridor', x: 0, z: 6.4 }
]

const HOME_DOORS = [
  { id: 'door_west', x: -4, z: 0.35 },
  { id: 'door_east', x: 4, z: -0.35 }
]

const ROUND_SPAWN_POINTS = [
  { x: -9.2, z: -6.8 }, { x: 9.2, z: -6.8 }, { x: -9.2, z: 6.8 }, { x: 9.2, z: 6.8 },
  { x: -9.2, z: 0 }, { x: 9.2, z: 0 }, { x: -5.5, z: -7.0 }, { x: 5.5, z: -7.0 },
  { x: -5.5, z: 7.0 }, { x: 5.5, z: 7.0 }, { x: 0, z: -7.0 }, { x: 0, z: 7.0 },
  { x: -2.2, z: -5.8 }, { x: 2.2, z: -5.8 }, { x: -2.2, z: 5.8 }, { x: 2.2, z: 5.8 }
]

function makeRoomId(prefix = 'room') {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

function requiredSeekerCount(totalPlayers) {
  if (totalPlayers < 6) return 1
  if (totalPlayers <= 16) return 2
  return Math.min(5, 2 + Math.ceil((totalPlayers - 16) / 8))
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function rebalanceRolesForWaiting(game) {
  if (!game || game.state !== 'waiting') return
  const players = Object.values(game.players || {})
  if (!players.length) return

  const seekerSlots = Math.min(players.length, requiredSeekerCount(players.length))
  const seekersPref = shuffle(players.filter((p) => p.preferredRole === 'seeker'))
  const others = shuffle(players.filter((p) => p.preferredRole !== 'seeker'))
  const selectedSeekers = new Set([...seekersPref, ...others].slice(0, seekerSlots).map((p) => p.id))

  for (const p of players) {
    p.role = selectedSeekers.has(p.id) ? 'seeker' : 'hider'
    p.hidden = false
    p.hiddenLocation = null
    p.hiddenSpot = null
    p.caught = false
  }
}

function canStartGame(game) {
  const players = Object.values(game?.players || {})
  if (players.length < 2) return false
  const seekers = players.filter((p) => p.role === 'seeker').length
  const hiders = players.filter((p) => p.role === 'hider').length
  return seekers > 0 && hiders > 0
}

function makeDoorState() {
  return HOME_DOORS.reduce((acc, d) => {
    acc[d.id] = false
    return acc
  }, {})
}

function shuffledHideSpots() {
  const names = HOME_HIDE_SPOTS.map((s) => s.name)
  const coords = shuffle(HOME_HIDE_SPOTS.map((s) => ({ x: s.x, z: s.z })))
  return names.map((name, i) => ({ name, x: coords[i].x, z: coords[i].z }))
}

function assignRoundSpawns(game) {
  const ids = Object.keys(game.players || {})
  const pool = shuffle(ROUND_SPAWN_POINTS)
  ids.forEach((id, i) => {
    const p = game.players[id]
    const base = pool[i % pool.length]
    const jitterX = (Math.random() - 0.5) * 0.35
    const jitterZ = (Math.random() - 0.5) * 0.35
    p.pos = { x: base.x + jitterX, y: 0, z: base.z + jitterZ }
    p.lastUpdate = Date.now()
    p.hidden = false
    p.hiddenLocation = null
    p.hiddenSpot = null
    p.caught = false
  })
}

function assignSeekersForSeekingPhase(game) {
  const seekers = Object.values(game.players || {}).filter((p) => p.role === 'seeker')
  const pool = shuffle([
    { x: 0, z: -7.2 }, { x: -8.8, z: 0 }, { x: 8.8, z: 0 }, { x: 0, z: 7.2 }, { x: -6.4, z: -6.7 }
  ])
  seekers.forEach((p, i) => {
    const base = pool[i % pool.length]
    p.pos = { x: base.x, y: 0, z: base.z }
    p.lastUpdate = Date.now()
  })
}

function nearestHideSpot(game, pos) {
  let best = null
  let bestDist = Infinity
  const spots = game?.hideSpots?.length ? game.hideSpots : HOME_HIDE_SPOTS
  for (const s of spots) {
    const dx = (pos?.x || 0) - s.x
    const dz = (pos?.z || 0) - s.z
    const d = Math.sqrt(dx * dx + dz * dz)
    if (d < bestDist) {
      bestDist = d
      best = s
    }
  }
  return { spot: best, distance: bestDist }
}

function safeGamePayload(game) {
  if (!game) return null
  const playerCount = Object.keys(game.players || {}).length
  return {
    gameId: game.gameId,
    map: game.map,
    state: game.state,
    phaseRemaining: game.phaseRemaining || 0,
    requiredSeekers: requiredSeekerCount(playerCount),
    players: game.players,
    hideSpots: game.hideSpots || HOME_HIDE_SPOTS,
    doorStates: game.doorStates || {},
    createdAt: game.createdAt,
    startedAt: game.startedAt,
    endedAt: game.endedAt
  }
}

function countHiders(game) {
  const arr = Object.values(game.players || {})
  return {
    total: arr.filter(p => p.role === 'hider').length,
    caught: arr.filter(p => p.role === 'hider' && p.caught).length
  }
}

function stopTimers(game) {
  if (game.phaseInterval) clearInterval(game.phaseInterval)
  if (game.phaseTimeout) clearTimeout(game.phaseTimeout)
  game.phaseInterval = null
  game.phaseTimeout = null
}

function beginPhase(io, gameId, game, state, seconds, next) {
  stopTimers(game)
  game.state = state
  game.phaseRemaining = seconds
  io.to(gameId).emit('phaseChanged', { state, remaining: game.phaseRemaining })
  io.to(gameId).emit('gameUpdated', safeGamePayload(game))

  game.phaseInterval = setInterval(() => {
    game.phaseRemaining = Math.max(0, game.phaseRemaining - 1)
    io.to(gameId).emit('phaseTick', { state: game.state, remaining: game.phaseRemaining })
  }, 1000)

  game.phaseTimeout = setTimeout(() => {
    stopTimers(game)
    if (typeof next === 'function') next()
  }, seconds * 1000)
}

function startMatch(io, gameId, game) {
  if (!game) return
  if (game.state !== 'waiting') return
  if (!canStartGame(game)) return

  Object.values(game.players).forEach((p) => {
    p.ready = false
    p.rematchRequested = false
    clearReadyKickTimer(game, p.id)
  })

  const hideSeconds = 60
  game.startedAt = Date.now()
  game.hideSpots = shuffledHideSpots()
  game.doorStates = makeDoorState()
  assignRoundSpawns(game)
  io.to(gameId).emit('gameStarted', { state: 'hiding', hideSeconds })

  beginPhase(io, gameId, game, 'hiding', hideSeconds, () => {
    assignSeekersForSeekingPhase(game)
    beginPhase(io, gameId, game, 'seeking', 180, async () => {
      game.state = 'ended'
      game.endedAt = Date.now()
      const stats = countHiders(game)
      const winner = stats.caught === stats.total ? 'seeker' : 'hider'
      io.to(gameId).emit('gameEnded', { ...safeGamePayload(game), winner })
      try {
        await saveGameResult({ ...safeGamePayload(game), winner })
      } catch (e) {
        console.warn('save failed', e.message)
      }
    })
  })
}

function maybeAutoStart(io, gameId, game) {
  if (!game || game.state !== 'waiting') return
  const players = Object.values(game.players || {})
  if (!players.length) return
  if (!canStartGame(game)) return
  const everyoneReady = players.every((p) => !!p.ready)
  if (everyoneReady) startMatch(io, gameId, game)
}

function freshGame(gameId, map = 'home') {
  return {
    gameId,
    map,
    players: {},
    state: 'waiting',
    hideSpots: shuffledHideSpots(),
    doorStates: makeDoorState(),
    readyKickTimers: {},
    rematchStartTime: null,
    rematchTimeout: null,
    phaseInterval: null,
    phaseTimeout: null,
    phaseRemaining: 0,
    createdAt: Date.now()
  }
}

function clearReadyKickTimer(game, playerId) {
  if (!game?.readyKickTimers) return
  if (game.readyKickTimers[playerId]) {
    clearTimeout(game.readyKickTimers[playerId])
    delete game.readyKickTimers[playerId]
  }
}

function scheduleReadyKick(io, gameId, playerId, ms = READY_KICK_MS) {
  const game = games[gameId]
  if (!game) return
  // Disabled by request: do not auto-exit users from waiting room.
  // Users now leave manually via client "End" button.
  clearReadyKickTimer(game, playerId)
}

function resolveRoomId(requestedGameId, map = 'home') {
  const requested = (requestedGameId || '').trim() || makeRoomId('room')
  const existing = games[requested]
  if (!existing) return requested
  if (existing.state === 'waiting') return requested
  let next = `${requested}-${Math.random().toString(36).slice(2, 6)}`
  while (games[next]) {
    next = `${requested}-${Math.random().toString(36).slice(2, 6)}`
  }
  games[next] = freshGame(next, map)
  return next
}

function findRandomMatchRoom() {
  // Priority 1: Find waiting rooms with available slots, prefer rooms with MORE players (fill up)
  const notFull = Object.values(games).filter((g) => g.state === 'waiting' && Object.keys(g.players || {}).length < MAX_PLAYERS_PER_ROOM)
  if (notFull.length > 0) {
    // Sort by most players first so we fill up existing rooms before creating new ones
    notFull.sort((a, b) => Object.keys(b.players || {}).length - Object.keys(a.players || {}).length)
    return notFull[0].gameId
  }
  // No room found with space, create new room
  const gid = makeRoomId('match')
  games[gid] = freshGame(gid, 'home')
  return gid
}

io.on('connection', socket => {
  console.log('socket connected', socket.id);

  socket.on('createGame', ({ gameId, map }) => {
    if (!gameId) return
    if (games[gameId]) {
      socket.join(gameId)
      io.to(gameId).emit('gameUpdated', safeGamePayload(games[gameId]))
      return
    }
    games[gameId] = freshGame(gameId, map || 'home')
    socket.join(gameId);
    io.to(gameId).emit('gameUpdated', safeGamePayload(games[gameId]));
  });

  socket.on('joinGame', ({ gameId, name, role, userId }) => {
    if (!games[gameId]) {
      socket.emit('error', 'Game not found');
      return;
    }

    // Check room capacity
    const currentPlayers = Object.values(games[gameId].players)
    if (currentPlayers.length >= MAX_PLAYERS_PER_ROOM) {
      socket.emit('error', 'Room is full');
      return;
    }

    const pool = shuffle(ROUND_SPAWN_POINTS)
    const seedSpawn = pool[currentPlayers.length % pool.length]

    games[gameId].players[socket.id] = {
      id: socket.id,
      userId: userId || null,
      name: name || 'Anon',
      role: 'hider',
      preferredRole: role === 'seeker' ? 'seeker' : 'hider',
      ready: false,
      rematchRequested: false,
      pos: { x: seedSpawn.x, y: 0, z: seedSpawn.z },
      lastUpdate: Date.now(),
      hidden: false,
      hiddenLocation: null,
      hiddenSpot: null,
      caught: false
    };
    rebalanceRolesForWaiting(games[gameId])
    assignRoundSpawns(games[gameId])
    scheduleReadyKick(io, gameId, socket.id, READY_KICK_MS)
    socket.join(gameId);
    io.to(gameId).emit('gameUpdated', safeGamePayload(games[gameId]));
  });

  socket.on('setPreferredRole', ({ gameId, role }) => {
    const game = games[gameId]
    if (!game || game.state !== 'waiting') return
    const p = game.players[socket.id]
    if (!p) return
    p.preferredRole = role === 'seeker' ? 'seeker' : 'hider'
    p.ready = false
    scheduleReadyKick(io, gameId, socket.id, READY_KICK_MS)
    rebalanceRolesForWaiting(game)
    io.to(gameId).emit('gameUpdated', safeGamePayload(game))
  })

  socket.on('setReady', ({ gameId, ready }) => {
    const game = games[gameId]
    if (!game || game.state !== 'waiting') return
    const p = game.players[socket.id]
    if (!p) return
    p.ready = !!ready
    if (p.ready) clearReadyKickTimer(game, socket.id)
    else scheduleReadyKick(io, gameId, socket.id, READY_KICK_MS)
    io.to(gameId).emit('gameUpdated', safeGamePayload(game))
    maybeAutoStart(io, gameId, game)
  })

  socket.on('startGame', ({ gameId }) => {
    const game = games[gameId];
    if (!game) return;
    startMatch(io, gameId, game)
  });

  socket.on('updatePosition', ({ gameId, pos }) => {
    const game = games[gameId];
    if (!game) return;
    const player = game.players[socket.id];
    if (!player) return;
    // anti-cheat: validate speed
    const now = Date.now()
    const last = player.lastUpdate || now
    const dt = Math.max((now - last) / 1000, 0.001)
    const dx = (pos.x - (player.pos?.x || 0))
    const dz = (pos.z - (player.pos?.z || 0))
    const dist = Math.sqrt(dx * dx + dz * dz)
    const speed = dist / dt
    if (speed > MAX_SPEED) {
      // reject the update — possible teleport/cheat
      socket.emit('teleportDetected', { allowedSpeed: MAX_SPEED, speed })
      return
    }
    player.pos = pos;
    player.lastUpdate = now

    // if hidden player moves away from hide spot, auto unhide
    if (player.hidden && player.hiddenSpot) {
      const dxh = (player.pos?.x || 0) - player.hiddenSpot.x
      const dzh = (player.pos?.z || 0) - player.hiddenSpot.z
      const movedFromSpot = Math.sqrt(dxh * dxh + dzh * dzh)
      if (movedFromSpot > 0.9) {
        player.hidden = false
        player.hiddenSpot = null
        player.hiddenLocation = null
        io.to(gameId).emit('hiddenStateChanged', { id: socket.id, hidden: false, location: null })
      }
    }

    io.to(gameId).emit('playerMoved', { id: socket.id, pos, role: player.role });

    // Proximity hint (glow) for all pairs seeker-hider
    const seekers = Object.values(game.players).filter(p => p.role === 'seeker')
    const hiders = Object.values(game.players).filter(p => p.role === 'hider' && !p.caught)
    for (const seeker of seekers) {
      for (const hider of hiders) {
        const dx = seeker.pos.x - hider.pos.x
        const dz = seeker.pos.z - hider.pos.z
        const dist = Math.sqrt(dx * dx + dz * dz)
        io.to(gameId).emit('proximity', {
          seekerId: seeker.id,
          hiderId: hider.id,
          distance: dist,
          near: dist <= 6
        })
      }
    }

  });

  socket.on('attemptCatch', ({ gameId }) => {
    const game = games[gameId]
    if (!game) {
      socket.emit('catchAttemptResult', { ok: false, reason: 'invalid_game' })
      return
    }
    if (game.state !== 'seeking') {
      socket.emit('catchAttemptResult', { ok: false, reason: 'not_seeking' })
      return
    }
    const seeker = game.players[socket.id]
    if (!seeker || !seeker.pos) {
      socket.emit('catchAttemptResult', { ok: false, reason: 'not_in_game' })
      return
    }
    if (seeker.role !== 'seeker') {
      socket.emit('catchAttemptResult', { ok: false, reason: 'not_seeker' })
      return
    }

    let nearest = null
    let nearestDist = Infinity
    for (const pid in game.players) {
      const p = game.players[pid]
      if (p.role !== 'hider' || p.caught || !p.pos) continue
      const dx = seeker.pos.x - p.pos.x
      const dz = seeker.pos.z - p.pos.z
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d < nearestDist) {
        nearest = p
        nearestDist = d
      }
    }

    if (!nearest) {
      socket.emit('catchAttemptResult', { ok: false, reason: 'no_target' })
      return
    }

    // hidden hider needs tighter catch distance to reward hiding
    const allowed = nearest.hidden ? 1.2 : CATCH_DISTANCE
    if (nearestDist > allowed) {
      socket.emit('catchAttemptResult', { ok: false, reason: 'too_far', distance: nearestDist, allowed })
      return
    }

    nearest.caught = true
    nearest.hidden = false
    nearest.hiddenSpot = null
    io.to(gameId).emit('playerCaught', {
      id: nearest.id,
      by: seeker.id,
      hiderName: nearest.name,
      seekerName: seeker.name,
      distance: nearestDist
    })
    io.to(gameId).emit('catchReported', {
      by: seeker.id,
      seekerName: seeker.name,
      targetId: nearest.id,
      targetName: nearest.name,
      text: `${seeker.name} reported: I caught ${nearest.name}`
    })

    const stats = countHiders(game)
    io.to(gameId).emit('caughtStats', stats)
    io.to(gameId).emit('gameUpdated', safeGamePayload(game))

    if (stats.total > 0 && stats.caught === stats.total) {
      stopTimers(game)
      game.state = 'ended'
      game.endedAt = Date.now()
      const winner = 'seeker'
      io.to(gameId).emit('gameEnded', { ...safeGamePayload(game), winner })
      saveGameResult({ ...safeGamePayload(game), winner }).catch((e) => {
        console.warn('save failed', e.message)
      })
    }
  })

  socket.on('toggleDoor', ({ gameId, doorId }) => {
    const game = games[gameId]
    if (!game || !doorId) return
    const player = game.players[socket.id]
    if (!player?.pos) return

    const door = HOME_DOORS.find((d) => d.id === doorId)
    if (!door) return

    const dx = (player.pos.x || 0) - door.x
    const dz = (player.pos.z || 0) - door.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    if (dist > 2.6) return

    const current = !!game.doorStates?.[doorId]
    const next = !current
    game.doorStates = game.doorStates || {}
    game.doorStates[doorId] = next

    io.to(gameId).emit('doorStateChanged', { doorId, closed: next })
    io.to(gameId).emit('gameUpdated', safeGamePayload(game))
  })

  

  socket.on('setHidden', ({ gameId, location, hidden }) => {
    const game = games[gameId]
    if (!game) {
      socket.emit('hideRejected', { reason: 'invalid_game' })
      return
    }
    const player = game.players[socket.id]
    if (!player) {
      socket.emit('hideRejected', { reason: 'not_in_game' })
      return
    }
    if (game.state !== 'hiding' && game.state !== 'seeking') {
      socket.emit('hideRejected', { reason: 'invalid_phase' })
      return
    }

    if (!hidden) {
      player.hidden = false
      player.hiddenLocation = null
      player.hiddenSpot = null
      io.to(gameId).emit('hiddenStateChanged', { id: socket.id, hidden: false, location: null })
      io.to(gameId).emit('gameUpdated', safeGamePayload(game))
      return
    }

    const { spot } = nearestHideSpot(game, player.pos)

    player.hidden = true
    // anywhere hide is allowed; auto-unhide if player moves away from hide point
    player.hiddenSpot = { x: player.pos?.x || 0, z: player.pos?.z || 0 }
    player.hiddenLocation = location || spot?.name || 'free_hide'
    io.to(gameId).emit('hiddenStateChanged', { id: socket.id, hidden: true, location: player.hiddenLocation })
    io.to(gameId).emit('gameUpdated', safeGamePayload(game))
  })

  socket.on('listRooms', () => {
    const rooms = Object.values(games)
      .filter((g) => g.state === 'waiting' && Object.keys(g.players || {}).length < MAX_PLAYERS_PER_ROOM)
      .map((g) => ({
        gameId: g.gameId,
        playerCount: Object.keys(g.players || {}).length,
        players: Object.values(g.players || {}).map((p) => ({ name: p.name, role: p.role, ready: p.ready }))
      }))
      .sort((a, b) => b.playerCount - a.playerCount)
    socket.emit('roomList', { rooms })
  })

  socket.on('playAgain', ({ gameId }) => {
    const game = games[gameId]
    if (!game || game.state !== 'ended') return
    const me = game.players[socket.id]
    if (!me) return

    me.rematchRequested = true
    io.to(gameId).emit('gameUpdated', safeGamePayload(game))

    // Start rematch timer on first vote
    if (!game.rematchStartTime) {
      game.rematchStartTime = Date.now()
      
      // Schedule rematch vote timeout
      if (game.rematchTimeout) clearTimeout(game.rematchTimeout)
      game.rematchTimeout = setTimeout(() => {
        const g = games[gameId]
        if (!g || g.state !== 'ended') return

        // Find players who voted vs didn't vote
        const players = Object.values(g.players || {})
        const nonVoters = players.filter((p) => !p.rematchRequested)
        const voters = players.filter((p) => !!p.rematchRequested)

        // If no one has voted, nothing to do
        if (voters.length === 0) return

        // If only 1 player voted (solo) and no one else joined, move them to another room
        if (voters.length === 1 && nonVoters.length === 0) {
          const soloVoter = voters[0]
          const s = io.sockets.sockets.get(soloVoter.id)
          if (s) {
            s.leave(gameId)
            // Find another waiting room to join
            const targetGameId = findRandomMatchRoom()
            s.emit('movedToRoom', { gameId: targetGameId, reason: 'solo_rematch_timeout' })
            s.join(targetGameId)
          }
          delete g.players[soloVoter.id]
          clearReadyKickTimer(g, soloVoter.id)
          io.to(gameId).emit('gameUpdated', safeGamePayload(g))
          g.rematchStartTime = null
          g.rematchTimeout = null
          return
        }

        // If some but not all voted, move non-voters to another room
        if (nonVoters.length > 0) {
          for (const nv of nonVoters) {
            const s = io.sockets.sockets.get(nv.id)
            if (s) {
              s.leave(gameId)
              // Find another waiting room to join
              const targetGameId = findRandomMatchRoom()
              s.emit('movedToRoom', { gameId: targetGameId, reason: 'rematch_timeout' })
              s.join(targetGameId)
              // Player will handle joining the new room
            }
          }

          // Remove non-voters from current game
          for (const nv of nonVoters) {
            delete g.players[nv.id]
            clearReadyKickTimer(g, nv.id)
          }

          // Rebalance and continue with voters
          rebalanceRolesForWaiting(g)
          assignRoundSpawns(g)
          g.rematchStartTime = null
          g.rematchTimeout = null
          io.to(gameId).emit('gameUpdated', safeGamePayload(g))
          return
        }

        // All voted, reset to waiting
        stopTimers(game)
        game.state = 'waiting'
        game.phaseRemaining = 0
        game.startedAt = null
        game.endedAt = null
        game.hideSpots = shuffledHideSpots()
        game.doorStates = makeDoorState()
        game.rematchStartTime = null
        game.rematchTimeout = null

        Object.values(game.players).forEach((p) => {
          p.ready = false
          p.rematchRequested = false
          p.hidden = false
          p.hiddenLocation = null
          p.hiddenSpot = null
          p.caught = false
          scheduleReadyKick(io, gameId, p.id, READY_KICK_MS)
        })
        rebalanceRolesForWaiting(game)
        assignRoundSpawns(game)
        io.to(gameId).emit('phaseChanged', { state: 'waiting', remaining: 0 })
        io.to(gameId).emit('gameUpdated', safeGamePayload(game))
      }, REMATCH_VOTE_TIMEOUT_MS)

      return
    }

    // Check if everyone has voted now
    const players = Object.values(game.players || {})
    const everyoneVoted = players.length > 0 && players.every((p) => !!p.rematchRequested)
    if (!everyoneVoted) return

    // All voted immediately, reset to waiting
    if (game.rematchTimeout) clearTimeout(game.rematchTimeout)
    stopTimers(game)
    game.state = 'waiting'
    game.phaseRemaining = 0
    game.startedAt = null
    game.endedAt = null
    game.hideSpots = shuffledHideSpots()
    game.doorStates = makeDoorState()
    game.rematchStartTime = null
    game.rematchTimeout = null

    Object.values(game.players).forEach((p) => {
      p.ready = false
      p.rematchRequested = false
      p.hidden = false
      p.hiddenLocation = null
      p.hiddenSpot = null
      p.caught = false
      scheduleReadyKick(io, gameId, p.id, READY_KICK_MS)
    })
    rebalanceRolesForWaiting(game)
    assignRoundSpawns(game)
    io.to(gameId).emit('phaseChanged', { state: 'waiting', remaining: 0 })
    io.to(gameId).emit('gameUpdated', safeGamePayload(game))
  })

  function checkAndResetIfEmpty(gameId) {
    const game = games[gameId]
    if (!game) return
    const remaining = Object.keys(game.players).length
    if (remaining === 0) {
      stopTimers(game)
      // reset room to fresh waiting state
      games[gameId] = freshGame(gameId, game.map || 'home')
      io.to(gameId).emit('roomReset', { gameId })
      io.to(gameId).emit('gameUpdated', safeGamePayload(games[gameId]))
      console.log(`Room ${gameId} reset — all players left`)
    }
  }

  socket.on('leaveGame', ({ gameId }) => {
    if (games[gameId]) {
      clearReadyKickTimer(games[gameId], socket.id)
      if (games[gameId].rematchTimeout && Object.values(games[gameId].players).length === 1) {
        clearTimeout(games[gameId].rematchTimeout)
        games[gameId].rematchTimeout = null
        games[gameId].rematchStartTime = null
      }
      delete games[gameId].players[socket.id];
      rebalanceRolesForWaiting(games[gameId])
      socket.leave(gameId);
      io.to(gameId).emit('gameUpdated', safeGamePayload(games[gameId]));
      checkAndResetIfEmpty(gameId)
    }
  });

  socket.on('disconnecting', () => {
    const rooms = Array.from(socket.rooms);
    for (const room of rooms) {
      if (games[room]) {
        clearReadyKickTimer(games[room], socket.id)
        if (games[room].rematchTimeout && Object.values(games[room].players).length === 1) {
          clearTimeout(games[room].rematchTimeout)
          games[room].rematchTimeout = null
          games[room].rematchStartTime = null
        }
        delete games[room].players[socket.id];
        rebalanceRolesForWaiting(games[room])
        io.to(room).emit('gameUpdated', safeGamePayload(games[room]));
        checkAndResetIfEmpty(room)
      }
    }
  });

  socket.on('endGame', async ({ gameId }) => {
    const game = games[gameId];
    if (!game) return;
    stopTimers(game)
    game.state = 'ended';
    game.endedAt = Date.now()
    io.to(gameId).emit('gameEnded', game);
    try {
      await saveGameResult(game);
    } catch (e) {
      console.warn('save failed', e.message);
    }
  });
});

app.get('/health', (req, res) => res.send({ ok: true }));

app.post('/room/resolve', (req, res) => {
  const requestedGameId = req.body?.gameId || ''
  const map = req.body?.map || 'home'
  const gameId = resolveRoomId(requestedGameId, map)
  if (!games[gameId]) games[gameId] = freshGame(gameId, map)
  res.send({ gameId })
})

app.post('/matchmaking/join', (req, res) => {
  const gameId = findRandomMatchRoom()
  res.send({ gameId })
})

app.post('/auth', (req, res) => {
  const name = req.body.name || 'Anon'
  const userId = makeUserId()
  res.send({ userId, name })
})

app.get('/games', async (req, res) => {
  try {
    const db = await connect()
    if (!db) return res.status(501).send({ error: 'No DB configured' })
    const col = db.collection('games')
    const rows = await col.find({}, { projection: { snapshot: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(50).toArray()
    res.send(rows)
  } catch (e) {
    res.status(500).send({ error: e.message })
  }
})

app.get('/games/:id', async (req, res) => {
  try {
    const db = await connect()
    if (!db) return res.status(501).send({ error: 'No DB configured' })
    const col = db.collection('games')
    const row = await col.findOne({ _id: require('mongodb').ObjectId(req.params.id) })
    if (!row) return res.status(404).send({ error: 'Not found' })
    res.send(row)
  } catch (e) {
    res.status(500).send({ error: e.message })
  }
})

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/socket.io') || req.path.startsWith('/games') || req.path.startsWith('/room') || req.path.startsWith('/matchmaking') || req.path.startsWith('/auth') || req.path === '/health') {
    return next()
  }
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'), (err) => {
    if (err) next()
  })
})

server.listen(PORT, () => console.log('Server running on', PORT));
