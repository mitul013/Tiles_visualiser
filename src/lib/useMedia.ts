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

/** phones and tablets held upright (up to the 12.9-inch iPad) get the swipe-through layout */
export const PHONE_PORTRAIT = '(max-width: 1100px) and (orientation: portrait)'
/** phones on their side: the same studio, room on the left and controls in a column on the right */
export const PHONE_LANDSCAPE = '(max-height: 540px) and (orientation: landscape)'
