import { icons } from 'lucide'
import catalogZh from '../data/skill-catalog.json'
import catalogEn from '../data/skill-catalog.en.json'
import { getLocale } from '../i18n'

function getCatalog() { return getLocale() === 'en' ? catalogEn : catalogZh }

type IconNode = [string, Record<string, string>][]

interface CategoryDef {
  label: string
  gradient: string[]
}

export interface SkillEntry {
  slug: string
  name: string
  category: string
  icon: string
  desc: string
  downloads: number
  stars: number
  installs: number
}

const _cache: { locale: string; categories: Record<string, CategoryDef>; skills: SkillEntry[]; skillMap: Map<string, SkillEntry> } = {
  locale: '',
  categories: {} as Record<string, CategoryDef>,
  skills: [],
  skillMap: new Map(),
}

function ensureCache(): typeof _cache {
  const locale = getLocale()
  if (_cache.locale === locale) return _cache
  _cache.locale = locale
  const cat = getCatalog()
  _cache.categories = cat.categories as Record<string, CategoryDef>
  _cache.skills = cat.skills as SkillEntry[]
  _cache.skillMap = new Map()
  for (const s of _cache.skills) _cache.skillMap.set(s.slug, s)
  return _cache
}

export function getSkill(slug: string): SkillEntry | undefined {
  return ensureCache().skillMap.get(slug)
}

export function getAllSkills(): SkillEntry[] {
  return ensureCache().skills
}

export function getSkillsByCategory(cat: string): SkillEntry[] {
  return ensureCache().skills.filter(s => s.category === cat)
}

export function getAllCategories(): Record<string, CategoryDef> {
  return ensureCache().categories
}

function kebabToPascal(s: string): string {
  return s.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('')
}

function buildSvgElement(iconName: string, size = 24, color = '#fff'): SVGSVGElement | null {
  const pascal = kebabToPascal(iconName)
  const iconData = (icons as Record<string, IconNode>)[pascal]
  if (!iconData) return null

  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('xmlns', ns)
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', color)
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')

  for (const [tag, attrs] of iconData) {
    const el = document.createElementNS(ns, tag)
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, v)
    }
    svg.appendChild(el)
  }
  return svg
}

export function createSkillIcon(slug: string, size = 48): HTMLElement {
  const skill = ensureCache().skillMap.get(slug)
  const container = document.createElement('div')

  const iconSize = Math.round(size * 0.5)
  const radius = Math.round(size * 0.22)

  container.style.cssText = `
    width: ${size}px; height: ${size}px; border-radius: ${radius}px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  `

  if (skill) {
    const cat = ensureCache().categories[skill.category]
    const [c1, c2] = cat?.gradient ?? ['#C4915E', '#D4A574']
    container.style.background = `linear-gradient(135deg, ${c1}, ${c2})`
    const svg = buildSvgElement(skill.icon, iconSize)
    if (svg) {
      container.appendChild(svg)
    } else {
      const fallback = document.createElement('span')
      fallback.textContent = skill.name.charAt(0).toUpperCase()
      fallback.style.cssText = `color: #fff; font-weight: 700; font-size: ${iconSize}px; line-height: 1;`
      container.appendChild(fallback)
    }
  } else {
    container.style.background = 'linear-gradient(135deg, #C4915E, #D4A574)'
    const fallback = document.createElement('span')
    fallback.textContent = '?'
    fallback.style.cssText = `color: #fff; font-weight: 700; font-size: ${iconSize}px; line-height: 1;`
    container.appendChild(fallback)
  }

  return container
}
