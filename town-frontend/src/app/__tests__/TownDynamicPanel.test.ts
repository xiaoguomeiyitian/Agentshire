// @desc Tests for TownDynamicPanel: formatTime / getWeatherIcon pure functions
import { describe, it, expect } from 'vitest'
import { formatTime, getWeatherIcon } from '../TownDynamicPanel'

describe('TownDynamicPanel helpers', () => {
  describe('formatTime', () => {
    it('formats hour and minute with zero-padding', () => {
      expect(formatTime(9, 5)).toBe('09:05')
    })

    it('formats double-digit hour and minute without extra padding', () => {
      expect(formatTime(14, 30)).toBe('14:30')
    })

    it('formats midnight', () => {
      expect(formatTime(0, 0)).toBe('00:00')
    })

    it('formats 23:59', () => {
      expect(formatTime(23, 59)).toBe('23:59')
    })
  })

  describe('getWeatherIcon', () => {
    it('returns ☀️ for clear', () => {
      expect(getWeatherIcon('clear')).toBe('☀️')
    })

    it('returns ☁️ for cloudy', () => {
      expect(getWeatherIcon('cloudy')).toBe('☁️')
    })

    it('returns 🌦️ for drizzle', () => {
      expect(getWeatherIcon('drizzle')).toBe('🌦️')
    })

    it('returns 🌧️ for rain', () => {
      expect(getWeatherIcon('rain')).toBe('🌧️')
    })

    it('returns ⛈️ for heavyRain', () => {
      expect(getWeatherIcon('heavyRain')).toBe('⛈️')
    })

    it('returns ⛈️ for storm', () => {
      expect(getWeatherIcon('storm')).toBe('⛈️')
    })

    it('returns 🌨️ for lightSnow', () => {
      expect(getWeatherIcon('lightSnow')).toBe('🌨️')
    })

    it('returns ❄️ for snow', () => {
      expect(getWeatherIcon('snow')).toBe('❄️')
    })

    it('returns 🌫️ for fog', () => {
      expect(getWeatherIcon('fog')).toBe('🌫️')
    })

    it('returns 🌪️ for sandstorm', () => {
      expect(getWeatherIcon('sandstorm')).toBe('🌪️')
    })

    it('returns 🌌 for aurora', () => {
      expect(getWeatherIcon('aurora')).toBe('🌌')
    })

    it('returns default ☀️ for unknown weather', () => {
      expect(getWeatherIcon('unknown')).toBe('☀️')
    })

    it('returns default ☀️ for empty string', () => {
      expect(getWeatherIcon('')).toBe('☀️')
    })
  })
})
