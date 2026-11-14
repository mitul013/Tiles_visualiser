import { useSyncExternalStore } from 'react'

/** whether a CSS media query matches, updating on resize / rotation */
export function useMedia(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** phones and tablets held upright get the swipe-through layout */
export const PHONE_PORTRAIT = '(max-width: 834px) and (orientation: portrait)'
