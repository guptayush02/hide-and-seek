import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { io } from 'socket.io-client'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

const WORLD = { minX: -11.5, maxX: 11.5, minZ: -8.5, maxZ: 8.5 }

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v))
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

function createBackNameTag(text, role = 'hider') {
  const canvas = document.createElement('canvas')
  canvas.width = role === 'seeker' ? 320 : 256
  canvas.height = role === 'seeker' ? 160 : 128
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const padX = role === 'seeker' ? 14 : 10
    const padY = role === 'seeker' ? 28 : 24
    const boxW = canvas.width - padX * 2
    const boxH = role === 'seeker' ? 102 : 80
    const radius = role === 'seeker' ? 18 : 14

    ctx.fillStyle = role === 'seeker' ? 'rgba(20, 18, 30, 0.95)' : 'rgba(255,255,255,0.88)'
    ctx.fillRoundRect?.(padX, padY, boxW, boxH, radius)
    if (!ctx.fillRoundRect) ctx.fillRect(padX, padY, boxW, boxH)

    ctx.strokeStyle = role === 'seeker' ? 'rgba(230, 196, 120, 0.95)' : 'rgba(30,40,55,0.75)'
    ctx.lineWidth = role === 'seeker' ? 6 : 4
    if (ctx.roundRect) {
      ctx.beginPath()
      ctx.roundRect(padX, padY, boxW, boxH, radius)
      ctx.stroke()
    } else {
      ctx.strokeRect(padX, padY, boxW, boxH)
    }

    ctx.fillStyle = role === 'seeker' ? '#fff4cf' : '#1f2937'
    ctx.font = role === 'seeker' ? 'bold 44px Arial' : 'bold 34px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const midX = canvas.width / 2
    const midY = role === 'seeker' ? 80 : 66
    ctx.fillText((text || 'Player').slice(0, role === 'seeker' ? 12 : 14), midX, midY)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  texture.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, side: THREE.DoubleSide, alphaTest: 0.08, depthWrite: false })
  const patch = new THREE.Mesh(new THREE.PlaneGeometry(role === 'seeker' ? 1.06 : 0.88, role === 'seeker' ? 0.5 : 0.42), mat)
  const backZ = role === 'hider' ? -0.37 : -0.41
  const backY = role === 'hider' ? 1.05 : 1.04
  patch.position.set(0, backY, backZ) // printed on torso back
  patch.rotation.y = Math.PI
  patch.renderOrder = 3
  return patch
}

function makeCharacter(role, name) {
  const group = new THREE.Group()
  let armL, armR, legL, legR

  if (role === 'hider') {
    // Minion-style hider
    const yellowMat = new THREE.MeshStandardMaterial({ color: 0xf6d54a, roughness: 0.5, metalness: 0.04 })
    const blueMat = new THREE.MeshStandardMaterial({ color: 0x2b63d1, roughness: 0.62, metalness: 0.05 })
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1f2430 })
    const silverMat = new THREE.MeshStandardMaterial({ color: 0xa7adb8, roughness: 0.35, metalness: 0.6 })

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, 0.7, 8, 16), yellowMat)
    body.position.y = 0.92
    group.add(body)

    const overall = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.35, 0.48, 20), blueMat)
    overall.position.y = 0.62
    group.add(overall)

    const strapL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.36, 0.08), blueMat)
    const strapR = strapL.clone()
    strapL.position.set(-0.14, 0.92, 0.28)
    strapR.position.set(0.14, 0.92, 0.28)
    group.add(strapL, strapR)

    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.18, 0.06), blueMat)
    pocket.position.set(0, 0.73, 0.33)
    group.add(pocket)

    const goggleBand = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.03, 8, 24), darkMat)
    goggleBand.rotation.x = Math.PI / 2
    goggleBand.position.set(0, 1.26, 0.23)
    group.add(goggleBand)

    const eyeFrame = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 22), silverMat)
    eyeFrame.rotation.x = Math.PI / 2
    eyeFrame.position.set(0, 1.26, 0.26)
    group.add(eyeFrame)

    const eyeWhite = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.03, 22), new THREE.MeshStandardMaterial({ color: 0xf2f6ff }))
    eyeWhite.rotation.x = Math.PI / 2
    eyeWhite.position.set(0, 1.26, 0.29)
    group.add(eyeWhite)

    const pupil = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 16), darkMat)
    pupil.rotation.x = Math.PI / 2
    pupil.position.set(0, 1.26, 0.305)
    group.add(pupil)

    armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.33, 4, 8), yellowMat)
    armR = armL.clone()
    armL.position.set(-0.42, 0.92, 0)
    armR.position.set(0.42, 0.92, 0)
    group.add(armL, armR)

    legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.38, 4, 8), darkMat)
    legR = legL.clone()
    legL.position.set(-0.14, 0.33, 0)
    legR.position.set(0.14, 0.33, 0)
    group.add(legL, legR)
  } else {
    // villain / king-like seeker model
    const coatMat = new THREE.MeshStandardMaterial({ color: 0x2a1f38, roughness: 0.5, metalness: 0.16 })
    const armorMat = new THREE.MeshStandardMaterial({ color: 0x7a121f, roughness: 0.42, metalness: 0.25 })
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf0c5a7 })
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x161a23 })
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xcda85a, roughness: 0.35, metalness: 0.6 })

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.72, 8, 16), coatMat)
    torso.position.y = 0.96
    group.add(torso)

    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.12), armorMat)
    chest.position.set(0, 1.02, 0.28)
    group.add(chest)

    const shoulderL = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), armorMat)
    const shoulderR = shoulderL.clone()
    shoulderL.position.set(-0.32, 1.2, 0.03)
    shoulderR.position.set(0.32, 1.2, 0.03)
    group.add(shoulderL, shoulderR)

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), skinMat)
    head.position.y = 1.62
    group.add(head)

    const crownBase = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 8, 18), goldMat)
    crownBase.rotation.x = Math.PI / 2
    crownBase.position.set(0, 1.82, 0)
    group.add(crownBase)
    for (let i = 0; i < 5; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 8), goldMat)
      const a = (i / 5) * Math.PI * 2
      spike.position.set(Math.cos(a) * 0.16, 1.89, Math.sin(a) * 0.16)
      group.add(spike)
    }

    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 10), darkMat)
    const eyeR = eyeL.clone()
    eyeL.position.set(-0.075, 1.64, 0.2)
    eyeR.position.set(0.075, 1.64, 0.2)
    group.add(eyeL, eyeR)

    armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.42, 4, 8), coatMat)
    armR = armL.clone()
    armL.position.set(-0.42, 1.02, 0)
    armR.position.set(0.42, 1.02, 0)
    group.add(armL, armR)

    legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 4, 8), darkMat)
    legR = legL.clone()
    legL.position.set(-0.15, 0.42, 0)
    legR.position.set(0.15, 0.42, 0)
    group.add(legL, legR)
  }

  const glow = new THREE.PointLight(role === 'seeker' ? 0xff8a66 : 0x66a3ff, 0, 8)
  glow.position.set(0, 1.2, 0)
  group.add(glow)

  const nameTag = createBackNameTag(name, role)
  group.add(nameTag)

  group.userData = {
    role,
    name,
    parts: { armL, armR, legL, legR },
    glow,
    nameTag,
    targetPos: new THREE.Vector3(0, 0, 0),
    speed: 0,
    caught: false,
    walkT: Math.random() * Math.PI
  }

  return group
}

