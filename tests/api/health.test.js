import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

function createApp() {
  const app = express()
  app.get('/api/health', (_, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() })
  })
  return app
}

describe('GET /api/health', () => {
  it('should return status ok', async () => {
    const app = createApp()
    const res = await request(app).get('/api/health')

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.time).toBeDefined()
  })

  it('should return valid ISO timestamp', async () => {
    const app = createApp()
    const res = await request(app).get('/api/health')

    const time = new Date(res.body.time)
    expect(time.toISOString()).toBe(res.body.time)
    expect(time.getTime()).not.toBeNaN()
  })
})
