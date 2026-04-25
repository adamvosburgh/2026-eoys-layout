import express from 'express'
import { getApprovedAssets } from '../db.js'

const router = express.Router()

router.get('/', (req, res) => {
  const assets = getApprovedAssets()
  res.json(assets)
})

export default router
