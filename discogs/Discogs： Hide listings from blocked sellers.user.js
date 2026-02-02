// ==UserScript==
// @name         Discogs: Hide listings from blocked sellers
// @version      2026.2.2
// @description  Hide marketplace listings on Discogs release pages from a configurable list of sellers.
// @homepageURL  https://github.com/metaisfacil/userscripts
// @downloadURL  https://raw.github.com/metaisfacil/userscripts/main/discogs/Discogs%EF%BC%9A%20Hide%20listings%20from%20blocked%20sellers.user.js
// @match        https://www.discogs.com/sell/release/*
// @match        https://www.discogs.com/sell/list*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* ----------------------------
     Default blocklist - edit here if you like
     ---------------------------- */
  const DEFAULT_BLOCKLIST = [
    'KUPIKU-COM',
    'KUPIKU-US',
    'KUPIKU-EU',
    'ongaku_express',
    'justicker',
    'magius'
  ];
  const STORAGE_KEY = 'discogsBlockedSellers';
  /* ---------------------------- */

  // Utility: canonicalize (lowercase + strip non-alphanumerics)
  function canon(s) {
    if (!s) return '';
    return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // Load blocked sellers list from localStorage or fall back to defaults (preserve original forms)
  function loadBlockedList() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return Array.from(DEFAULT_BLOCKLIST);
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return Array.from(DEFAULT_BLOCKLIST);
      return parsed.filter(v => typeof v === 'string' && v.trim() !== '').map(v => v.trim());
    } catch (e) {
      console.warn('discogs-blocker: failed to read storage, using defaults', e);
      return Array.from(DEFAULT_BLOCKLIST);
    }
  }

  // Save blocked sellers list to localStorage (array of strings)
  function saveBlockedList(list) {
    try {
      const unique = Array.from(new Set(list.map(x => (x || '').trim()).filter(Boolean)));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(unique));
      return true;
    } catch (e) {
      console.error('discogs-blocker: failed to save blocked sellers', e);
      return false;
    }
  }

  // Build blockedSet (canonicalized) from saved list
  function buildBlockedSetFromSaved() {
    const arr = loadBlockedList();
    return new Set(arr.map(canon));
  }

  // Extract seller from a listing row (multiple fallback strategies)
  function extractSellerFromRow(row) {
    if (!row) return null;

    // Strategy 1: .seller_block a[href*="/seller/"]
    const sellerLink = row.querySelector('.seller_block a[href*="/seller/"]');
    if (sellerLink) {
      const text = sellerLink.textContent && sellerLink.textContent.trim();
      if (text) return text;
      const href = sellerLink.getAttribute('href') || '';
      const m = href.match(/\/seller\/([^\/?#]+)/i);
      if (m) return decodeURIComponent(m[1]);
    }

    // Strategy 2: shipping button with data-seller-username
    const shippingBtn = row.querySelector('.show-shipping-methods[data-seller-username]');
    if (shippingBtn) {
      const ds = shippingBtn.getAttribute('data-seller-username');
      if (ds) return ds;
    }

    // Strategy 3: seller_mywants / any element with data-username
    const mywants = row.querySelector('[data-username]');
    if (mywants) {
      const du = mywants.getAttribute('data-username');
      if (du) return du;
    }

    // Strategy 4: any anchor with /seller/ in href anywhere
    const anySellerAnchor = row.querySelector('a[href*="/seller/"]');
    if (anySellerAnchor) {
      const href = anySellerAnchor.getAttribute('href') || '';
      const m = href.match(/\/seller\/([^\/?#]+)/i);
      if (m) return decodeURIComponent(m[1]);
      const text = anySellerAnchor.textContent && anySellerAnchor.textContent.trim();
      if (text) return text;
    }

    return null;
  }

  // Hide/unhide helpers with persistent blocked marker
  function hideRow(row) {
    if (!row) return;
    row.style.display = 'none';
    // mark as blocked (persistent until list reset) and hidden
    row.setAttribute('data-blocked-by-userscript', 'true');
    row.setAttribute('data-hidden-by-userscript', 'true');
  }
  function unhideRow(row) {
    if (!row) return;
    row.style.display = '';
    // remove only the 'hidden' flag (keep the 'blocked' flag so we can re-hide later)
    row.removeAttribute('data-hidden-by-userscript');
  }

  // Process listings: scan rows and hide those whose canonical seller matches blockedSet
  function processListings() {
    // update blockedSet from storage every run
    blockedSet = buildBlockedSetFromSaved();

    const rows = document.querySelectorAll('tr.shortcut_navigable, table.mpitems tr, #pjax_container tr');
    rows.forEach(row => {
      if (row.hasAttribute('data-userscript-processed')) return;
      row.setAttribute('data-userscript-processed', 'true');

      const sellerRaw = extractSellerFromRow(row);
      if (!sellerRaw) return;

      const sellerCanon = canon(sellerRaw);
      if (blockedSet.has(sellerCanon)) {
        hideRow(row);
      }
    });

    updateControlUI();
  }

  // Count how many rows are *blocked* (not just currently hidden)
  function countBlockedRows() {
    return document.querySelectorAll('tr[data-blocked-by-userscript="true"]').length;
  }

  // Toggle show/hide of blocked rows (uses data-blocked marker so toggling is reversible)
  let currentlyShowingHidden = false;
  function toggleHiddenRows(show) {
    // If show=true -> reveal blocked rows (remove data-hidden)
    // If show=false -> hide blocked rows (set data-hidden)
    const blockedRows = document.querySelectorAll('tr[data-blocked-by-userscript="true"]');
    blockedRows.forEach(r => {
      if (show) {
        // reveal
        unhideRow(r);
      } else {
        // hide
        r.style.display = 'none';
        r.setAttribute('data-hidden-by-userscript', 'true');
      }
    });
    currentlyShowingHidden = !!show;
    updateControlUI();
  }

  // UI control (label + Show hidden + Options)
  const CONTROL_ID = 'discogs-blocked-sellers-control';

  function createControlUI() {
    if (document.getElementById(CONTROL_ID)) return;

    const container = document.createElement('div');
    container.id = CONTROL_ID;
    container.style.cssText = [
      'display:flex',
      'align-items:center',
      'gap:8px',
      'padding:6px 8px',
      'border-radius:6px',
      'font-size:13px',
      'background:rgba(0,0,0,0.04)',
      'margin:8px 0'
    ].join(';');

    const label = document.createElement('span');
    label.id = CONTROL_ID + '-label';
    label.textContent = 'Blocked sellers: 0 hidden';
    container.appendChild(label);

    // Show/Hide button
    const btn = document.createElement('button');
    btn.id = CONTROL_ID + '-btn';
    btn.textContent = 'Show hidden';
    btn.setAttribute('aria-pressed', 'false');
    btn.style.cursor = 'pointer';
    btn.style.padding = '4px 8px';
    btn.style.borderRadius = '4px';
    btn.style.border = '1px solid rgba(0,0,0,0.12)';
    btn.addEventListener('click', () => {
      toggleHiddenRows(!currentlyShowingHidden);
    });
    container.appendChild(btn);

    // Options button (opens modal)
    const optBtn = document.createElement('button');
    optBtn.id = CONTROL_ID + '-options';
    optBtn.textContent = 'Options';
    optBtn.style.cursor = 'pointer';
    optBtn.style.padding = '4px 8px';
    optBtn.style.borderRadius = '4px';
    optBtn.style.border = '1px solid rgba(0,0,0,0.12)';
    optBtn.addEventListener('click', openOptionsDialog);
    container.appendChild(optBtn);

    // Insert before listings if possible
    const placeBefore = document.querySelector('#other_versions_wrap .other_versions_table') || document.querySelector('#pjax_container') || document.body;
    if (placeBefore) {
      placeBefore.insertBefore(container, placeBefore.firstChild);
    } else {
      document.body.insertBefore(container, document.body.firstChild);
    }
  }

  function updateControlUI() {
    const label = document.getElementById(CONTROL_ID + '-label');
    const btn = document.getElementById(CONTROL_ID + '-btn');
    if (!label || !btn) return;

    const n = countBlockedRows();
    label.textContent = `Blocked sellers: ${n} hidden`;
    if (n === 0) {
      btn.style.display = 'none';
      btn.setAttribute('aria-pressed', 'false');
    } else {
      btn.style.display = '';
      btn.textContent = currentlyShowingHidden ? 'Hide hidden' : 'Show hidden';
      btn.setAttribute('aria-pressed', currentlyShowingHidden ? 'true' : 'false');
    }
  }

  // -----------------------
  // Options modal dialog
  // -----------------------
  const MODAL_ID = 'discogs-blocked-sellers-modal';

  function openOptionsDialog() {
    // If modal already exists, just show it
    let existing = document.getElementById(MODAL_ID);
    if (existing) {
      existing.style.display = 'flex';
      const ta = existing.querySelector('textarea');
      if (ta) ta.focus();
      return;
    }

    // Build modal elements
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'right:0',
      'bottom:0',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'background:rgba(0,0,0,0.4)',
      'z-index:99999',
      'padding:16px'
    ].join(';');

    const dialog = document.createElement('div');
    dialog.style.cssText = [
      'width:420px',
      'max-width:100%',
      'background:#fff',
      'border-radius:8px',
      'padding:14px',
      'box-shadow:0 8px 24px rgba(0,0,0,0.2)',
      'font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
      'box-sizing:border-box'
    ].join(';');

    const title = document.createElement('h2');
    title.textContent = 'Blocked sellers';
    title.style.margin = '0 0 8px 0';
    title.style.fontSize = '16px';
    dialog.appendChild(title);

    const hint = document.createElement('div');
    hint.textContent = 'Enter seller usernames to block, one per line. Blocked seller listings will be hidden. Matching is case-insensitive and ignores dots/hyphens/underscores.';
    hint.style.fontSize = '12px';
    hint.style.color = '#444';
    hint.style.marginBottom = '8px';
    dialog.appendChild(hint);

    const textarea = document.createElement('textarea');
    textarea.style.cssText = [
      'width:100%',
      'height:160px',
      'padding:8px',
      'border:1px solid #ddd',
      'border-radius:6px',
      'font-size:13px',
      'resize:vertical',
      'box-sizing:border-box'
    ].join(';');
    textarea.placeholder = 'Example: KUPIKU.EU\nongaku_express\njusticker';
    // load current list
    const current = loadBlockedList();
    textarea.value = current.join('\n');
    dialog.appendChild(textarea);

    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:10px;';

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset to defaults';
    resetBtn.style.cssText = 'padding:6px 8px;border-radius:6px;border:1px solid rgba(0,0,0,0.12);background:#fff;cursor:pointer;font-size:13px';
    resetBtn.addEventListener('click', () => {
      textarea.value = DEFAULT_BLOCKLIST.join('\n');
    });
    controls.appendChild(resetBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:6px 10px;border-radius:6px;border:1px solid rgba(0,0,0,0.12);background:#fff;cursor:pointer;font-size:13px';
    cancelBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
    controls.appendChild(cancelBtn);

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.style.cssText = 'padding:6px 10px;border-radius:6px;border:1px solid rgba(0,0,0,0.12);background:#0b6cff;color:#fff;cursor:pointer;font-size:13px';
    saveBtn.addEventListener('click', () => {
      // parse textarea: split by newline, comma, or semicolon; trim; remove empty lines
      const raw = textarea.value || '';
      const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const flattened = [];
      lines.forEach(l => {
        l.split(',').map(x => x.trim()).filter(Boolean).forEach(x => flattened.push(x));
      });

      if (flattened.length === 0) {
        if (!confirm('Blocking list will be empty (no sellers blocked). Save?')) return;
      }
      const saved = saveBlockedList(flattened);
      if (saved) {
        // Clean up old markers on rows so we reapply fresh
        document.querySelectorAll('tr[data-blocked-by-userscript="true"]').forEach(r => {
          r.removeAttribute('data-blocked-by-userscript');
          r.removeAttribute('data-hidden-by-userscript');
          r.style.display = '';
        });
        // reset processed flag so processListings re-examines
        document.querySelectorAll('tr[data-userscript-processed]').forEach(r => r.removeAttribute('data-userscript-processed'));
        currentlyShowingHidden = false;
        processListings();
        modal.style.display = 'none';
      } else {
        alert('Failed to save settings (see console).');
      }
    });
    controls.appendChild(saveBtn);

    dialog.appendChild(controls);

    // Close on background click (outside dialog)
    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) modal.style.display = 'none';
    });

    // Close on Esc
    function onEsc(e) {
      if (e.key === 'Escape') {
        modal.style.display = 'none';
        document.removeEventListener('keydown', onEsc);
      }
    }
    document.addEventListener('keydown', onEsc);

    modal.appendChild(dialog);
    document.body.appendChild(modal);

    // focus textarea
    textarea.focus();
  }

  // Mutation observer to detect PJAX/dynamic content changes
  function startObserver() {
    const target = document.getElementById('pjax_container') || document.body;
    const observer = new MutationObserver(mutations => {
      let relevant = false;
      for (const m of mutations) {
        if (m.type === 'childList' && m.addedNodes.length > 0) {
          relevant = true;
          break;
        }
      }
      if (relevant) {
        setTimeout(() => {
          processListings();
        }, 150);
      }
    });
    observer.observe(target, { childList: true, subtree: true });
  }

  // Initialization
  let blockedSet = buildBlockedSetFromSaved();

  function init() {
    createControlUI();
    processListings();
    startObserver();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('DOMContentLoaded', init);
  }

  // Expose a debug object for convenience
  window.__discogsBlocker = {
    processListings,
    toggleHiddenRows,
    loadBlockedList,
    saveBlockedList,
    storageKey: STORAGE_KEY
  };
})();
