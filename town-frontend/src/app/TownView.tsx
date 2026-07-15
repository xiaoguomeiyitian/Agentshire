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

  // Lazy-load: set iframe src on first activation, keep mounted afterward
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