function addHouse(scene, roomsRef, animRef, obstaclesRef, doorsRef, viewerRole) {
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xe7e2d8, roughness: 0.88, metalness: 0.02 })
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xf3eee7, roughness: 0.96, metalness: 0.01 })
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8f684a, roughness: 0.62, metalness: 0.04 })
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x79b06f, roughness: 1 })
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x7d7f84, roughness: 0.92, metalness: 0.02 })
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xd8d0c4, roughness: 0.9 })
  const pathMat = new THREE.MeshStandardMaterial({ color: 0xb8ab95, roughness: 0.95 })

  // soft sky dome
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(120, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xbfe2ff, side: THREE.BackSide })
  )
  scene.add(sky)

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 18), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)

  // checker tiles for indoor realism
  const tileGroup = new THREE.Group()
  const tileMatA = new THREE.MeshStandardMaterial({ color: 0xdfd9cd, roughness: 0.95 })
  const tileMatB = new THREE.MeshStandardMaterial({ color: 0xebe6dc, roughness: 0.95 })
  for (let x = -11; x <= 11; x += 1) {
    for (let z = -8; z <= 8; z += 1) {
      if (z > 4 && x < -4) continue // skip garden area tiles
      const tile = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), (x + z) % 2 === 0 ? tileMatA : tileMatB)
      tile.rotation.x = -Math.PI / 2
      tile.position.set(x + 0.5, 0.005, z + 0.5)
      tileGroup.add(tile)
    }
  }
  scene.add(tileGroup)

  const grass = new THREE.Mesh(new THREE.PlaneGeometry(9, 6), grassMat)
  grass.rotation.x = -Math.PI / 2
  grass.position.set(-7.5, 0.01, 6)
  grass.receiveShadow = true
  scene.add(grass)

  // outer terrain strip
  const outerGround = new THREE.Mesh(new THREE.PlaneGeometry(60, 44), new THREE.MeshStandardMaterial({ color: 0x7ca774, roughness: 1 }))
  outerGround.rotation.x = -Math.PI / 2
  outerGround.position.set(0, -0.02, 0)
  outerGround.receiveShadow = true
  scene.add(outerGround)

  // front path + porch
  const frontPath = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 3.2), pathMat)
  frontPath.rotation.x = -Math.PI / 2
  frontPath.position.set(0, 0.012, 8.15)
  scene.add(frontPath)
  const porch = new THREE.Mesh(new THREE.BoxGeometry(7, 0.12, 1.7), new THREE.MeshStandardMaterial({ color: 0xb1a086, roughness: 0.9 }))
  porch.position.set(0, 0.06, 8.2)
  porch.receiveShadow = true
  scene.add(porch)

  // stepping stones in garden
  for (let i = 0; i < 5; i++) {
    const stone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.34, 0.06, 10),
      stoneMat
    )
    stone.position.set(-10 + i * 0.75, 0.04, 5.8 + Math.sin(i) * 0.3)
    scene.add(stone)
  }

  function wall(x, y, z, w, h, d, colorMat = wallMat, collidable = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), colorMat)
    m.position.set(x, y, z)
    m.castShadow = true
    m.receiveShadow = true
    scene.add(m)
    if (collidable) {
      obstaclesRef.current.push({
        minX: x - w / 2,
        maxX: x + w / 2,
        minZ: z - d / 2,
        maxZ: z + d / 2,
        active: true
      })
    }
  }

  function addDoor(id, x, z, closedYaw, openYaw) {
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x6e4d36, roughness: 0.75 })
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.2, 0.12), doorMat)
    door.position.set(x, 1.1, z)
    door.rotation.y = openYaw
    door.castShadow = true
    scene.add(door)

    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0xd4b16a, roughness: 0.35, metalness: 0.55 })
    )
    knob.position.set(0.42, 1.06, 0.075)
    door.add(knob)

    const obstacle = {
      minX: x - 0.62,
      maxX: x + 0.62,
      minZ: z - 0.2,
      maxZ: z + 0.2,
      active: false
    }
    obstaclesRef.current.push(obstacle)

    doorsRef.current.push({
      id,
      mesh: door,
      closedYaw,
      openYaw,
      targetYaw: openYaw,
      isClosed: false,
      obstacle
    })
  }

  const WALL_H = 4.6
  const WALL_Y = WALL_H / 2

  // Outer shell
  wall(0, WALL_Y, -9, 24, WALL_H, 0.3)
  wall(0, WALL_Y, 9, 24, WALL_H, 0.3)
  wall(-12, WALL_Y, 0, 0.3, WALL_H, 18)
  wall(12, WALL_Y, 0, 0.3, WALL_H, 18)

  // Internal walls with door gaps
  wall(-4, WALL_Y, -4.5, 0.3, WALL_H, 9)
  wall(-4, WALL_Y, 5.2, 0.3, WALL_H, 5.6)
  wall(4, WALL_Y, -5.2, 0.3, WALL_H, 5.6)
  wall(4, WALL_Y, 4.5, 0.3, WALL_H, 9)

  wall(0, WALL_Y, -3.7, 8, WALL_H, 0.3)
  wall(0, WALL_Y, 3.7, 8, WALL_H, 0.3)

  // skirting trims (baseboards)
  wall(0, 0.12, -8.72, 23.3, 0.12, 0.2, trimMat, false)
  wall(0, 0.12, 8.72, 23.3, 0.12, 0.2, trimMat, false)
  wall(-11.72, 0.12, 0, 0.2, 0.12, 17.4, trimMat, false)
  wall(11.72, 0.12, 0, 0.2, 0.12, 17.4, trimMat, false)

  // interactive doors (default open)
  addDoor('door_west', -4, 0.35, Math.PI / 2, 0)
  addDoor('door_east', 4, -0.35, Math.PI / 2, 0)

  // Balcony rails
  wall(8, 0.7, 7.2, 7, 1.4, 0.15, woodMat)
  wall(4.6, 0.7, 6, 0.15, 1.4, 2.5, woodMat)
  wall(11.4, 0.7, 6, 0.15, 1.4, 2.5, woodMat)

  // simple windows
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xa8d8ff, transparent: true, opacity: 0.55, roughness: 0.1, metalness: 0.2 })
  const w1 = new THREE.Mesh(new THREE.BoxGeometry(2, 1.1, 0.05), glassMat)
  w1.position.set(-8, 1.4, -8.82)
  scene.add(w1)
  const w2 = new THREE.Mesh(new THREE.BoxGeometry(2, 1.1, 0.05), glassMat)
  w2.position.set(8, 1.4, -8.82)
  scene.add(w2)

  // window frames
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.75 })
  const addWindowFrame = (x, z) => {
    wall(x, 1.95, z, 2.15, 0.08, 0.08, frameMat, false)
    wall(x, 0.85, z, 2.15, 0.08, 0.08, frameMat, false)
    wall(x - 1.05, 1.4, z, 0.08, 1.1, 0.08, frameMat, false)
    wall(x + 1.05, 1.4, z, 0.08, 1.1, 0.08, frameMat, false)
    wall(x, 1.4, z, 0.06, 1.1, 0.08, frameMat, false)
  }
  addWindowFrame(-8, -8.79)
  addWindowFrame(8, -8.79)

  // Furniture
  wall(-8.6, 0.45, -7.2, 2.8, 0.9, 0.8, woodMat)
  wall(-7.2, 0.45, -6.3, 0.8, 0.9, 2.6, woodMat)
  wall(8.2, 0.35, -6.8, 2.7, 0.7, 1.8, new THREE.MeshStandardMaterial({ color: 0x507d9a }))
  wall(0, 0.35, 0.8, 2.4, 0.7, 1.2, new THREE.MeshStandardMaterial({ color: 0x717b8f }))
  wall(0, 0.8, 0.2, 2.4, 0.5, 0.4, new THREE.MeshStandardMaterial({ color: 0x6b7488 }))

  // living room rug
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 2.2), new THREE.MeshStandardMaterial({ color: 0x9d5f52, roughness: 0.95 }))
  rug.rotation.x = -Math.PI / 2
  rug.position.set(0, 0.014, 1.2)
  scene.add(rug)

  // dining table + chairs
  wall(-1.6, 0.42, -1.2, 1.7, 0.84, 1.1, new THREE.MeshStandardMaterial({ color: 0x8a6a54 }))
  wall(-2.5, 0.25, -1.8, 0.5, 0.5, 0.5, new THREE.MeshStandardMaterial({ color: 0x796556 }))
  wall(-0.7, 0.25, -1.8, 0.5, 0.5, 0.5, new THREE.MeshStandardMaterial({ color: 0x796556 }))
  wall(-2.5, 0.25, -0.6, 0.5, 0.5, 0.5, new THREE.MeshStandardMaterial({ color: 0x796556 }))
  wall(-0.7, 0.25, -0.6, 0.5, 0.5, 0.5, new THREE.MeshStandardMaterial({ color: 0x796556 }))

  // Garden tree
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.1, 8), new THREE.MeshStandardMaterial({ color: 0x6b4c32 }))
  trunk.position.set(-9.2, 0.55, 7.2)
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 12), new THREE.MeshStandardMaterial({ color: 0x4f8a4b }))
  crown.position.set(-9.2, 1.5, 7.2)
  trunk.castShadow = true
  crown.castShadow = true
  scene.add(trunk, crown)

  // bushes + flower beds
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x4f8f48, roughness: 1 })
  const flowerMat = new THREE.MeshStandardMaterial({ color: 0xd65f7a, roughness: 0.75 })
  for (let i = 0; i < 7; i++) {
    const bx = -11 + i * 1.7
    const bush = new THREE.Mesh(new THREE.SphereGeometry(0.34 + (i % 2) * 0.06, 12, 10), bushMat)
    bush.position.set(bx, 0.28, 8.55)
    bush.castShadow = true
    scene.add(bush)
    if (i % 2 === 0) {
      const flower = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), flowerMat)
      flower.position.set(bx + 0.2, 0.22, 8.25)
      scene.add(flower)
    }
  }

  // lamp posts (animated warm lights)
  const lamp1 = new THREE.PointLight(0xffddaa, 0.7, 8)
  lamp1.position.set(0, 2.2, 0)
  scene.add(lamp1)
  const lamp2 = new THREE.PointLight(0xffc98f, 0.45, 7)
  lamp2.position.set(8, 1.8, 6)
  scene.add(lamp2)
  animRef.current.lamps = [lamp1, lamp2]

  // Ceiling fan (animated)
  const fan = new THREE.Group()
  const fanRod = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 8), new THREE.MeshStandardMaterial({ color: 0x2b2d31 }))
  fanRod.position.y = 2.2
  fan.add(fanRod)
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), new THREE.MeshStandardMaterial({ color: 0x2b2d31 }))
  hub.position.y = 1.85
  fan.add(hub)
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.14), woodMat)
    blade.position.y = 1.85
    blade.rotation.y = (Math.PI / 2) * i
    blade.position.x = Math.cos(blade.rotation.y) * 0.5
    blade.position.z = Math.sin(blade.rotation.y) * 0.5
    fan.add(blade)
  }
  scene.add(fan)
  animRef.current.fan = fan

  // clouds for atmosphere
  const clouds = []
  for (let i = 0; i < 4; i++) {
    const cloud = new THREE.Group()
    const baseX = -16 + i * 9
    const baseZ = -14 + (i % 2) * 7
    for (let j = 0; j < 4; j++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(1 + Math.random() * 0.5, 10, 10),
        new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })
      )
      puff.position.set(j * 0.8, Math.random() * 0.4, (Math.random() - 0.5) * 0.6)
      cloud.add(puff)
    }
    cloud.position.set(baseX, 9 + Math.random() * 2, baseZ)
    scene.add(cloud)
    clouds.push(cloud)
  }
  animRef.current.clouds = clouds

  // Room centers + hide spots
  const roomDefs = [
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

  roomDefs.forEach((r) => {
    // blue glowing floor disc
    const spotMat = new THREE.MeshStandardMaterial({ color: 0x1a7fff, emissive: 0x0055cc, emissiveIntensity: 0.6, transparent: true, opacity: 0.85 })
    const spot = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 24), spotMat)
    spot.position.set(r.x, 0.04, r.z)
    spot.visible = viewerRole === 'hider'
    scene.add(spot)

    // outer ring
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x55aaff, emissive: 0x2277ff, emissiveIntensity: 0.5, transparent: true, opacity: 0.55 })
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.06, 8, 28), ringMat)
    ring.rotation.x = Math.PI / 2
    ring.position.set(r.x, 0.06, r.z)
    ring.visible = viewerRole === 'hider'
    scene.add(ring)

    // floating H label
    const canvas = document.createElement('canvas')
    canvas.width = 128; canvas.height = 128
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, 128, 128)
    ctx.fillStyle = 'rgba(20,100,255,0.85)'
    ctx.beginPath(); ctx.arc(64, 64, 50, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 60px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('H', 64, 68)
    const tex = new THREE.CanvasTexture(canvas)
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
    label.scale.set(0.7, 0.7, 1)
    label.position.set(r.x, 1.2, r.z)
    label.visible = viewerRole === 'hider'
    scene.add(label)

    roomsRef.current.push({ name: r.name, pos: new THREE.Vector3(r.x, 0, r.z), spot, ring, label })
  })

  // layered roof for more realistic silhouette
  const roofBaseMat = new THREE.MeshStandardMaterial({ color: 0xc9bbac, roughness: 0.88 })
  const roofTileMat = new THREE.MeshStandardMaterial({ color: 0x9a6c55, roughness: 0.84 })
  const roofBase = new THREE.Mesh(new THREE.BoxGeometry(24.3, 0.2, 18.3), roofBaseMat)
  roofBase.position.set(0, WALL_H + 0.16, 0)
  roofBase.castShadow = true
  scene.add(roofBase)

  const roofSlopeL = new THREE.Mesh(new THREE.BoxGeometry(12.2, 0.2, 18.0), roofTileMat)
  roofSlopeL.position.set(-6.05, WALL_H + 0.8, 0)
  roofSlopeL.rotation.z = 0.18
  roofSlopeL.castShadow = true
  scene.add(roofSlopeL)

  const roofSlopeR = new THREE.Mesh(new THREE.BoxGeometry(12.2, 0.2, 18.0), roofTileMat)
  roofSlopeR.position.set(6.05, WALL_H + 0.8, 0)
  roofSlopeR.rotation.z = -0.18
  roofSlopeR.castShadow = true
  scene.add(roofSlopeR)

  const ridge = new THREE.Mesh(new THREE.BoxGeometry(24.0, 0.16, 0.4), new THREE.MeshStandardMaterial({ color: 0x8d5f47, roughness: 0.8 }))
  ridge.position.set(0, WALL_H + 1.82, 0)
  scene.add(ridge)
}

