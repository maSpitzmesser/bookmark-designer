/* bookmarks.js – baut die rohe Lesezeichen-Liste als Dock mit App-Icons um.
   Als normales <script> in den <head> einbinden (nicht defer). */
(() => {
  'use strict';

  const root = document.documentElement;
  root.classList.add('bm-loading');

  const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    el.append(...kids.flat().filter(Boolean));
    return el;
  };

  const safeUrl = (href) => {
    try {
      const u = new URL(href);
      return /^(https?|ftp|file):$/.test(u.protocol) ? u : null; // keine javascript:-Bookmarklets
    } catch { return null; }
  };

  const isLocal = (host) => /^(localhost|127\.|192\.168\.|10\.|\[?::1)/.test(host);

  const hue = (s) => {
    let n = 0;
    for (const c of s) n = (n * 31 + c.charCodeAt(0)) % 360;
    return n;
  };

  // "www.zalando.de" -> "Zalando", "gomez.com.de" -> "Gomez", "127.0.0.1:7860" -> "Lokal:7860"
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function appName(url) {
    // Lokale Dateien (file:///...) haben keinen Hostnamen: Name aus dem Pfad nehmen
    if (url.protocol === 'file:') {
      let path = url.pathname;
      try { path = decodeURIComponent(path); } catch { /* Pfad unverändert lassen */ }
      const parts = path.split('/').filter(Boolean);
      let last = parts.pop() || '';
      if (/^index\.html?$/i.test(last) && parts.length) last = parts.pop();
      return cap(last.replace(/\.[a-z0-9]+$/i, '') || 'Datei');
    }
    if (isLocal(url.hostname)) return url.port ? `Lokal:${url.port}` : 'Lokal';
    const labels = url.hostname.replace(/^www\./, '').split('.');
    let name = labels[0];
    if (labels.length >= 2) {
      const sld = ['co', 'com', 'org', 'net', 'gov', 'ac'];
      const cc = labels[labels.length - 1].length === 2 && sld.includes(labels[labels.length - 2]);
      name = labels[labels.length - (cc && labels.length >= 3 ? 3 : 2)];
    }
    return cap(name || url.hostname || 'Link');
  }

  /* Netscape-Bookmark-Format einlesen */
  function readFolder(dl, name, parents) {
    const folder = { name, parents, items: [], children: [] };
    const childParents = name == null ? [] : [...parents, name];

    for (const dt of dl.children) {
      if (dt.tagName !== 'DT') continue;
      const head = dt.firstElementChild;
      if (!head) continue;

      if (head.tagName === 'A') {
        const url = safeUrl(head.getAttribute('href'));
        if (!url) continue;
        const label = appName(url);
        folder.items.push({
          title: head.textContent.trim() || url.hostname || url.href,
          url,
          label,
          letter: (label[0] || '?').toUpperCase(),
          icon: head.getAttribute('icon'),
        });
      } else if (head.tagName === 'H3') {
        // Je nach Export steckt die Unterliste im <dt> oder direkt dahinter.
        const sub = dt.querySelector(':scope > dl')
          || (dt.nextElementSibling && dt.nextElementSibling.tagName === 'DL' ? dt.nextElementSibling : null);
        if (sub) folder.children.push(readFolder(sub, head.textContent.trim(), childParents));
      }
    }
    return folder;
  }

  // Tooltip bleibt im sichtbaren Bereich, auch bei Icons am Rand
  function keepTipInView(app) {
    const tip = app.querySelector('.tip');
    tip.style.setProperty('--dx', '0px');
    const r = tip.getBoundingClientRect();
    const m = 8;
    let dx = 0;
    if (r.left < m) dx = m - r.left;
    else if (r.right > window.innerWidth - m) dx = window.innerWidth - m - r.right;
    tip.style.setProperty('--dx', `${dx}px`);
  }

  // ---------- Icons: voll ausgefüllte Kacheln ----------
  // Die Export-Datei enthält nur winzige 16x16-Favicons. Darum wird zusätzlich versucht,
  // größere Versionen nachzuladen. Gelingt das nicht, bleibt das kleine Favicon bzw. der Buchstabe.
  //   appleTouch: lädt /apple-touch-icon.png direkt von der jeweiligen Seite (180 px, füllt die Kachel).
  //   google:     fragt zusätzlich Googles Favicon-Dienst ab. Dabei erfährt Google
  //               alle Domains deiner Lesezeichen. Mit false ausschalten.
  const HIRES = { appleTouch: true, google: true };

  function hiresSources(item) {
    const list = [];
    const { protocol, origin, hostname } = item.url;
    if (!/^https?:$/.test(protocol) || isLocal(hostname)) return list;
    if (HIRES.appleTouch) list.push({ src: `${origin}/apple-touch-icon.png`, min: 100, kind: 'full' });
    if (HIRES.google) {
      list.push({ src: `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`, min: 48, kind: 'hi' });
    }
    return list;
  }

  const toHsl = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    let hh;
    if (max === r) hh = ((g - b) / d) % 6;
    else if (max === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    return [(hh * 60 + 360) % 360, s, l];
  };

  const css = (hh, s, l) => `hsl(${Math.round(hh)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;

  // Liest die Pixel des eingebetteten Favicons: Ist es eine gefüllte Fläche (Logo mit eigenem
  // Hintergrund) oder nur ein freigestelltes Zeichen? Und welche Farbe prägt es?
  function analyzeIcon(img) {
    try {
      const n = Math.max(8, Math.min(img.naturalWidth || 16, 32));
      const canvas = document.createElement('canvas');
      canvas.width = n;
      canvas.height = n;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, n, n);
      const d = ctx.getImageData(0, 0, n, n).data;
      const alpha = (x, y) => (x < 0 || y < 0 || x >= n || y >= n ? 0 : d[(y * n + x) * 4 + 3]);

      let covered = 0;
      const buckets = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
      const edge = { r: 0, g: 0, b: 0, n: 0 };

      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const i = (y * n + x) * 4;
          if (d[i + 3] < 128) continue;
          covered++;
          const r = d[i];
          const g = d[i + 1];
          const b = d[i + 2];
          if (alpha(x - 1, y) < 128 || alpha(x + 1, y) < 128 || alpha(x, y - 1) < 128 || alpha(x, y + 1) < 128) {
            edge.r += r; edge.g += g; edge.b += b; edge.n++;
          }
          const [hh, s, l] = toHsl(r, g, b);
          if (s > 0.25 && l > 0.12 && l < 0.92) {
            const w = s * (1 - Math.abs(2 * l - 1));
            const k = Math.floor(hh / 30) % 12;
            buckets[k].w += w; buckets[k].r += r * w; buckets[k].g += g * w; buckets[k].b += b * w;
          }
        }
      }

      const best = buckets.reduce((a, b) => (b.w > a.w ? b : a));
      return {
        filled: covered / (n * n) >= 0.6,
        dominant: best.w >= 0.6 ? toHsl(best.r / best.w, best.g / best.w, best.b / best.w) : null,
        edge: edge.n ? toHsl(edge.r / edge.n, edge.g / edge.n, edge.b / edge.n) : null,
      };
    } catch { return null; }
  }

  // Kachelfarbe: gefüllte Logos behalten ihre Randfarbe, freigestellte Zeichen bekommen
  // eine kräftige Farbe aus ihrem Logo (oder Graphit bei Schwarz-Weiß) und werden weiß darauf gesetzt.
  function tileColors(a, label) {
    if (a && a.filled && a.edge) {
      const [hh, s, l] = a.edge;
      return [css(hh, s, Math.min(1, l + 0.03)), css(hh, s, Math.max(0, l - 0.04))];
    }
    if (a && a.dominant) {
      const [hh, s] = a.dominant;
      const L = Math.min(0.52, Math.max(0.4, a.dominant[2]));
      const S = Math.max(0.55, s);
      return [css(hh, S, L + 0.07), css(hh, S, L - 0.06)];
    }
    if (a) return [css(220, 0.1, 0.32), css(220, 0.1, 0.2)];
    const hh = hue(label);
    return [css(hh, 0.85, 0.64), css(hh, 0.8, 0.48)];
  }

  function buildIcon(item) {
    const icon = h('span', { class: 'icon', 'aria-hidden': 'true' });
    let analysis = null;

    const setColors = (c) => { icon.style.setProperty('--c1', c[0]); icon.style.setProperty('--c2', c[1]); };
    setColors(tileColors(null, item.label));

    const showLetter = () => { icon.classList.add('letter'); icon.replaceChildren(item.letter); };
    const show = (img, kind) => {
      img.className = kind;
      icon.classList.remove('letter');
      icon.replaceChildren(img);
    };

    // Hochauflösende Quellen der Reihe nach probieren; die erste brauchbare ersetzt das Icon
    const startHires = () => {
      (function tryNext(list) {
        const s = list.shift();
        if (!s) return;
        const img = new Image();
        img.alt = '';
        img.decoding = 'async';
        img.onload = () => {
          if (img.naturalWidth < s.min) { tryNext(list); return; }
          const glyph = s.kind !== 'full' && analysis && !analysis.filled;
          show(img, glyph ? 'glyph-hi' : 'fill');
        };
        img.onerror = () => tryNext(list);
        img.src = s.src;
      })(hiresSources(item));
    };

    // Eingebettetes Favicon sofort anzeigen, danach größere Versionen nachladen
    if (item.icon) {
      const img = new Image();
      img.alt = '';
      img.onload = () => {
        analysis = analyzeIcon(img);
        setColors(tileColors(analysis, item.label));
        show(img, analysis && analysis.filled ? 'badge' : 'glyph');
        if (img.naturalWidth > 20) img.classList.add('smooth');
        startHires();
      };
      img.onerror = () => { showLetter(); startHires(); };
      img.src = item.icon;
    } else {
      showLetter();
      startHires();
    }

    return icon;
  }

  function appLink(item) {
    const icon = buildIcon(item);

    const a = h('a', { class: 'app', href: item.url.href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': item.title },
      icon,
      h('span', { class: 'name', text: item.label }),
      h('span', { class: 'tip', 'aria-hidden': 'true', text: item.title }));
    a.addEventListener('pointerenter', () => keepTipInView(a));
    a.addEventListener('focus', () => keepTipInView(a));
    return a;
  }

  /* ---------- Liquid Glass ---------- */

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const BEZEL = 26;   // Breite des Randbereichs, in dem das Glas das Bild dahinter bricht (px)
  const BEND = 52;    // Stärke der Brechung (px-Skala der Verschiebung)

  // Die Lichtbrechung nutzt backdrop-filter: url(#svg-filter). Das können nur Chromium-Browser
  // (Chrome, Edge, Brave, Opera). Überall sonst bleibt es bei Weichzeichner und Glanzlichtern.
  const canRefract = (() => {
    const brands = navigator.userAgentData && navigator.userAgentData.brands;
    return brands
      ? brands.some((b) => /Chrom/i.test(b.brand))
      : /(?:Chrome|Chromium|Edg|OPR)\//.test(navigator.userAgent);
  })();

  // Verschiebungskarte für ein abgerundetes Rechteck: Am Rand zeigt die Verschiebung
  // nach innen und nimmt zur Mitte hin ab (Rot = x, Grün = y, 128 = keine Verschiebung).
  function lensMap(w, hgt, radius) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = hgt;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, hgt);
    const d = img.data;
    const hw = w / 2;
    const hh = hgt / 2;

    for (let y = 0; y < hgt; y++) {
      for (let x = 0; x < w; x++) {
        const px = x + 0.5 - hw;
        const py = y + 0.5 - hh;
        const qx = Math.abs(px) - (hw - radius);
        const qy = Math.abs(py) - (hh - radius);
        const ox = Math.max(qx, 0);
        const oy = Math.max(qy, 0);
        const outer = Math.hypot(ox, oy);
        const depth = -(outer + Math.min(Math.max(qx, qy), 0) - radius); // Abstand zum Rand nach innen

        let r = 128;
        let g = 128;
        if (depth >= 0 && depth < BEZEL) {
          let gx;
          let gy;
          if (outer > 0) { gx = (Math.sign(px) * ox) / outer; gy = (Math.sign(py) * oy) / outer; }
          else if (qx > qy) { gx = Math.sign(px); gy = 0; }
          else { gx = 0; gy = Math.sign(py); }
          const t = 1 - depth / BEZEL;
          const m = Math.pow(t, 2); // stark am Rand, fällt schnell ab
          r = 128 - 127 * gx * m;
          g = 128 - 127 * gy * m;
        }
        const i = (y * w + x) * 4;
        d[i] = r; d[i + 1] = g; d[i + 2] = 128; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  }

  const lensObservers = new WeakMap();

  function attachLens(dock, index, defs) {
    lensObservers.get(dock)?.();
    const id = `lg-lens-${index}`;
    const filter = document.createElementNS(SVG_NS, 'filter');
    filter.setAttribute('id', id);
    filter.setAttribute('x', '0');
    filter.setAttribute('y', '0');
    filter.setAttribute('width', '100%');
    filter.setAttribute('height', '100%');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    const mk = (name, attrs) => {
      const node = document.createElementNS(SVG_NS, name);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
      return node;
    };
    const feImage = mk('feImage', { x: 0, y: 0, preserveAspectRatio: 'none', result: 'map' });
    filter.append(
      feImage,
      mk('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', scale: BEND, xChannelSelector: 'R', yChannelSelector: 'G' }),
    );
    defs.append(filter);

    const update = () => {
      const w = Math.round(dock.offsetWidth);
      const hgt = Math.round(dock.offsetHeight);
      if (!w || !hgt) return;
      const r = parseFloat(getComputedStyle(dock).borderTopLeftRadius) || 0;
      const radius = Math.min(r, w / 2, hgt / 2);
      feImage.setAttribute('width', String(w));
      feImage.setAttribute('height', String(hgt));
      feImage.setAttribute('href', lensMap(w, hgt, radius));
      dock.style.setProperty('backdrop-filter', `url(#${id}) blur(6px) saturate(var(--saturation)) brightness(0.94)`);
    };

    let timer = 0;
    let first = true;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(update, first ? 0 : 150);
      first = false;
    });
    lensObservers.set(dock, () => {
      observer.disconnect();
      clearTimeout(timer);
    });
    observer.observe(dock);
  }


  // Eckenradius wächst mit der Höhe des Docks (wie bei iOS), mindestens konzentrisch zu den Icons
  function fitRadius(docks) {
    if (!('ResizeObserver' in window)) return;
    const ro = new ResizeObserver((entries) => {
      for (const { target } of entries) {
        const hgt = target.offsetHeight;
        if (!hgt) continue;
        const size = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--icon-size')) || 60;
        target.style.borderRadius = `${Math.round(Math.min(Math.max(hgt * 0.31, size * 0.56), 64))}px`;
      }
    });
    docks.forEach((d) => ro.observe(d));
  }

  function liquidGlass(docks, controls = []) {
    if (!docks.length && !controls.length) return;
    fitRadius(docks);
    if (!canRefract || !('ResizeObserver' in window)) return;

    document.querySelectorAll('svg[data-lg]').forEach((n) => n.remove());
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('data-lg', '');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    const defs = document.createElementNS(SVG_NS, 'defs');
    svg.append(defs);
    document.body.append(svg);
    [...docks, ...controls].forEach((surface, i) => attachLens(surface, i, defs));
  }


  function build() {
    try {
      const rootDl = document.querySelector('dl');
      if (!rootDl) return;

      const tree = readFolder(rootDl, null, []);
      const panels = [];
      (function walk(f) {
        if (f.name != null && f.items.length) panels.push(f);
        f.children.forEach(walk);
        if (f.name == null && f.items.length) panels.push({ ...f, name: 'Ohne Ordner' });
      })(tree);

      // Eingeklappte Gruppen merken (nur wenn der Browser Speicher erlaubt)
      let closed;
      try { closed = new Set(JSON.parse(localStorage.getItem('bm-closed') || '[]')); } catch { closed = new Set(); }
      const saveClosed = () => { try { localStorage.setItem('bm-closed', JSON.stringify([...closed])); } catch { /* ignorieren */ } };
      const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

      const sections = panels.map((p, i) => {
        const id = [...p.parents, p.name].join('/');
        const dock = h('div', { class: 'dock', id: `dock-${i}`, role: 'group', 'aria-label': p.name }, p.items.map(appLink));
        const head = h('button', { class: 'sec-head', type: 'button', 'aria-controls': dock.id },
          h('span', { class: 'chev', 'aria-hidden': 'true' }),
          h('span', { class: 'sec-name', text: p.name }),
          p.parents.length ? h('span', { class: 'crumb', text: `in ${p.parents.join(' / ')}` }) : null,
          h('span', { class: 'sec-count', text: String(p.items.length) }));
        const el = h('section', { class: 'sec' }, h('h2', { class: 'sec-title' }, head), dock);

        const setOpen = (open, animate) => {
          el.classList.toggle('is-closed', !open);
          head.setAttribute('aria-expanded', String(open));
          dock.getAnimations().forEach((a) => a.cancel());
          const collapsed = {
            opacity: 0,
            transform: 'scaleY(0.06)',
          };
          const shown = {
            opacity: 1,
            transform: 'none',
          };
          if (open) {
            dock.hidden = false;
            if (animate && !reduceMotion) {
              dock.animate([
                { ...collapsed, offset: 0 },
                { ...shown, opacity: 0.96, transform: 'scaleY(1.025)', offset: 0.78 },
                shown,
              ], { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
            }
          } else if (animate && !reduceMotion) {
            const a = dock.animate([
              shown,
              { ...shown, transform: 'scaleY(0.9)', offset: 0.3 },
              { opacity: 0.72, transform: 'scaleY(0.42)', offset: 0.75 },
              collapsed,
            ], { duration: 260, easing: 'cubic-bezier(0.4, 0, 0.8, 0.4)', fill: 'forwards' });
            a.onfinish = () => { if (el.classList.contains('is-closed')) dock.hidden = true; a.cancel(); };
          } else {
            dock.hidden = true;
          }
        };

        head.addEventListener('click', () => {
          const open = el.classList.contains('is-closed');
          if (open) closed.delete(id); else closed.add(id);
          saveClosed();
          setOpen(open, true);
        });

        setOpen(!closed.has(id), false);
        return el;
      });

      const main = h('main', { class: 'wrap' }, sections);
      document.body.append(main);
      root.classList.add('bm-ready');

      try { liquidGlass([...main.querySelectorAll('.dock')], [...main.querySelectorAll('.sec-head')]); }
      catch (err) { console.warn('Liquid-Glass-Effekte nicht verfügbar:', err); }
    } catch (err) {
      console.error('bookmarks.js:', err); // Bei Fehlern bleibt die Original-Liste sichtbar
    } finally {
      root.classList.remove('bm-loading');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
