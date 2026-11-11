/*
 * Tiles Visualiser embed script.
 *
 *   <script src="https://YOUR-HOST/embed.js" data-visualiser-url="https://YOUR-HOST/"></script>
 *   <button onclick="TilesVisualiser.open()">Try our visualizer</button>
 *   <button onclick="TilesVisualiser.open({ product: 'TV-MAR-001-60120', surface: 'floor' })">See this tile in a room</button>
 *
 *   window.addEventListener('tilesvisualiser:PRODUCT_CLICK', (e) => console.log(e.detail))
 *
 * Events (CustomEvent on window, detail = event data): PRODUCT_CLICK, SAVE_IMAGE, SAVE_IMAGE_END, SAVE_PDF, open, close
 * Any element with data-tv-product="<id or sku>" opens the visualiser with that product.
 */
;(function () {
  if (window.TilesVisualiser) return
  var script = document.currentScript
  var baseUrl = (script && script.getAttribute('data-visualiser-url')) || (script ? new URL('.', script.src).href : '/')
  var overlay = null
  var frame = null

  function buildUrl(opts) {
    var u = new URL(baseUrl, location.href)
    u.searchParams.set('visualizer', '')
    if (opts.room) u.searchParams.set('room', opts.room)
    if (opts.product) u.searchParams.set('product', opts.product)
    if (opts.surface) u.searchParams.set('surface', opts.surface)
    if (opts.view) u.searchParams.set('view', opts.view)
    if (opts.lang) u.searchParams.set('lang', opts.lang)
    return u.href
  }

  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent('tilesvisualiser:' + name, { detail: detail || {} }))
  }

  function close() {
    if (!overlay) return
    overlay.remove()
    overlay = frame = null
    document.documentElement.style.overflow = ''
    emit('close')
  }

  function open(opts) {
    opts = opts || {}
    close()
    overlay = document.createElement('div')
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-label', 'Tiles visualiser')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(1,20,28,.55);padding:14px;box-sizing:border-box'
    var btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('aria-label', 'Close visualiser')
    btn.textContent = '✕'
    btn.style.cssText = 'position:absolute;top:18px;right:22px;z-index:1;width:34px;height:34px;border-radius:50%;border:0;background:#fff;font-size:16px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)'
    btn.onclick = close
    frame = document.createElement('iframe')
    frame.src = buildUrl(opts)
    frame.allow = 'fullscreen; clipboard-write'
    frame.allowFullscreen = true
    frame.style.cssText = 'width:100%;height:100%;border:0;border-radius:14px;background:#fff'
    overlay.appendChild(frame)
    overlay.appendChild(btn)
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close()
    })
    document.body.appendChild(overlay)
    document.documentElement.style.overflow = 'hidden'
    emit('open', opts)
  }

  window.addEventListener('message', function (e) {
    if (!frame || e.source !== frame.contentWindow) return
    var m = e.data
    if (m && m.source === 'tiles-visualiser' && m.event_type) emit(m.event_type, m.data)
  })
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close()
  })
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[data-tv-product],[data-tv-open]')
    if (!el) return
    e.preventDefault()
    open({ product: el.getAttribute('data-tv-product') || undefined, surface: el.getAttribute('data-tv-surface') || undefined, room: el.getAttribute('data-tv-room') || undefined })
  })

  window.TilesVisualiser = { open: open, close: close }
})()
