import React, { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const apiUrl = (p) => `${API_BASE}${p}`

export default function Lobby({ onJoin, savedName = '', savedMap = 'home' }) {
  const [name, setName] = useState(() => {
    try {
      const raw = sessionStorage.getItem('hs_profile')
      const parsed = raw ? JSON.parse(raw) : null
      return savedName || parsed?.name || ''
    } catch {
      return savedName || ''
    }
  })
  const [map, setMap] = useState(() => {
    try {
      const raw = sessionStorage.getItem('hs_profile')
      const parsed = raw ? JSON.parse(raw) : null
      return savedMap || parsed?.map || 'home'
    } catch {
      return savedMap || 'home'
    }
  })
  const [searchParams] = useSearchParams()
  const urlGameId = searchParams.get('gameId')
  const autoJoin = searchParams.get('autoJoin') === '1'
  const [loading, setLoading] = useState(false)
  const autoStartedRef = useRef(false)

  async function handleStartGame() {
    if (!name.trim()) return
    setLoading(true)
    try {
      const res = await fetch(apiUrl('/auth'), {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ name }) 
      })
      const data = await res.json()

      let resolvedGameId = ''
      if (urlGameId) {
        const rr = await fetch(apiUrl('/room/resolve'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameId: urlGameId, map })
        }).then((r) => r.json())
        resolvedGameId = rr.gameId
      } else {
        const mm = await fetch(apiUrl('/matchmaking/join'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ map })
        }).then((r) => r.json())
        resolvedGameId = mm.gameId
      }

      const resolvedName = data.name || name
      sessionStorage.setItem('hs_profile', JSON.stringify({ name: resolvedName, map }))
      onJoin({ name: resolvedName, role: 'hider', map, gameId: resolvedGameId, userId: data.userId })
    } catch (e) {
      console.error('auth failed', e)
      autoStartedRef.current = false
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!name.trim() || loading || autoStartedRef.current) return
    if (!autoJoin && !urlGameId) return
    autoStartedRef.current = true
    handleStartGame()
  }, [autoJoin, urlGameId, name, loading]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="lobby-container">
      <div className="lobby">
        <h2 style={{ textAlign: 'center' }}>🏠 Multiplayer Hide & Seek</h2>
        <p style={{ textAlign: 'center', marginTop: -4, color: '#5d6b8a', fontSize: '14px' }}>1 seeker + multiple hiders</p>
        
        <label>
          <span>Your Name</span>
          <input 
            value={name} 
            onChange={e => setName(e.target.value)} 
            placeholder="Enter your name" 
            autoFocus
            disabled={loading}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) {
                handleStartGame()
              }
            }}
          />
        </label>
        
        <label>
          <span>Map</span>
          <select value={map} onChange={e => setMap(e.target.value)} disabled={loading}>
            <option value="home">Home</option>
          </select>
        </label>
        
        <button className="btn btn-primary btn-large" onClick={handleStartGame} disabled={loading || !name.trim()}>
          {loading ? '⏳ Joining...' : '▶ Start Game'}
        </button>
        
        <div style={{ 
          marginTop: 12, 
          padding: 12, 
          borderRadius: 8, 
          background: 'rgba(37,99,235,0.08)', 
          fontSize: '13px', 
          textAlign: 'center',
          color: '#475467',
          lineHeight: 1.5
        }}>
          💡 Enter your name and select a map, then click Start Game to begin
        </div>
        
        <p style={{ color: '#5d6b8a', textAlign: 'center', fontSize: '12px', marginTop: 16 }}>
          You'll be randomly matched with other players
        </p>
      </div>
    </div>
  )
}
