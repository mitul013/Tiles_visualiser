/**
 * Full-screen helpers for the room editor's focus mode and the room preview.
 *
 * A landscape picture on a phone held upright is shown turned sideways, like a video player:
 *  - where the browser allows it (Android), the page goes full screen and the screen orientation
 *    is locked to landscape;
 *  - elsewhere (iPhone, embedded frames) the caller rotates its own box with CSS instead:
 *    `rotated` tells it when to.
 */
import { useEffect, useState } from 'react'

type LockableOrientation = ScreenOrientation & { lock?: (o: 'landscape' | 'portrait') => Promise<void>; unlock?: () => void }

/** Try real full screen + landscape lock. Resolves true when the device itself rotated. */
export async function enterLandscape(landscape: boolean): Promise<boolean> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.()
  } catch {
    // not allowed here (iPhone, sandboxed frame): the fixed overlay still covers the page
  }
  if (!landscape) return false
  try {
    const o = screen.orientation as LockableOrientation
    if (!o?.lock) return false
    await o.lock('landscape')
    return true
  } catch {
    return false
  }
}

export function exitLandscape() {
  try {
    ;(screen.orientation as LockableOrientation)?.unlock?.()
  } catch {
    // nothing to undo
  }
  if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {})
}

/** Viewport size, updated on resize and rotation. */
export function useViewport() {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight })
  const [vp, setVp] = useState(read)
  useEffect(() => {
    const on = () => setVp(read())
    window.addEventListener('resize', on)
    window.addEventListener('orientationchange', on)
    return () => {
      window.removeEventListener('resize', on)
      window.removeEventListener('orientationchange', on)
    }
  }, [])
  return vp
}
