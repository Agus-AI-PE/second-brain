import { describe, expect, it } from 'vitest'
import { detectIntent } from '@second-brain/agent'

describe('agent package integration', () => {
  it('exports intent detection consumable from platform', () => {
    expect(detectIntent('simpan catatan ini')).toBe('save')
  })
})
