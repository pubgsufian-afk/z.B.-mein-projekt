import { useEffect, useRef } from 'react'
import { subscribeDataRefresh } from './data-refresh.js'

export function useDataRefresh(refreshFn, { enabled = true } = {}) {
  const refreshRef = useRef(refreshFn)
  const runningRef = useRef(false)

  useEffect(() => { refreshRef.current = refreshFn }, [refreshFn])

  useEffect(() => {
    if (!enabled) return undefined
    return subscribeDataRefresh(async () => {
      if (runningRef.current) return
      runningRef.current = true
      try { await refreshRef.current?.() } catch {} finally { runningRef.current = false }
    })
  }, [enabled])
}
