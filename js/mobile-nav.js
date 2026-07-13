// Shared mobile nav — injects a hamburger button into the navbar and opens the
// (otherwise hidden) sidebar as a slide-in drawer on small screens. Loaded on
// every page that has .navbar + .sidebar. Matches the app's 700px breakpoint.
(function () {
  function init() {
    const nav = document.querySelector('.navbar')
    const sidebar = document.querySelector('.sidebar')
    if (!nav || !sidebar || document.getElementById('mnBurger')) return

    const st = document.createElement('style')
    st.textContent = `
      .mn-burger, .mn-search-btn, .mn-search-close, .mn-backdrop, .mn-search-bd { display: none; }
      @media (max-width: 700px) {
        .mn-burger {
          display: inline-flex; align-items: center; justify-content: center;
          width: 38px; height: 38px; border: none; border-radius: 9px;
          background: transparent; color: #fff; cursor: pointer;
          margin-right: 2px; flex-shrink: 0; font-size: 21px; padding: 0;
        }
        .mn-burger:active { background: rgba(255,255,255,0.2); }
        /* Drawer opens BELOW the header (navbar is 56px tall) — not over it. */
        .sidebar.mn-open {
          display: flex !important; flex-direction: column !important;
          position: fixed; top: 56px; left: 0; bottom: 0;
          width: 250px; max-width: 84vw; z-index: 3000; overflow-y: auto;
          box-shadow: 0 12px 48px rgba(0,0,0,0.4);
        }
        /* The +Create button isn't needed on mobile. */
        .sidebar.mn-open .sidebar-create { display: none !important; }
        .mn-backdrop.show {
          display: block; position: fixed; top: 56px; left: 0; right: 0; bottom: 0;
          background: rgba(10,20,50,0.5); z-index: 2999;
        }
        .mn-search-btn {
          display: inline-flex; align-items: center; justify-content: center;
          width: 38px; height: 38px; border: none; border-radius: 9px;
          background: transparent; color: #fff; cursor: pointer;
          flex-shrink: 0; font-size: 19px; padding: 0;
        }
        .mn-search-btn:active { background: rgba(255,255,255,0.2); }
        .navbar .navbar-search { display: none; }
        .navbar .navbar-search.mn-search-open {
          display: flex !important; position: fixed !important;
          top: 0 !important; left: 0 !important; right: 0 !important;
          width: 100% !important; max-width: none !important; box-sizing: border-box; margin: 0; border-radius: 0;
          padding: 11px 12px; background: #0d2456; z-index: 3600; align-items: center;
        }
        .navbar-search.mn-search-open input { flex: 1; min-width: 0; padding-left: 14px !important; }
        /* Hide the decorative magnifier inside the open bar — it overlaps the input outline. */
        .navbar-search.mn-search-open .search-icon,
        .navbar-search.mn-search-open > i.ti-search { display: none !important; }
        .mn-search-close { display: none; }
        .navbar-search.mn-search-open .mn-search-close {
          display: inline-flex; align-items: center; justify-content: center;
          width: 34px; height: 34px; border: none; border-radius: 8px;
          background: rgba(255,255,255,0.16); color: #fff; cursor: pointer;
          flex-shrink: 0; font-size: 17px; margin-left: 8px; padding: 0;
        }
        .mn-search-bd { display: none; }
        /* Invisible tap-catcher: closes search on outside tap without blanking
           the page (no white/dark screen). The bar + results provide the chrome. */
        .mn-search-bd.show {
          display: block; position: fixed; inset: 0;
          background: transparent; z-index: 3400;
        }
        /* Declutter the navbar on mobile: drop the name/role text + divider
           (keep logo, search, bell, gear, avatar, hamburger). */
        .navbar .user-info, .navbar .user-name, .navbar .user-role { display: none !important; }
        .navbar .navbar-divider { display: none !important; }
        /* Search bar (flex:1) is hidden on mobile, so push the icon group flush right. */
        .navbar .navbar-right { margin-left: auto !important; }
      }
      /* Shared mobile card-list pager */
      .mcp { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 18px 0 4px; }
      .mcp-info { font-size: 0.8rem; color: #94a3b8; }
      .mcp-btns { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: center; }
      .mcp-btn { min-width: 34px; padding: 7px 10px; border: 1.5px solid #e0e4f0; border-radius: 8px; background: #fff; font-size: 0.82rem; font-weight: 600; color: #0d2456; cursor: pointer; font-family: inherit; }
      .mcp-btn[disabled] { opacity: 0.4; cursor: default; }
      .mcp-btn.on { background: #0d2456; color: #fff; border-color: #0d2456; }
      .mcp-e { color: #94a3b8; padding: 0 2px; }
    `
    document.head.appendChild(st)

    const burger = document.createElement('button')
    burger.id = 'mnBurger'
    burger.className = 'mn-burger'
    burger.setAttribute('aria-label', 'Open menu')
    burger.innerHTML = '<i class="ti ti-menu-2"></i>'
    // Rightmost of the navbar (after the bell), per the mobile design.
    const navRight = nav.querySelector('.navbar-right')
    if (navRight) navRight.appendChild(burger)
    else nav.appendChild(burger)

    const bd = document.createElement('div')
    bd.className = 'mn-backdrop'
    document.body.appendChild(bd)

    const open = () => { sidebar.classList.add('mn-open'); bd.classList.add('show') }
    const close = () => { sidebar.classList.remove('mn-open'); bd.classList.remove('show') }

    burger.addEventListener('click', e => {
      e.stopPropagation()
      sidebar.classList.contains('mn-open') ? close() : open()
    })
    bd.addEventListener('click', close)
    // Close after tapping a sidebar link (navigation) or the active item
    sidebar.addEventListener('click', e => { if (e.target.closest('.sidebar-item')) close() })

    // ── Mobile search: icon beside the bell opens a full-width search bar ──
    const search = nav.querySelector('.navbar-search')
    const right = nav.querySelector('.navbar-right')
    if (search && right) {
      const sBtn = document.createElement('button')
      sBtn.id = 'mnSearchBtn'
      sBtn.className = 'mn-search-btn'
      sBtn.setAttribute('aria-label', 'Search')
      sBtn.innerHTML = '<i class="ti ti-search"></i>'
      right.insertBefore(sBtn, right.firstChild)

      const closeX = document.createElement('button')
      closeX.className = 'mn-search-close'
      closeX.setAttribute('aria-label', 'Close search')
      closeX.innerHTML = '<i class="ti ti-x"></i>'
      search.appendChild(closeX)

      const searchInput = search.querySelector('input')
      const sbd = document.createElement('div')   // light, dedicated search surface
      sbd.className = 'mn-search-bd'
      document.body.appendChild(sbd)
      const openSearch = () => {
        search.classList.add('mn-search-open')
        sbd.classList.add('show')
        // The navbar is a flex item with z-index:100, so it forms a stacking
        // context that would trap the fixed search bar BELOW the backdrop —
        // making taps hit the backdrop (closing it) and blocking the keyboard.
        // Lift the navbar above the backdrop while search is open.
        nav.style.zIndex = '3700'
        // iOS opens the keyboard only if focus() runs synchronously in the gesture.
        if (searchInput) { try { searchInput.focus({ preventScroll: true }) } catch (e) { searchInput.focus() } }
      }
      const closeSearch = () => {
        search.classList.remove('mn-search-open')
        sbd.classList.remove('show')
        nav.style.zIndex = ''
        const drop = document.getElementById('gsDrop')
        if (drop) drop.style.display = 'none'
      }
      sBtn.addEventListener('click', e => { e.stopPropagation(); openSearch() })
      closeX.addEventListener('click', e => { e.stopPropagation(); closeSearch() })
      sbd.addEventListener('click', closeSearch)
      window._mnCloseSearch = closeSearch
    }

    window.addEventListener('resize', () => {
      if (window.innerWidth > 700) { close(); if (window._mnCloseSearch) window._mnCloseSearch() }
    })
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { close(); if (window._mnCloseSearch) window._mnCloseSearch() }
    })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()

  // Shared pager control for mobile card lists. Returns HTML for a "Showing
  // X–Y of Z" line + Prev/numbers/Next; buttons call window[cbName](page).
  window.mnCardPager = function (total, page, pageSize, cbName) {
    const pages = Math.max(1, Math.ceil(total / pageSize))
    if (pages <= 1) return ''
    if (page > pages) page = pages
    const start = (page - 1) * pageSize + 1, end = Math.min(page * pageSize, total)
    const btn = (p, label, dis, on) => `<button class="mcp-btn${on ? ' on' : ''}" ${dis ? 'disabled' : ''} ${dis ? '' : `onclick="window.${cbName}(${p})"`}>${label}</button>`
    let h = btn(page - 1, '‹ Prev', page === 1)
    const lo = Math.max(1, page - 1), hi = Math.min(pages, page + 1)
    if (lo > 1) { h += btn(1, '1', false, false); if (lo > 2) h += '<span class="mcp-e">…</span>' }
    for (let p = lo; p <= hi; p++) h += btn(p, String(p), false, p === page)
    if (hi < pages) { if (hi < pages - 1) h += '<span class="mcp-e">…</span>'; h += btn(pages, String(pages), false, false) }
    h += btn(page + 1, 'Next ›', page === pages)
    return `<div class="mcp"><div class="mcp-info">Showing ${start}–${end} of ${total}</div><div class="mcp-btns">${h}</div></div>`
  }
})()
