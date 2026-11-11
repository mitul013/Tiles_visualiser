/**
 * Embedding API: when the visualiser runs inside an iframe on a vendor's site (see public/embed.js),
 * it notifies the host page with window.postMessage. Event names match the reference integration:
 *
 *   PRODUCT_CLICK   { id, sku, name, surfaces }   a product was applied / opened
 *   SAVE_IMAGE      { fileName, imageFormat, dataUrl }
 *   SAVE_IMAGE_END  {}
 *   SAVE_PDF        { fileName, arrayBuffer }
 *
 * URL parameters accepted on load (also read by App.tsx):
 *   ?visualizer          open the visualiser straight away
 *   ?view=rooms          start on the room picker
 *   ?room=<roomId>       open a room
 *   ?product=<id|sku>    apply a product (to ?surface=floor|wall|… or the room's floor)
 *   ?lang=en|es|fr|de|hi interface language
 *   #design=…            open a shared design
 */
export type HostEvent = 'PRODUCT_CLICK' | 'SAVE_IMAGE' | 'SAVE_IMAGE_END' | 'SAVE_PDF'

export const isEmbedded = () => {
  try {
    return window.parent !== window
  } catch {
    return true
  }
}

export function notifyHost(event_type: HostEvent, data: Record<string, unknown> = {}, transfer?: Transferable[]) {
  if (!isEmbedded()) return
  window.parent.postMessage({ source: 'tiles-visualiser', event_type, data }, '*', transfer ?? [])
}