function collidesStatic(x, z, obstacles, radius = 0.28) {
  for (const o of obstacles) {
    if (o.active === false) continue
    const cx = clamp(x, o.minX, o.maxX)
    const cz = clamp(z, o.minZ, o.maxZ)
    const dx = x - cx
    const dz = z - cz
    if ((dx * dx + dz * dz) < radius * radius) return true
  }
  return false
}

function staticCollisionSeverity(x, z, obstacles, radius = 0.28) {
  let severity = 0
  for (const o of obstacles) {
    if (o.active === false) continue
    const cx = clamp(x, o.minX, o.maxX)
    const cz = clamp(z, o.minZ, o.maxZ)
    const dx = x - cx
    const dz = z - cz
    const d = Math.sqrt(dx * dx + dz * dz)
    if (d < radius) {
      severity = Math.max(severity, radius - d)
    }
  }
  return severity
}

function isBlocked(x, z) {
  // keep only hard world bounds here; interior collision handled by collidesStatic()
  return (x <= WORLD.minX || x >= WORLD.maxX || z <= WORLD.minZ || z >= WORLD.maxZ)
}

export default function GameScene({ opts }) {
  const mountRef = useRef(null)
  const socketRef = useRef(null)
  const sceneRef = useRef(null)
  const cameraRef = useRef(null)
  const rendererRef = useRef(null)
  const localIdRef = useRef(null)
  const playersRef = useRef({})
  const roomsRef = useRef([])
  const doorsRef = useRef([])
  const obstaclesRef = useRef([])
  const animRef = useRef({ fan: null, lamps: [], clouds: [], sun: null, fill: null })
  const rafRef = useRef({ render: 0, move: 0 })
  const keysRef = useRef({})
  const physicsRef = useRef({ y: 0, vy: 0, crouch: false })
  const lastEmitRef = useRef(0)
  const fpRef = useRef({ yaw: 0, pitch: 0, locked: false })
  const roleRef = useRef(opts.role || 'hider')
  const preferredRoleRef = useRef(opts.role === 'seeker' ? 'seeker' : 'hider')
  const cameraModeRef = useRef('third')

  const [phase, setPhase] = useState('connecting')
  const [phaseRemaining, setPhaseRemaining] = useState(0)
  const [hiddenRoom, setHiddenRoom] = useState('none')
  const [nearInfo, setNearInfo] = useState(null)
  const [caughtMsg, setCaughtMsg] = useState('')
  const [winner, setWinner] = useState('')
  const [playersUi, setPlayersUi] = useState([])
  const [cameraMode, setCameraMode] = useState('third')
  const [myRole, setMyRole] = useState(opts.role || 'hider')
  const [preferredRole, setPreferredRole] = useState(opts.role === 'seeker' ? 'seeker' : 'hider')
  const [myReady, setMyReady] = useState(false)
  const [myRematchRequested, setMyRematchRequested] = useState(false)
  const [myHidden, setMyHidden] = useState(false)
  const [reportText, setReportText] = useState('')
  const [showControlsModal, setShowControlsModal] = useState(false)
  const [showMobileControls, setShowMobileControls] = useState(false)
  const [playAgainAutoCountdown, setPlayAgainAutoCountdown] = useState(0)
  const [playAgainCountdown, setPlayAgainCountdown] = useState(0)
  const [isSearchingRoom, setIsSearchingRoom] = useState(false)
  const myHiddenRef = useRef(false)
  const pollingRef = useRef(null)
  const autoPlayTimerRef = useRef(null)

  const gameId = useMemo(() => opts.gameId || 'room1', [opts.gameId])
  const resolveRole = (player) => {
    const raw = (player?.role || player?.assignedRole || player?.preferredRole || 'hider').toString().toLowerCase()
    return raw === 'seeker' ? 'seeker' : 'hider'
  }

  const cycleCameraMode = () => {
    setCameraMode((prev) => {
      const next = prev === 'first' ? 'third' : prev === 'third' ? 'top' : 'first'
      cameraModeRef.current = next
      return next
    })
  }

  useEffect(() => {
    const updateTouchMode = () => {
      if (typeof window === 'undefined') return
      const coarse = window.matchMedia?.('(pointer: coarse)').matches
      const narrow = window.matchMedia?.('(max-width: 900px)').matches
      const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
      setShowMobileControls(!!(touch && (coarse || narrow)))
    }
    updateTouchMode()
    window.addEventListener('resize', updateTouchMode)
    return () => window.removeEventListener('resize', updateTouchMode)
  }, [])

  const startHoldKey = (key) => (e) => {
    e.preventDefault?.()
    keysRef.current[key] = true
  }

  const stopHoldKey = (key) => (e) => {
    e.preventDefault?.()
    keysRef.current[key] = false
  }

  useEffect(() => {
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xd7ecff)
    scene.fog = new THREE.Fog(0xd7ecff, 22, 48)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(75, mountRef.current.clientWidth / mountRef.current.clientHeight, 0.1, 1000)
    camera.position.set(0, 1.6, 0)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.02
    renderer.physicallyCorrectLights = true
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight)
    mountRef.current.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const hemi = new THREE.HemisphereLight(0xf3f6ff, 0x64815f, 0.58)
    scene.add(hemi)
    const sun = new THREE.DirectionalLight(0xfff4df, 1.25)
    sun.position.set(16, 22, 12)
    sun.castShadow = true
    sun.shadow.mapSize.width = 2048
    sun.shadow.mapSize.height = 2048
    sun.shadow.radius = 3
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 70
    sun.shadow.camera.left = -22
    sun.shadow.camera.right = 22
    sun.shadow.camera.top = 20
    sun.shadow.camera.bottom = -20
    scene.add(sun)

    const fill = new THREE.DirectionalLight(0xbfd9ff, 0.25)
    fill.position.set(-12, 10, -10)
    scene.add(fill)
    animRef.current.sun = sun
    animRef.current.fill = fill

    addHouse(scene, roomsRef, animRef, obstaclesRef, doorsRef, 'hider')

    const applyDoorStates = (doorStates = {}) => {
      doorsRef.current.forEach((d) => {
        const closed = !!doorStates[d.id]
        d.isClosed = closed
        d.targetYaw = closed ? d.closedYaw : d.openYaw
        if (d.obstacle) d.obstacle.active = closed
      })
    }

    const applyPlayerHiddenState = (playerId, hidden, isSelf) => {
      const entry = playersRef.current[playerId]
      if (!entry?.mesh) return
      entry.mesh.traverse((obj) => {
        if (!obj.isMesh && !obj.isSprite) return
        const shouldHideFromViewer = hidden && roleRef.current === 'seeker' && !isSelf
        obj.visible = !shouldHideFromViewer
        if (obj.material) {
          if (shouldHideFromViewer) {
            obj.material.transparent = true
            obj.material.opacity = 0
          } else if (hidden) {
            obj.material.transparent = true
            obj.material.opacity = isSelf ? 0.28 : 0.45
          } else {
            obj.material.transparent = false
            obj.material.opacity = 1
          }
        }
      })
    }

    const socket = io(API_BASE || undefined)
    socketRef.current = socket

    socket.on('connect', () => {
      localIdRef.current = socket.id
      setPhase('waiting')
      socket.emit('createGame', { gameId, map: opts.map || 'home' })
      socket.emit('joinGame', { gameId, name: opts.name, role: preferredRoleRef.current, userId: opts.userId })
    })

    socket.on('gameUpdated', (game) => {
      if (!game?.players) return
      setPhase(game.state || 'waiting')
      if (typeof game.phaseRemaining === 'number') setPhaseRemaining(game.phaseRemaining)

      const entries = Object.values(game.players)
      const normalizedEntries = entries.map((p) => ({ ...p, role: resolveRole(p) }))
      setPlayersUi(normalizedEntries)

      // server can shuffle hide spot locations each match
      if (Array.isArray(game.hideSpots) && game.hideSpots.length) {
        game.hideSpots.forEach((hs) => {
          const spot = roomsRef.current.find((r) => r.name === hs.name)
          if (!spot) return
          spot.pos.set(hs.x, 0, hs.z)
          if (spot.spot) spot.spot.position.set(hs.x, spot.spot.position.y, hs.z)
          if (spot.ring) spot.ring.position.set(hs.x, spot.ring.position.y, hs.z)
          if (spot.label) spot.label.position.set(hs.x, spot.label.position.y, hs.z)
        })
      }

      const meData = game.players[localIdRef.current]
      if (meData) {
        roleRef.current = meData.role || roleRef.current
        setMyRole(roleRef.current)
        setMyReady(!!meData.ready)
        setMyRematchRequested(!!meData.rematchRequested)
        if (meData.preferredRole) {
          preferredRoleRef.current = meData.preferredRole
          setPreferredRole(meData.preferredRole)
        }
      }

      const showHideMarkers = roleRef.current === 'hider'
      roomsRef.current.forEach((r) => {
        if (r.spot) r.spot.visible = showHideMarkers
        if (r.ring) r.ring.visible = showHideMarkers
        if (r.label) r.label.visible = showHideMarkers
      })

      const seen = new Set()
      normalizedEntries.forEach((p) => {
        seen.add(p.id)
        if (!playersRef.current[p.id]) {
          const mesh = makeCharacter(p.role, p.name)
          mesh.position.set(p.pos?.x || 0, 0, p.pos?.z || 0)
          mesh.userData.targetPos.set(p.pos?.x || 0, 0, p.pos?.z || 0)
          scene.add(mesh)
          playersRef.current[p.id] = { mesh, role: p.role, name: p.name, caught: !!p.caught }
        }
        const item = playersRef.current[p.id]

        // if server reassigned role, rebuild mesh with correct model (minion/villain)
        if (item.role !== p.role) {
          const oldMesh = item.mesh
          const newMesh = makeCharacter(p.role, p.name)
          newMesh.position.copy(oldMesh.position)
          newMesh.rotation.copy(oldMesh.rotation)
          newMesh.userData.targetPos.copy(oldMesh.userData.targetPos)
          newMesh.userData.speed = oldMesh.userData.speed || 0
          newMesh.userData.caught = !!p.caught
          scene.remove(oldMesh)
          scene.add(newMesh)
          item.mesh = newMesh
        }

        item.role = p.role
        item.name = p.name
        item.caught = !!p.caught
        item.mesh.userData.targetPos.set(p.pos?.x || 0, 0, p.pos?.z || 0)
        item.mesh.userData.caught = !!p.caught
        if (item.mesh.userData.name !== p.name) {
          item.mesh.userData.name = p.name
          if (item.mesh.userData.nameTag) item.mesh.remove(item.mesh.userData.nameTag)
          const nt = createBackNameTag(p.name, p.role || item.role || 'hider')
          item.mesh.userData.nameTag = nt
          item.mesh.add(nt)
        }
        applyPlayerHiddenState(p.id, !!p.hidden, p.id === localIdRef.current)
      })

      applyDoorStates(game.doorStates || {})

      for (const id of Object.keys(playersRef.current)) {
        if (!seen.has(id)) {
          scene.remove(playersRef.current[id].mesh)
          delete playersRef.current[id]
        }
      }
    })

    socket.on('phaseChanged', ({ state, remaining }) => {
      setPhase(state)
      setPhaseRemaining(remaining || 0)
    })

    socket.on('phaseTick', ({ state, remaining }) => {
      setPhase(state)
      setPhaseRemaining(remaining || 0)
    })

    socket.on('playerMoved', ({ id, pos, role }) => {
      if (!playersRef.current[id]) {
        const mesh = makeCharacter(role || 'hider', 'Player')
        mesh.position.set(pos?.x || 0, pos?.y || 0, pos?.z || 0)
        mesh.userData.targetPos.set(pos?.x || 0, pos?.y || 0, pos?.z || 0)
        scene.add(mesh)
        playersRef.current[id] = { mesh, role: role || 'hider', name: 'Player', caught: false }
        return
      }
      playersRef.current[id].mesh.userData.targetPos.set(pos?.x || 0, pos?.y || 0, pos?.z || 0)
    })

    socket.on('roomReset', () => {
      setPhase('waiting')
      setPhaseRemaining(0)
      setHiddenRoom('none')
      setMyHidden(false)
      setMyRematchRequested(false)
      myHiddenRef.current = false
      setWinner('')
      setCaughtMsg('')
      setReportText('')
      setNearInfo(null)
      // remove all player meshes
      for (const id of Object.keys(playersRef.current)) {
        scene.remove(playersRef.current[id].mesh)
        delete playersRef.current[id]
      }
      // re-join fresh
      socket.emit('joinGame', { gameId, name: opts.name, role: preferredRoleRef.current, userId: opts.userId })
    })

    socket.on('removedFromRoom', ({ reason }) => {
      setCaughtMsg(reason === 'not_ready_timeout' ? 'You were removed: not ready within 10 seconds.' : 'You were removed from room.')
      setTimeout(() => {
        window.location.reload()
      }, 1200)
    })

    socket.on('movedToRoom', ({ gameId: newGameId, reason }) => {
      // User is being moved to another room (play-again timeout)
      if (reason === 'rematch_timeout' || reason === 'solo_rematch_timeout') {
        setCaughtMsg('Moved to another waiting room...')
        // Store the new gameId and redirect to rejoin with that room
        setTimeout(() => {
          window.location.href = `/?gameId=${encodeURIComponent(newGameId)}&autoJoin=1`
        }, 800)
      }
    })

    socket.on('roomList', ({ rooms }) => {
      if (rooms && rooms.length > 0) {
        // Found a room — stop polling and auto-join
        if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
        setIsSearchingRoom(false)
        window.location.href = `/?gameId=${encodeURIComponent(rooms[0].gameId)}&autoJoin=1`
      }
      // If no rooms found, keep polling (interval will retry)
    })

    socket.on('doorStateChanged', ({ doorId, closed }) => {
      const d = doorsRef.current.find((it) => it.id === doorId)
      if (!d) return
      d.isClosed = !!closed
      d.targetYaw = d.isClosed ? d.closedYaw : d.openYaw
      d.obstacle.active = d.isClosed
    })

    socket.on('proximity', ({ seekerId, hiderId, distance, near }) => {
      const me = localIdRef.current
      if (seekerId === me || hiderId === me) {
        setNearInfo(near ? `Opponent nearby (${distance.toFixed(1)}m)` : null)
      }
    })

    socket.on('playerCaught', ({ id, seekerName, hiderName }) => {
      const p = playersRef.current[id]
      if (p) p.mesh.userData.caught = true
      const msg = `${seekerName || 'Seeker'} caught ${hiderName || 'Hider'}`
      setCaughtMsg(msg)
      setTimeout(() => setCaughtMsg(''), 1800)
    })

    socket.on('teleportDetected', () => {
      setCaughtMsg('Anti-cheat: movement too fast, update rejected')
      setTimeout(() => setCaughtMsg(''), 1800)
    })

    socket.on('gameEnded', (payload) => {
      setPhase('ended')
      setWinner(payload?.winner || 'unknown')
    })

    socket.on('hiddenStateChanged', ({ id, hidden, location }) => {
      applyPlayerHiddenState(id, !!hidden, id === localIdRef.current)
      if (id === localIdRef.current) {
        myHiddenRef.current = !!hidden
        setMyHidden(!!hidden)
        setHiddenRoom(hidden ? (location || 'spot') : 'none')
      }
    })

    socket.on('hideRejected', ({ reason, nearest }) => {
      setCaughtMsg(`Hide failed: ${reason}${nearest ? ` (near ${nearest})` : ''}`)
      setTimeout(() => setCaughtMsg(''), 1800)
    })

    socket.on('catchAttemptResult', ({ ok, reason, distance, allowed }) => {
      if (ok) return
      if (reason === 'too_far') {
        setCaughtMsg(`Catch failed: too far (${distance?.toFixed?.(2)} > ${allowed})`)
      } else if (reason === 'not_seeker') {
        setCaughtMsg('Catch failed: only seeker can catch')
      } else if (reason === 'not_seeking') {
        setCaughtMsg('Catch failed: can catch only in seeking phase')
      } else {
        setCaughtMsg('Catch failed: no valid target')
      }
      setTimeout(() => setCaughtMsg(''), 1400)
    })

    socket.on('catchReported', ({ text }) => {
      setReportText(text || 'I caught someone!')
      setTimeout(() => setReportText(''), 2200)
    })

    const onResize = () => {
      if (!mountRef.current || !cameraRef.current || !rendererRef.current) return
      cameraRef.current.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight
      cameraRef.current.updateProjectionMatrix()
      rendererRef.current.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight)
    }
    window.addEventListener('resize', onResize)

    const resetInputState = () => {
      keysRef.current = {}
    }

    const onKey = (e) => {
      const target = e.target
      const tag = target?.tagName?.toLowerCase?.()
      const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable
      if (isTyping) return

      keysRef.current[e.key.toLowerCase()] = e.type === 'keydown'
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault()
      }
      if (e.type === 'keydown' && e.key.toLowerCase() === 'h') {
        toggleHideAtSpot()
      }
      if (e.type === 'keydown' && e.key.toLowerCase() === 'c') {
        cycleCameraMode()
      }
      if (e.type === 'keydown' && e.key.toLowerCase() === 'f') {
        catchAndReport()
      }
      if (e.type === 'keydown' && e.code === 'Space') {
        jumpAction()
      }
      if (e.type === 'keydown' && e.key.toLowerCase() === 'x') {
        toggleCrouchAction()
      }
      if (e.type === 'keydown' && e.key.toLowerCase() === 'e') {
        toggleNearestDoorAction()
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', resetInputState)

    const onVisibilityChange = () => {
      if (document.hidden) resetInputState()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    const onPointerLockChange = () => {
      fpRef.current.locked = document.pointerLockElement === renderer.domElement
      if (!fpRef.current.locked) resetInputState()
    }
    const onMouseMove = (e) => {
      if (!fpRef.current.locked) return
      const sens = 0.0022
      fpRef.current.yaw -= e.movementX * sens
      fpRef.current.pitch -= e.movementY * sens
      const mode = cameraModeRef.current
      if (mode === 'first') fpRef.current.pitch = clamp(fpRef.current.pitch, -1.35, 1.35)
      else if (mode === 'third') fpRef.current.pitch = clamp(fpRef.current.pitch, -0.8, 0.6)
      else fpRef.current.pitch = clamp(fpRef.current.pitch, -0.4, 0.4)
    }
    const lockPointer = () => {
      if (document.pointerLockElement !== renderer.domElement) {
        renderer.domElement.requestPointerLock?.()
      }
    }
    renderer.domElement.addEventListener('click', lockPointer)
    document.addEventListener('pointerlockchange', onPointerLockChange)
    document.addEventListener('mousemove', onMouseMove)

    const isCameraBlocked = (x, z) => {
      const outOfBounds = x < WORLD.minX || x > WORLD.maxX || z < WORLD.minZ || z > WORLD.maxZ
      return outOfBounds || collidesStatic(x, z, obstaclesRef.current, 0.12)
    }

    const traceSafeCamera = (fromX, fromY, fromZ, toX, toY, toZ) => {
      let safeX = fromX
      let safeY = fromY
      let safeZ = fromZ
      const steps = 20
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        const x = fromX + (toX - fromX) * t
        const y = fromY + (toY - fromY) * t
        const z = fromZ + (toZ - fromZ) * t
        if (isCameraBlocked(x, z)) break
        safeX = x
        safeY = y
        safeZ = z
      }
      return { x: safeX, y: safeY, z: safeZ }
    }

    const clock = new THREE.Clock()
    const renderLoop = () => {
      const dt = Math.min(clock.getDelta(), 0.033)
      const t = clock.elapsedTime
      if (animRef.current.fan) animRef.current.fan.rotation.y += dt * 10

      // animate lamps flicker + clouds drift + hide-spot pulse
      if (animRef.current.lamps?.length) {
        animRef.current.lamps.forEach((lamp, i) => {
          lamp.intensity = 0.45 + Math.sin(clock.elapsedTime * (3 + i)) * 0.08
        })
      }
      if (animRef.current.clouds?.length) {
        animRef.current.clouds.forEach((cloud, i) => {
          cloud.position.x += dt * (0.35 + i * 0.04)
          if (cloud.position.x > 18) cloud.position.x = -18
        })
      }
      if (animRef.current.sun) {
        animRef.current.sun.position.x = 16 + Math.sin(t * 0.08) * 3
        animRef.current.sun.position.y = 22 + Math.cos(t * 0.06) * 1.4
        animRef.current.sun.intensity = 1.2 + Math.sin(t * 0.04) * 0.1
      }
      if (animRef.current.fill) {
        animRef.current.fill.intensity = 0.22 + Math.sin(t * 0.07) * 0.03
      }
      if (doorsRef.current.length) {
        doorsRef.current.forEach((d) => {
          if (!d.mesh) return
          const targetYaw = typeof d.targetYaw === 'number' ? d.targetYaw : d.openYaw
          const diff = normalizeAngle(targetYaw - d.mesh.rotation.y)
          const step = Math.sign(diff) * Math.min(Math.abs(diff), dt * 3.4)
          d.mesh.rotation.y += step
          const nearClosed = Math.abs(normalizeAngle(d.mesh.rotation.y - d.closedYaw)) < 0.14
          if (d.obstacle) d.obstacle.active = nearClosed
        })
      }
      if (roomsRef.current.length) {
        const pulse = 0.45 + Math.sin(clock.elapsedTime * 2.8) * 0.35
        const ringPulse = 0.35 + Math.sin(clock.elapsedTime * 2.8 + 0.8) * 0.25
        const labelScale = 0.65 + Math.sin(clock.elapsedTime * 2.8) * 0.08
        roomsRef.current.forEach((r) => {
          if (r.spot?.material) r.spot.material.emissiveIntensity = pulse
          if (r.ring?.material) r.ring.material.emissiveIntensity = ringPulse
          if (r.label) r.label.scale.set(labelScale, labelScale, 1)
        })
      }

      const localId = localIdRef.current
      const local = localId ? playersRef.current[localId] : null
      const localPos = local?.mesh?.position

      if (local?.mesh) {
        const lx = local.mesh.position.x
        const lz = local.mesh.position.z
        const mode = cameraModeRef.current

        if (mode === 'first') {
          const eyeBase = physicsRef.current.crouch ? 1.15 : 1.5
          const eyeY = eyeBase + local.mesh.position.y
          camera.position.set(lx, eyeY, lz)
          camera.rotation.order = 'YXZ'
          camera.rotation.y = fpRef.current.yaw
          camera.rotation.x = fpRef.current.pitch
        } else if (mode === 'third') {
          const maxDist = 3.2
          const eyeY = 1.9
          const camY = eyeY - fpRef.current.pitch * 1.7
          const dirX = Math.sin(fpRef.current.yaw)
          const dirZ = Math.cos(fpRef.current.yaw)
          // pull camera in if it would clip through a wall
          let safeDist = maxDist
          for (let d = maxDist; d >= 0.5; d -= 0.15) {
            const cx = lx + dirX * d
            const cz = lz + dirZ * d
            const inWall = collidesStatic(cx, cz, obstaclesRef.current, 0.12)
            const outOfBounds = cx < WORLD.minX || cx > WORLD.maxX || cz < WORLD.minZ || cz > WORLD.maxZ
            if (!inWall && !outOfBounds) { safeDist = d; break }
          }
          const desiredX = lx - dirX * safeDist
          const desiredY = camY + local.mesh.position.y
          const desiredZ = lz - dirZ * safeDist
          const anchorY = 1.35 + local.mesh.position.y
          const safeCam = traceSafeCamera(lx, anchorY, lz, desiredX, desiredY, desiredZ)
          camera.position.set(safeCam.x, safeCam.y, safeCam.z)
          camera.lookAt(lx, 1.25 + local.mesh.position.y, lz)
        } else {
          const radius = 7
          const tx = lx + Math.sin(fpRef.current.yaw) * radius
          const tz = lz + Math.cos(fpRef.current.yaw) * radius
          camera.position.set(tx, 8.5 + local.mesh.position.y, tz)
          camera.lookAt(lx, 0.8 + local.mesh.position.y, lz)
        }
      }

      for (const id of Object.keys(playersRef.current)) {
        const entry = playersRef.current[id]
        const mesh = entry.mesh
        const target = mesh.userData.targetPos

        if (id !== localId) {
          const before = mesh.position.clone()
          mesh.position.lerp(target, 0.2)
          const moved = before.distanceTo(mesh.position)
          mesh.userData.speed = moved / Math.max(dt, 0.001)
        }

        const vel = new THREE.Vector3(target.x - mesh.position.x, 0, target.z - mesh.position.z)
        if (vel.lengthSq() > 0.0005) mesh.rotation.y = Math.atan2(vel.x, vel.z)

        const parts = mesh.userData.parts
        mesh.userData.walkT += dt * (mesh.userData.speed > 0.02 ? 10 : 2)
        const amp = mesh.userData.speed > 0.02 ? 0.45 : 0.08
        if (!mesh.userData.caught) {
          const moving = mesh.userData.speed > 0.02
          const walkSine = Math.sin(mesh.userData.walkT)
          const walkCos = Math.cos(mesh.userData.walkT)
          const role = mesh.userData.role
          const armMul = role === 'hider' ? 0.75 : 1
          const legMul = role === 'hider' ? 0.9 : 1

          parts.legL.rotation.x = walkSine * amp * legMul
          parts.legR.rotation.x = -walkSine * amp * legMul
          parts.armL.rotation.x = -walkSine * amp * armMul
          parts.armR.rotation.x = walkSine * amp * armMul

          // subtle realism layers: breathing sway + minion wobble
          mesh.rotation.z = moving ? walkCos * (role === 'hider' ? 0.045 : 0.02) : Math.sin(t * 1.4 + mesh.userData.walkT * 0.3) * 0.01
          parts.armL.rotation.z = Math.sin(t * 2 + mesh.userData.walkT * 0.3) * 0.04
          parts.armR.rotation.z = -Math.sin(t * 2 + mesh.userData.walkT * 0.3) * 0.04
          mesh.rotation.x = 0
        } else {
          mesh.rotation.x = -Math.PI / 2.5
          mesh.rotation.z = 0
          parts.legL.rotation.x = 0
          parts.legR.rotation.x = 0
          parts.armL.rotation.x = 0
          parts.armR.rotation.x = 0
          parts.armL.rotation.z = 0
          parts.armR.rotation.z = 0
        }

        const glow = mesh.userData.glow
        if (localPos && id !== localId) {
          const d = localPos.distanceTo(mesh.position)
          glow.intensity = Math.max(0, 1 - d / 6) * 1.6
        } else {
          glow.intensity = 0
        }
      }

      renderer.render(scene, camera)
      rafRef.current.render = requestAnimationFrame(renderLoop)
    }
    renderLoop()

    const moveLoop = () => {
      const localId = localIdRef.current
      const me = localId ? playersRef.current[localId] : null
      if (me && phase !== 'ended') {
        const mode = cameraModeRef.current

        // Camera look controls
        const lookYawSpeed = 0.045
        const lookPitchSpeed = 0.028
        if (keysRef.current['a']) fpRef.current.yaw += lookYawSpeed
        if (keysRef.current['d']) fpRef.current.yaw -= lookYawSpeed
        if (keysRef.current['arrowleft']) fpRef.current.yaw += lookYawSpeed
        if (keysRef.current['arrowright']) fpRef.current.yaw -= lookYawSpeed
        if (keysRef.current['arrowup']) fpRef.current.pitch += lookPitchSpeed
        if (keysRef.current['arrowdown']) fpRef.current.pitch -= lookPitchSpeed

        if (mode === 'first') fpRef.current.pitch = clamp(fpRef.current.pitch, -1.35, 1.35)
        else if (mode === 'third') fpRef.current.pitch = clamp(fpRef.current.pitch, -0.8, 0.6)
        else fpRef.current.pitch = clamp(fpRef.current.pitch, -0.4, 0.4)

        const ph = physicsRef.current
        const speed = ph.crouch ? 0.075 : 0.11
        let nx = me.mesh.position.x
        let nz = me.mesh.position.z

        const forwardSign = mode === 'third' ? 1 : -1
        const forwardX = forwardSign * Math.sin(fpRef.current.yaw)
        const forwardZ = forwardSign * Math.cos(fpRef.current.yaw)

        let moveX = 0
        let moveZ = 0

        // Movement controls:
        // W = forward, S = backward
        if (keysRef.current['w']) {
          moveX += forwardX
          moveZ += forwardZ
        }
        if (keysRef.current['s']) {
          moveX -= forwardX
          moveZ -= forwardZ
        }

        const len = Math.hypot(moveX, moveZ)
        if (len > 0.0001) {
          moveX /= len
          moveZ /= len
          const tx = nx + moveX * speed
          const tz = nz + moveZ * speed

          // static obstacles + other players collision
          const collidePlayers = (px, pz, cx, cz) => {
            for (const pid of Object.keys(playersRef.current)) {
              if (pid === localId) continue
              const other = playersRef.current[pid]
              if (!other?.mesh) continue
              const ox = other.mesh.position.x
              const oz = other.mesh.position.z
              const currentDist = Math.hypot(cx - ox, cz - oz)
              const nextDist = Math.hypot(px - ox, pz - oz)
              const minDist = 0.62

              // If currently overlapping, allow movement that increases separation.
              if (currentDist < minDist && nextDist > currentDist) continue

              if (nextDist < minDist) return true
            }
            return false
          }

          // axis-separated resolution to avoid sticky corners
          const canJumpOver = ph.y > 0.42
          const currStatic = canJumpOver ? 0 : staticCollisionSeverity(nx, nz, obstaclesRef.current)
          const nextStaticBoth = canJumpOver ? 0 : staticCollisionSeverity(tx, tz, obstaclesRef.current)
          const staticOkBoth = nextStaticBoth === 0 || (currStatic > 0 && nextStaticBoth < currStatic)
          const canBoth = staticOkBoth && !collidePlayers(tx, tz, nx, nz)
          if (canBoth) {
            nx = tx
            nz = tz
          } else {
            const nextStaticX = canJumpOver ? 0 : staticCollisionSeverity(tx, nz, obstaclesRef.current)
            const nextStaticZ = canJumpOver ? 0 : staticCollisionSeverity(nx, tz, obstaclesRef.current)
            const staticOkX = nextStaticX === 0 || (currStatic > 0 && nextStaticX < currStatic)
            const staticOkZ = nextStaticZ === 0 || (currStatic > 0 && nextStaticZ < currStatic)
            const canX = staticOkX && !collidePlayers(tx, nz, nx, nz)
            const canZ = staticOkZ && !collidePlayers(nx, tz, nx, nz)
            if (canX) nx = tx
            if (canZ) nz = tz
          }

          // move direction from WASD
          const moveYaw = Math.atan2(moveX, moveZ)

          // character turns toward movement direction
          const faceDiff = normalizeAngle(moveYaw - me.mesh.rotation.y)
          me.mesh.rotation.y += faceDiff * 0.3

          // camera yaw is controlled only by arrow keys
        }

        if (ph.y > 0 || ph.vy > 0) {
          ph.vy -= 0.012
          ph.y += ph.vy
          if (ph.y <= 0) {
            ph.y = 0
            ph.vy = 0
          }
        }

        me.mesh.position.y = ph.y
        me.mesh.userData.targetPos.y = ph.y
        me.mesh.scale.y = ph.crouch ? 0.72 : 1

        nx = clamp(nx, WORLD.minX + 0.2, WORLD.maxX - 0.2)
        nz = clamp(nz, WORLD.minZ + 0.2, WORLD.maxZ - 0.2)

        if (!isBlocked(nx, nz)) {
          const moved = Math.hypot(nx - me.mesh.position.x, nz - me.mesh.position.z)
          me.mesh.position.x = nx
          me.mesh.position.z = nz
          me.mesh.userData.targetPos.set(nx, 0, nz)
          me.mesh.userData.speed = moved * 8
          const now = Date.now()
          if (moved > 0.0001 && now - lastEmitRef.current >= 50) {
            lastEmitRef.current = now
            socket.emit('updatePosition', { gameId, pos: { x: nx, y: ph.y, z: nz }, ts: now })
          }
        } else {
          const now = Date.now()
          if ((ph.y > 0 || ph.vy !== 0) && now - lastEmitRef.current >= 50) {
            lastEmitRef.current = now
            socket.emit('updatePosition', { gameId, pos: { x: me.mesh.position.x, y: ph.y, z: me.mesh.position.z }, ts: now })
          }
        }
      }
      rafRef.current.move = requestAnimationFrame(moveLoop)
    }
    moveLoop()

    return () => {
      cancelAnimationFrame(rafRef.current.render)
      cancelAnimationFrame(rafRef.current.move)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', resetInputState)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      document.removeEventListener('mousemove', onMouseMove)
      renderer.domElement.removeEventListener('click', lockPointer)
      socket.disconnect()
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
      if (autoPlayTimerRef.current) { clearTimeout(autoPlayTimerRef.current); autoPlayTimerRef.current = null }
      if (rendererRef.current?.domElement && mountRef.current?.contains(rendererRef.current.domElement)) {
        mountRef.current.removeChild(rendererRef.current.domElement)
      }
    }
  }, [gameId, opts.map, opts.name, opts.role, opts.userId])

  function startGame() {
    if (!socketRef.current) return
    socketRef.current.emit('startGame', { gameId })
  }

  function setHiddenNearest() {
    const localId = localIdRef.current
    const me = localId ? playersRef.current[localId] : null
    if (!me || !socketRef.current) return

    let best = null
    let bd = Infinity
    roomsRef.current.forEach((r) => {
      const d = r.pos.distanceTo(me.mesh.position)
      if (d < bd) {
        bd = d
        best = r
      }
    })

    if (best) {
      socketRef.current.emit('setHidden', { gameId, location: best.name, hidden: true })
      setHiddenRoom(best.name)
      setMyHidden(true)
    }
  }

  function toggleHideAtSpot() {
    if (!socketRef.current) return
    if (myHidden) {
      socketRef.current.emit('setHidden', { gameId, hidden: false })
      setMyHidden(false)
      return
    }
    setHiddenNearest()
  }

  function catchAndReport() {
    if (!socketRef.current) return
    if (myRole !== 'seeker') return
    socketRef.current.emit('attemptCatch', { gameId })
  }

  function jumpAction() {
    const ph = physicsRef.current
    if (ph.y <= 0.001) ph.vy = 0.22
  }

  function toggleCrouchAction() {
    physicsRef.current.crouch = !physicsRef.current.crouch
  }

  function toggleNearestDoorAction() {
    if (!socketRef.current) return
    const localId = localIdRef.current
    const me = localId ? playersRef.current[localId] : null
    if (!me) return
    let best = null
    let bestDist = Infinity
    doorsRef.current.forEach((d) => {
      const dx = me.mesh.position.x - d.mesh.position.x
      const dz = me.mesh.position.z - d.mesh.position.z
      const dist = Math.sqrt(dx * dx + dz * dz)
      if (dist < bestDist) {
        bestDist = dist
        best = d
      }
    })
    if (best && bestDist <= 2.4) {
      socketRef.current.emit('toggleDoor', { gameId, doorId: best.id })
    }
  }

  function toggleReady() {
    if (!socketRef.current || phase !== 'waiting') return
    socketRef.current.emit('setReady', { gameId, ready: !myReady })
  }

  function endAndExitRoom() {
    if (!socketRef.current) {
      window.location.href = '/'
      return
    }
    socketRef.current.emit('leaveGame', { gameId })
    setTimeout(() => {
      window.location.href = '/'
    }, 150)
  }

  // Auto 5s visual countdown on Play Again button when game ends
  useEffect(() => {
    if (phase === 'ended' && !myRematchRequested) {
      setPlayAgainAutoCountdown(5)
      clearTimeout(autoPlayTimerRef.current)
    } else {
      setPlayAgainAutoCountdown(0)
      clearTimeout(autoPlayTimerRef.current)
    }
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (playAgainAutoCountdown <= 0) return
    const t = setTimeout(() => setPlayAgainAutoCountdown((p) => Math.max(0, p - 1)), 1000)
    return () => clearTimeout(t)
  }, [playAgainAutoCountdown])

  function changePreferredRole(nextRole) {
    if (!socketRef.current || phase !== 'waiting') return
    preferredRoleRef.current = nextRole
    setPreferredRole(nextRole)
    socketRef.current.emit('setPreferredRole', { gameId, role: nextRole })
  }

  function playAgain() {
    if (!socketRef.current || phase !== 'ended') return
    setMyRematchRequested(true)
    setPlayAgainAutoCountdown(0)
    setPlayAgainCountdown(10)
    setIsSearchingRoom(false)
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
    socketRef.current.emit('playAgain', { gameId })
  }

  // 10s waiting countdown after clicking Play Again, then auto-poll for a room
  useEffect(() => {
    if (phase !== 'ended' || !myRematchRequested) {
      setPlayAgainCountdown(0)
      setIsSearchingRoom(false)
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
      return
    }
    if (playAgainCountdown <= 0) {
      // Countdown done — start polling for available rooms (auto-join)
      if (!pollingRef.current) {
        setIsSearchingRoom(true)
        socketRef.current?.emit('listRooms')
        pollingRef.current = setInterval(() => {
          socketRef.current?.emit('listRooms')
        }, 1500)
      }
      return
    }
    const t = setTimeout(() => setPlayAgainCountdown((p) => Math.max(0, p - 1)), 1000)
    return () => clearTimeout(t)
  }, [playAgainCountdown, phase, myRematchRequested]) // eslint-disable-line react-hooks/exhaustive-deps

  const seekerList = playersUi.filter((p) => resolveRole(p) === 'seeker')
  const hidersLeft = playersUi.filter((p) => resolveRole(p) === 'hider' && !p.caught)
  const hidersCaught = playersUi.filter((p) => resolveRole(p) === 'hider' && p.caught)

  return (
    <div className="game-root">
      <div className="hud-card">
        <div className="hud-top">
          <div><strong>Room:</strong> {gameId}</div>
          <div><strong>Role:</strong> {myRole}</div>
          <div><strong>Phase:</strong> {phase}</div>
          <div><strong>Timer:</strong> {phaseRemaining}s</div>
          <div><strong>Hidden:</strong> {hiddenRoom}</div>
        </div>

        {nearInfo ? <div className="badge badge-near">💡 {nearInfo}</div> : null}
        {caughtMsg ? <div className="badge badge-caught">⚠️ {caughtMsg}</div> : null}
        {winner ? <div className="badge badge-win">🏁 Winner: {winner}</div> : null}
        {reportText ? <div className="badge badge-win">📣 {reportText}</div> : null}

        <div className="hud-actions">
          {phase === 'waiting' ? <button className="btn btn-primary" onClick={toggleReady}>{myReady ? 'Unready' : 'Ready'}</button> : null}
          {phase === 'waiting' ? <button className="btn" onClick={endAndExitRoom}>End / Exit Room</button> : null}
          <button className="btn" onClick={toggleHideAtSpot}>{myHidden ? 'Unhide' : 'Hide (H)'}</button>
          {myRole === 'seeker' ? <button className="btn" onClick={catchAndReport}>Catch / Report (F)</button> : null}
          <button className="btn" onClick={() => setShowControlsModal(true)}>Controls</button>
          <button className="btn" onClick={cycleCameraMode}>Camera: {cameraMode}</button>
          <select
            className="btn"
            value={cameraMode}
            onChange={(e) => {
              setCameraMode(e.target.value)
              cameraModeRef.current = e.target.value
            }}
          >
            <option value="first">first person</option>
            <option value="third">third person</option>
            <option value="top">top / tactical</option>
          </select>
        </div>

        <div className="players-strip">
          {playersUi.map((p) => (
            <div key={p.id} className={`pill ${p.caught ? 'caught' : ''}`}>
              {p.name} • {p.role} • {p.ready ? 'ready' : 'not ready'} {p.caught ? '• caught' : ''}
            </div>
          ))}
        </div>

        {myRole === 'seeker' ? (
          <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 10, background: 'rgba(17,24,39,0.08)' }}>
            <div><strong>Seekers:</strong> {seekerList.map((p) => p.name).join(', ') || 'none'}</div>
            <div><strong>Hiders left ({hidersLeft.length}):</strong> {hidersLeft.map((p) => p.name).join(', ') || 'none'}</div>
            <div><strong>Caught ({hidersCaught.length}):</strong> {hidersCaught.map((p) => p.name).join(', ') || 'none'}</div>
          </div>
        ) : null}
      </div>

      {phase === 'waiting' ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(9,12,18,0.45)', zIndex: 15, padding: '12px' }}>
          <div style={{ width: '100%', maxWidth: '860px', maxHeight: '85vh', overflow: 'auto', background: '#ffffffee', borderRadius: 16, padding: 16, boxShadow: '0 18px 40px rgba(0,0,0,0.3)' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '20px' }}>⏳ Waiting Room</h3>
            <div style={{ color: '#344054', marginBottom: 12, fontSize: '13px', lineHeight: 1.5 }}>
              <strong>Rules:</strong> •{' '}
              {'<'}6 players = 1 seeker • 6-16 = 2 seekers • {'>'}16 = 3-5 seekers (auto)
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '13px', whiteSpace: 'nowrap' }}>Your role:</span>
                <select className="btn" style={{ flex: 1, minWidth: '100px' }} value={preferredRole} onChange={(e) => changePreferredRole(e.target.value)}>
                  <option value="hider">Hider</option>
                  <option value="seeker">Seeker</option>
                </select>
              </label>
              <button className="btn btn-primary" style={{ minWidth: '100px' }} onClick={toggleReady}>{myReady ? '✅ Unready' : '⭕ Ready'}</button>
              <button className="btn" style={{ minWidth: '120px' }} onClick={endAndExitRoom}>🚪 Exit Room</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 100px', gap: 8, fontWeight: 700, marginBottom: 8, fontSize: '12px', padding: '8px 0', borderBottom: '2px solid #e5e7eb' }}>
              <div>Name</div><div>Assigned Role</div><div>Status</div>
            </div>
            <div style={{ maxHeight: '30vh', overflowY: 'auto', marginBottom: 12 }}>
              {playersUi.map((p) => (
                <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 100px', gap: 8, padding: '8px 0', borderTop: '1px solid #e5e7eb', fontSize: '12px' }}>
                  <div style={{ wordBreak: 'break-word' }}>{p.name}</div>
                  <div>{p.role}</div>
                  <div>{p.ready ? '✅ ready' : '⏳ waiting'}</div>
                </div>
              ))}
            </div>
            <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: 'rgba(37,99,235,0.08)', fontSize: '12px', lineHeight: 1.4 }}>
              <strong>📱 Controls:</strong> W/S move • Arrow keys look • Space jump • X crouch • E door • H hide • F catch (seeker) • C camera
            </div>
            <button className="btn" style={{ width: '100%', height: '40px' }} onClick={() => setShowControlsModal(true)}>📖 Full Controls</button>
            <div style={{ marginTop: 10, color: '#475467', fontSize: '12px', textAlign: 'center' }}>✓ Game starts when everyone is ready</div>
          </div>
        </div>
      ) : null}

      {phase === 'connecting' ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(9,12,18,0.5)', zIndex: 16, padding: '12px' }}>
          <div style={{ width: '100%', maxWidth: '480px', background: '#ffffffee', borderRadius: 16, padding: 20, boxShadow: '0 18px 40px rgba(0,0,0,0.3)', textAlign: 'center' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '18px' }}>⏳ Connecting to room...</h3>
            <div style={{ marginBottom: 16, color: '#344054', fontSize: '13px', lineHeight: 1.6 }}>
              <strong>Quick Controls:</strong><br />W/S move • Arrow keys look • Space jump • X crouch • E door • H hide • F catch • C camera
            </div>
            <button className="btn btn-primary" style={{ width: '100%', height: '44px', fontSize: '14px' }} onClick={() => setShowControlsModal(true)}>📖 Full Controls</button>
          </div>
        </div>
      ) : null}

      {showControlsModal ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(9,12,18,0.55)', zIndex: 60, padding: '12px' }}>
          <div style={{ width: '100%', maxWidth: '500px', maxHeight: '85vh', overflow: 'auto', background: '#fff', borderRadius: 16, padding: 18, boxShadow: '0 18px 40px rgba(0,0,0,0.35)' }}>
            <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: '18px' }}>📖 Game Controls</h3>
            <div style={{ display: 'grid', gap: 10, fontSize: '13px', lineHeight: 1.5 }}>
              <div><strong>⬅️ Move:</strong> W (forward) / S (backward)</div>
              <div><strong>🔄 Look Around:</strong> Arrow keys or A/D (360° free look)</div>
              <div><strong>⬆️ Jump:</strong> Spacebar</div>
              <div><strong>⬇️ Crouch/Stand:</strong> X</div>
              <div><strong>🚪 Door:</strong> E (stand near door to toggle)</div>
              <div><strong>👻 Hide/Unhide:</strong> H (works anywhere, use blue spots)</div>
              <div><strong>✋ Catch:</strong> F (seeker only, requires proximity)</div>
              <div><strong>📹 Camera Modes:</strong> C (First/Third/Top)</div>
              <div><strong>🖱️ Mouse Look:</strong> Click scene to lock mouse</div>
            </div>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 16, height: '40px', fontSize: '14px' }} onClick={() => setShowControlsModal(false)}>✓ Close</button>
          </div>
        </div>
      ) : null}

      {phase === 'ended' ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(5,8,14,0.6)', zIndex: 40, padding: '12px' }}>
          <div style={{ width: '100%', maxWidth: '500px', background: '#ffffffef', borderRadius: 18, padding: 18, boxShadow: '0 24px 50px rgba(0,0,0,0.35)', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>{winner === 'seeker' ? '👑' : '🎉'}</div>
            <h2 style={{ margin: '0 0 8px 0', fontSize: '24px' }}>{winner === 'seeker' ? 'Seeker Wins!' : 'Hiders Win!'}</h2>
            <p style={{ margin: '0 0 12px 0', color: '#475467', fontSize: '14px', lineHeight: 1.5 }}>
              {winner === 'seeker'
                ? 'All hiders were found in time. Great hunt!'
                : 'Time is up. Not all hiders were found, seeker lost.'}
            </p>
            {isSearchingRoom ? (
              <p style={{ marginBottom: 8, color: '#2563eb', fontWeight: 600, fontSize: '13px' }}>🔍 Searching for a room... auto-joining when found.</p>
            ) : myRematchRequested ? (
              <p style={{ marginBottom: 8, color: '#475467', fontSize: '13px' }}>⏳ Waiting for others... ({playAgainCountdown}s left)</p>
            ) : null}
            <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                className="btn btn-primary"
                onClick={playAgain}
                disabled={myRematchRequested}
                style={{ width: '100%', height: '44px', fontSize: '14px', fontWeight: 700 }}
              >
                {isSearchingRoom
                  ? '🔍 Searching rooms...'
                  : myRematchRequested
                  ? `Waiting... (${playAgainCountdown}s)`
                  : playAgainAutoCountdown > 0
                  ? `▶ Play Again (${playAgainAutoCountdown}s)`
                  : '▶ Play Again (Same Room)'}
              </button>
              <button className="btn" style={{ width: '100%', height: '40px', fontSize: '13px' }} onClick={() => setShowControlsModal(true)}>📖 Controls</button>
            </div>
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center', gap: 4, flexWrap: 'wrap' }}>
              {Array.from({ length: 16 }).map((_, i) => (
                <span key={i} style={{ width: 6, height: 6, borderRadius: 999, background: i % 2 ? '#6a8bff' : '#ffd166', opacity: 0.85, transform: `translateY(${Math.sin((i + Date.now() / 200) * 0.8) * 2}px)` }} />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {isSearchingRoom && phase !== 'ended' ? (
        <div style={{ position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)', background: '#1e293bee', color: '#fff', borderRadius: 12, padding: '12px 22px', zIndex: 50, fontSize: 15, fontWeight: 600 }}>
          🔍 Searching for a room to join...
        </div>
      ) : null}

      <div ref={mountRef} className="three-mount" />

      {showMobileControls && phase !== 'ended' ? (
        <div className="mobile-controls-wrap">
          <div className="mobile-controls-grid">
            <div className="mobile-pad">
              <button
                className="btn mobile-btn"
                onTouchStart={startHoldKey('w')}
                onTouchEnd={stopHoldKey('w')}
                onTouchCancel={stopHoldKey('w')}
                onMouseDown={startHoldKey('w')}
                onMouseUp={stopHoldKey('w')}
                onMouseLeave={stopHoldKey('w')}
              >↑ Move</button>
              <button
                className="btn mobile-btn"
                onTouchStart={startHoldKey('arrowleft')}
                onTouchEnd={stopHoldKey('arrowleft')}
                onTouchCancel={stopHoldKey('arrowleft')}
                onMouseDown={startHoldKey('arrowleft')}
                onMouseUp={stopHoldKey('arrowleft')}
                onMouseLeave={stopHoldKey('arrowleft')}
              >↺ Look</button>
              <button
                className="btn mobile-btn"
                onTouchStart={startHoldKey('arrowright')}
                onTouchEnd={stopHoldKey('arrowright')}
                onTouchCancel={stopHoldKey('arrowright')}
                onMouseDown={startHoldKey('arrowright')}
                onMouseUp={stopHoldKey('arrowright')}
                onMouseLeave={stopHoldKey('arrowright')}
              >Look ↻</button>
              <button
                className="btn mobile-btn"
                onTouchStart={startHoldKey('s')}
                onTouchEnd={stopHoldKey('s')}
                onTouchCancel={stopHoldKey('s')}
                onMouseDown={startHoldKey('s')}
                onMouseUp={stopHoldKey('s')}
                onMouseLeave={stopHoldKey('s')}
              >↓ Back</button>
            </div>

            <div className="mobile-actions">
              <button className="btn mobile-btn" onClick={jumpAction}>Jump</button>
              <button className="btn mobile-btn" onClick={toggleCrouchAction}>Crouch</button>
              <button className="btn mobile-btn" onClick={toggleNearestDoorAction}>Door</button>
              <button className="btn mobile-btn" onClick={toggleHideAtSpot}>{myHidden ? 'Unhide' : 'Hide'}</button>
              {myRole === 'seeker' ? <button className="btn mobile-btn" onClick={catchAndReport}>Catch</button> : null}
              <button className="btn mobile-btn" onClick={cycleCameraMode}>Cam</button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="controls">
        <strong>Controls:</strong> Click map to lock mouse • <strong>W/S</strong> move forward/back • <strong>A/D or Arrow keys</strong> 360° view • <strong>Space</strong> jump • <strong>X</strong> sit/stand • <strong>E</strong> open/close nearest door • <strong>C</strong> camera • <strong>H</strong> hide/unhide (works anywhere, blue spots are suggestions) • <strong>F</strong> seeker catch/report. <br />
        <strong>Mobile:</strong> Use on-screen buttons: Move, Look, Back, Jump, Crouch, Door, Hide, Catch, Cam.
      </div>
    </div>
  )
}
