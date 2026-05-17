import React, { useState } from 'react'
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom'
import Lobby from './Lobby'
import GameScene from './GameScene'

function AppRoutes() {
  const [opts, setOpts] = useState(null)
  const navigate = useNavigate()

  const handleJoin = (joinOpts) => {
    setOpts(joinOpts)
    navigate(`/game?gameId=${encodeURIComponent(joinOpts.gameId)}`)
  }

  const handleExitGame = () => {
    // Keep the name and map, just clear gameId so we go back to lobby
    setOpts(null)
    navigate('/')
  }

  return (
    <Routes>
      <Route path="/" element={<Lobby onJoin={handleJoin} savedName={opts?.name} savedMap={opts?.map} />} />
      <Route path="/game" element={<GameScene opts={opts} onExit={handleExitGame} />} />
    </Routes>
  )
}

export default function App() {
  return (
    <Router>
      <AppRoutes />
    </Router>
  )
}
