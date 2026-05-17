const { MongoClient } = require('mongodb')
const uri = process.env.MONGO_URI

let client = null
let db = null

async function connect() {
  if (!uri) return null
  if (db) return db
  if (!client) client = new MongoClient(uri)
  await client.connect()
  db = client.db()
  return db
}

async function saveGameResult(game) {
  if (!uri) return
  const database = await connect()
  if (!database) return
  const col = database.collection('games')
  await col.insertOne({ ...game, createdAt: new Date() })
}

module.exports = { saveGameResult, connect }
