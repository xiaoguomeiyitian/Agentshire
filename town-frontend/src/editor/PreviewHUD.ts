export interface PreviewHUDCallbacks {
  onTimeChange: (hour: number) => void
  onWeatherChange: (type: string) => void
  onSpeedChange: (multiplier: number) => void
  onExit: () => void
}

import { getLocale } from '../i18n'

const WEATHER_OPTIONS = [
  { type: 'clear', label: '☀️ 晴', labelEn: '☀️ Clear' },
  { type: 'cloudy', label: '⛅ 阴', labelEn: '⛅ Cloudy' },
  { type: 'rain', label: '🌧️ 雨', labelEn: '🌧️ Rain' },
  { type: 'snow', label: '❄️ 雪', labelEn: '❄️ Snow' },
  { type: 'fog', label: '🌫️ 雾', labelEn: '🌫️ Fog' },
  { type: 'storm', label: '⛈️ 暴风', labelEn: '⛈️ Storm' },
]

export class PreviewHUD {
  private el: HTMLElement
  private timeLabel: HTMLSpanElement
  private timeSlider: HTMLInputElement
  private weatherBtns: HTMLButtonElement[] = []
  private speedBtns: HTMLButtonElement[] = []

  constructor(container: HTMLElement, callbacks: PreviewHUDCallbacks) {
    this.el = document.createElement('div')
    this.el.className = 'preview-hud'

    // Top bar
    const topBar = document.createElement('div')
    topBar.className = 'preview-hud-top'

    const exitBtn = document.createElement('button')
    exitBtn.className = 'preview-exit-btn'
    exitBtn.innerHTML = `${getLocale() === 'en' ? '← Exit Preview' : '← 退出预览'} <span style="opacity:0.5;font-size:11px">(ESC)</span>`
    exitBtn.addEventListener('click', callbacks.onExit)
    topBar.appendChild(exitBtn)

    this.timeLabel = document.createElement('span')
    this.timeLabel.className = 'preview-time-label'
    this.timeLabel.textContent = '10:00'
    topBar.appendChild(this.timeLabel)

    this.el.appendChild(topBar)

    // Bottom bar
    const botBar = document.createElement('div')
    botBar.className = 'preview-hud-bottom'

    // Time slider
    const timeGroup = document.createElement('div')
    timeGroup.className = 'preview-hud-group'
    const sunIcon = document.createElement('span')
    sunIcon.textContent = '☀️'
    timeGroup.appendChild(sunIcon)
    this.timeSlider = document.createElement('input')
    this.timeSlider.type = 'range'
    this.timeSlider.min = '0'
    this.timeSlider.max = '24'
    this.timeSlider.step = '0.1'
    this.timeSlider.value = '10'
    this.timeSlider.className = 'preview-time-slider'
    this.timeSlider.addEventListener('input', () => {
      const h = parseFloat(this.timeSlider.value)
      callbacks.onTimeChange(h)
      this.updateTimeLabel(h)
    })
    timeGroup.appendChild(this.timeSlider)
    const moonIcon = document.createElement('span')
    moonIcon.textContent = '🌙'
    timeGroup.appendChild(moonIcon)
    botBar.appendChild(timeGroup)

    // Weather buttons
    const weatherGroup = document.createElement('div')
    weatherGroup.className = 'preview-hud-group'
    for (const opt of WEATHER_OPTIONS) {
      const btn = document.createElement('button')
      btn.className = 'preview-weather-btn'
      if (opt.type === 'clear') btn.classList.add('active')
      btn.textContent = getLocale() === 'en' ? opt.labelEn : opt.label
      btn.dataset.weather = opt.type
      btn.addEventListener('click', () => {
        this.weatherBtns.forEach(b => b.classList.toggle('active', b.dataset.weather === opt.type))
        callbacks.onWeatherChange(opt.type)
      })
      this.weatherBtns.push(btn)
      weatherGroup.appendChild(btn)
    }
    botBar.appendChild(weatherGroup)

    // Speed buttons
    const speedGroup = document.createElement('div')
    speedGroup.className = 'preview-hud-group'
    const speedLabel = document.createElement('span')
    speedLabel.textContent = getLocale() === 'en' ? 'Speed:' : '速度:'
    speedLabel.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.6);'
    speedGroup.appendChild(speedLabel)
    for (const spd of [1, 5, 20]) {
      const btn = document.createElement('button')
      btn.className = 'preview-speed-btn'
      if (spd === 1) btn.classList.add('active')
      btn.textContent = `${spd}x`
      btn.addEventListener('click', () => {
        this.speedBtns.forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        callbacks.onSpeedChange(spd)
      })
      this.speedBtns.push(btn)
      speedGroup.appendChild(btn)
    }
    botBar.appendChild(speedGroup)

    this.el.appendChild(botBar)
    container.appendChild(this.el)
  }

  updateTimeLabel(hour: number): void {
    const h = Math.floor(hour) % 24
    const m = Math.floor((hour % 1) * 60)
    this.timeLabel.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  updateTimeSlider(hour: number): void {
    this.timeSlider.value = String(hour % 24)
    this.updateTimeLabel(hour)
  }

  destroy(): void {
    this.el.remove()
  }
}
