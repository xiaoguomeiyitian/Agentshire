import { useMemo, useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

interface TownViewProps {
  visible: boolean
}

export function TownView({ visible }: TownViewProps) {
  const [loaded, setLoaded] = useState(false)

  const iframeSrc = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    return `town.html?${params.toString()}`
  }, [])

  // Lazy-load: only set iframe src when Town tab is first activated.
  // Once loaded, keep it mounted (avoid re-initializing 3D engine on every switch).
  useEffect(() => {
    if (visible && !loaded) setLoaded(true)
  }, [visible, loaded])

  return (
    <iframe
      src={loaded ? iframeSrc : undefined}
      title="Agentshire Town"
      className={cn(
        'absolute inset-0 w-full h-full border-0',
        visible ? 'block' : 'hidden',
      )}
      allow="autoplay; microphone"
    />
  )
}
