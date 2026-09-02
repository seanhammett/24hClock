/*
 * serializer.js — runs inside the clock page and returns the whole viewport as
 * one editable SVG. Evaluated as an expression by capture.js, so it is a bare
 * function call that yields a string rather than a script that defines things.
 *
 * The clock is already SVG, so it is carried over as real geometry with its
 * CSS-derived paint inlined onto each element. Everything around it is HTML,
 * so each box becomes a rect and each line of text a <text> at its measured
 * baseline, keeping the DOM's nesting as named groups. Native form controls
 * are redrawn as shapes, since Chrome paints those internally and there is
 * nothing in the DOM to copy.
 */
(function () {
  'use strict';

  var W = window.innerWidth, H = window.innerHeight;
  var cvs = document.createElement('canvas');
  var ctx = cvs.getContext('2d');
  var usedIds = Object.create(null);

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function n(v) { return Math.round(v * 100) / 100; }
  function attrs(o) {
    var out = [];
    for (var k in o) {
      if (o[k] === null || o[k] === undefined || o[k] === '') continue;
      out.push(k + '="' + esc(o[k]) + '"');
    }
    return out.join(' ');
  }
  function uid(base) {
    base = String(base || 'g').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'g';
    if (!usedIds[base]) { usedIds[base] = 1; return base; }
    return base + '-' + (usedIds[base]++);
  }
  function color(c) {
    if (!c) return null;
    var m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return { hex: c, op: 1 };
    var p = m[1].split(/[,\s\/]+/).filter(function (x) { return x !== ''; }).map(Number);
    var a = p.length > 3 ? p[3] : 1;
    if (!a) return null;
    var hex = '#' + p.slice(0, 3).map(function (v) {
      return Math.round(v).toString(16).padStart(2, '0');
    }).join('');
    return { hex: hex, op: a };
  }
  function px(v) { return parseFloat(v) || 0; }
  function nameFor(el) {
    if (el.id) return el.id;
    if (el.classList.length) return el.tagName.toLowerCase() + '-' + el.classList[0];
    return el.tagName.toLowerCase();
  }

  // ---- text -------------------------------------------------------------

  /** Split a text node into one segment per rendered line, with its box. */
  function segments(node) {
    var s = node.nodeValue, range = document.createRange(), segs = [], cur = null;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      range.setStart(node, i); range.setEnd(node, i + 1);
      var r = range.getBoundingClientRect();
      if (!r.width && !r.height) { if (cur) cur.text += ch; continue; }
      if (!cur && /\s/.test(ch)) continue; // collapsed leading space
      if (cur && Math.abs(r.top - cur.top) < 0.75) { cur.text += ch; cur.right = r.right; }
      else { if (cur) segs.push(cur); cur = { text: ch, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }
    }
    if (cur) segs.push(cur);
    return segs.map(function (g) { g.text = g.text.replace(/\s+$/, ''); return g; })
      .filter(function (g) { return g.text !== ''; });
  }

  /**
   * Distance from the top of a text node's first line box down to its
   * baseline, measured by dropping a zero-size inline-block in front of the
   * text: its bottom edge sits exactly on the baseline. Line boxes within one
   * node share a leading, so the offset carries to every line.
   */
  function baselineOffset(node, firstTop) {
    var probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;overflow:hidden;' +
      'padding:0;margin:0;border:0;vertical-align:baseline;';
    // insertBefore, not Range.insertNode: the latter splits the text node at
    // the offset, which leaves the walk looking at the split-off half again.
    node.parentNode.insertBefore(probe, node);
    var bottom = probe.getBoundingClientRect().bottom;
    node.parentNode.removeChild(probe);
    return bottom - firstTop;
  }

  function fontString(cs) {
    return cs.fontStyle + ' ' + cs.fontVariant.split(' ')[0] + ' ' + cs.fontWeight + ' ' +
      cs.fontSize + ' ' + cs.fontFamily;
  }

  /** Baseline for a text box of the given height, centred like a line box. */
  function baselineIn(cs, text, top, height) {
    ctx.font = fontString(cs);
    var m = ctx.measureText(text || 'M');
    var asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent;
    if (!isFinite(asc)) { asc = px(cs.fontSize) * 0.8; desc = px(cs.fontSize) * 0.2; }
    return top + (height - (asc + desc)) / 2 + asc;
  }

  function textAttrs(cs) {
    var col = color(cs.color) || { hex: '#000', op: 1 };
    var ls = px(cs.letterSpacing);
    return {
      'font-family': cs.fontFamily,
      'font-size': n(px(cs.fontSize)),
      'font-weight': cs.fontWeight,
      'font-style': cs.fontStyle === 'normal' ? null : cs.fontStyle,
      'letter-spacing': ls ? n(ls) : null,
      fill: col.hex,
      'fill-opacity': col.op === 1 ? null : n(col.op)
    };
  }

  function transform(str, cs) {
    if (cs.textTransform === 'uppercase') return str.toUpperCase();
    if (cs.textTransform === 'lowercase') return str.toLowerCase();
    if (cs.textTransform === 'capitalize') {
      return str.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }
    return str;
  }

  function emitText(str, x, y, cs, extra) {
    str = transform(str, cs);
    var a = textAttrs(cs);
    for (var k in (extra || {})) a[k] = extra[k];
    return '<text ' + attrs(Object.assign({ x: n(x), y: n(y) }, a)) +
      ' xml:space="preserve">' + esc(str) + '</text>';
  }

  function textNodeSvg(node, cs) {
    var out = [], segs = segments(node);
    if (!segs.length) return out;
    // In a flex or grid parent the probe would become a box of its own and
    // move the line it is meant to measure, so those fall back to centring
    // the font's own ascent and descent in the line box.
    var parentDisplay = getComputedStyle(node.parentNode).display;
    var probeable = !/flex|grid/.test(parentDisplay);
    var dy = probeable ? baselineOffset(node, segs[0].top) : null;
    segs.forEach(function (seg) {
      var y = dy === null
        ? baselineIn(cs, seg.text, seg.top, seg.bottom - seg.top)
        : seg.top + dy;
      var x = seg.left, anchor = null;
      if (cs.textAlign === 'center') { x = (seg.left + seg.right) / 2; anchor = 'middle'; }
      else if (cs.textAlign === 'right' || cs.textAlign === 'end') { x = seg.right; anchor = 'end'; }
      out.push(emitText(seg.text, x, y, cs, { 'text-anchor': anchor }));
    });
    return out;
  }

  // ---- boxes ------------------------------------------------------------

  function boxSvg(el, cs, r) {
    var out = [];
    var bg = color(cs.backgroundColor);
    var radii = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius']
      .map(function (k) { return px(cs[k]); });
    var rx = Math.max.apply(null, radii);
    var uniformRadius = radii.every(function (v) { return Math.abs(v - radii[0]) < 0.01; });

    if (bg) {
      out.push('<rect ' + attrs({
        x: n(r.left), y: n(r.top), width: n(r.width), height: n(r.height),
        rx: rx ? n(rx) : null, ry: rx ? n(rx) : null,
        fill: bg.hex, 'fill-opacity': bg.op === 1 ? null : n(bg.op),
        'data-name': 'background'
      }) + '/>');
    }

    var sides = [
      ['top', px(cs.borderTopWidth), cs.borderTopColor, cs.borderTopStyle],
      ['right', px(cs.borderRightWidth), cs.borderRightColor, cs.borderRightStyle],
      ['bottom', px(cs.borderBottomWidth), cs.borderBottomColor, cs.borderBottomStyle],
      ['left', px(cs.borderLeftWidth), cs.borderLeftColor, cs.borderLeftStyle]
    ].filter(function (s) { return s[1] > 0 && s[3] !== 'none' && color(s[2]); });
    if (!sides.length) return out;

    var same = sides.length === 4 && sides.every(function (s) {
      return Math.abs(s[1] - sides[0][1]) < 0.01 && s[2] === sides[0][2];
    });
    if (same && uniformRadius) {
      var w = sides[0][1], c = color(sides[0][2]);
      out.push('<rect ' + attrs({
        x: n(r.left + w / 2), y: n(r.top + w / 2),
        width: n(Math.max(0, r.width - w)), height: n(Math.max(0, r.height - w)),
        rx: rx ? n(Math.max(0, rx - w / 2)) : null, ry: rx ? n(Math.max(0, rx - w / 2)) : null,
        fill: 'none', stroke: c.hex, 'stroke-width': n(w),
        'stroke-opacity': c.op === 1 ? null : n(c.op), 'data-name': 'border'
      }) + '/>');
    } else {
      sides.forEach(function (s) {
        var w = s[1], c = color(s[2]), box;
        if (s[0] === 'top') box = { x: r.left, y: r.top, width: r.width, height: w };
        else if (s[0] === 'bottom') box = { x: r.left, y: r.bottom - w, width: r.width, height: w };
        else if (s[0] === 'left') box = { x: r.left, y: r.top, width: w, height: r.height };
        else box = { x: r.right - w, y: r.top, width: w, height: r.height };
        out.push('<rect ' + attrs({
          x: n(box.x), y: n(box.y), width: n(box.width), height: n(box.height),
          fill: c.hex, 'fill-opacity': c.op === 1 ? null : n(c.op),
          'data-name': 'border-' + s[0]
        }) + '/>');
      });
    }
    return out;
  }

  // ---- native form controls, redrawn as shapes --------------------------

  function accentColor() {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    return v || '#ff6b57';
  }

  function controlSvg(el, cs, r) {
    var tag = el.tagName, type = (el.type || '').toLowerCase(), out = [];

    if (tag === 'INPUT' && (type === 'checkbox' || type === 'radio')) {
      var acc = accentColor();
      var border = (color(cs.borderTopColor) || { hex: '#8d99b5' }).hex;
      var box = { x: r.left, y: r.top, w: r.width, h: r.height };
      if (type === 'radio') {
        out.push('<circle ' + attrs({
          cx: n(box.x + box.w / 2), cy: n(box.y + box.h / 2), r: n(box.w / 2 - 0.5),
          fill: el.checked ? acc : 'none', stroke: el.checked ? acc : border,
          'stroke-width': 1.5, 'data-name': 'radio'
        }) + '/>');
        if (el.checked) {
          out.push('<circle ' + attrs({
            cx: n(box.x + box.w / 2), cy: n(box.y + box.h / 2), r: n(box.w * 0.19),
            fill: '#ffffff', 'data-name': 'radio-dot'
          }) + '/>');
        }
      } else {
        out.push('<rect ' + attrs({
          x: n(box.x + 0.5), y: n(box.y + 0.5), width: n(box.w - 1), height: n(box.h - 1),
          rx: 3, ry: 3, fill: el.checked ? acc : 'none',
          stroke: el.checked ? acc : border, 'stroke-width': 1.5, 'data-name': 'checkbox'
        }) + '/>');
        if (el.checked) {
          var s = box.w;
          out.push('<path ' + attrs({
            d: 'M' + n(box.x + s * 0.24) + ' ' + n(box.y + s * 0.52) +
               ' L' + n(box.x + s * 0.43) + ' ' + n(box.y + s * 0.72) +
               ' L' + n(box.x + s * 0.77) + ' ' + n(box.y + s * 0.29),
            fill: 'none', stroke: '#ffffff', 'stroke-width': 2,
            'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'data-name': 'check'
          }) + '/>');
        }
      }
      return out;
    }

    if (tag === 'SELECT' || (tag === 'INPUT' && type !== 'checkbox' && type !== 'radio')) {
      out = out.concat(boxSvg(el, cs, r));
      var value = '', dim = false;
      if (tag === 'SELECT') {
        value = el.selectedIndex >= 0 ? el.options[el.selectedIndex].textContent.trim() : '';
      } else if (el.value) {
        value = el.value;

      } else {
        value = el.placeholder || ''; dim = true;
      }
      if (value) {
        var padL = px(cs.paddingLeft) + px(cs.borderLeftWidth);
        var y = baselineIn(cs, value, r.top, r.height);
        var extra = dim ? { fill: (color(getComputedStyle(document.documentElement)
          .getPropertyValue('--text-dim').trim() || '#8d99b5') || { hex: '#8d99b5' }).hex,
          'fill-opacity': 0.75 } : {};
        out.push(emitText(value, r.left + padL, y, cs, extra));
      }
      if (tag === 'INPUT' && type === 'time') {
        var gx = r.right - px(cs.borderRightWidth) - 14, gy = r.top + r.height / 2;
        var gc = (color(cs.color) || { hex: '#000' }).hex;
        out.push('<g data-name="time-picker-glyph">' +
          '<circle ' + attrs({ cx: n(gx), cy: n(gy), r: 5.5, fill: 'none',
            stroke: gc, 'stroke-width': 1.2, 'stroke-opacity': 0.7 }) + '/>' +
          '<path ' + attrs({ d: 'M' + n(gx) + ' ' + n(gy - 3) + ' L' + n(gx) + ' ' + n(gy) +
            ' L' + n(gx + 2.5) + ' ' + n(gy), fill: 'none', stroke: gc,
            'stroke-width': 1.2, 'stroke-opacity': 0.7, 'stroke-linecap': 'round',
            'stroke-linejoin': 'round' }) + '/></g>');
      }
      if (tag === 'SELECT') {
        var ax = r.right - px(cs.borderRightWidth) - 14, ay = r.top + r.height / 2;
        out.push('<path ' + attrs({
          d: 'M' + n(ax - 4) + ' ' + n(ay - 2) + ' L' + n(ax) + ' ' + n(ay + 3) +
             ' L' + n(ax + 4) + ' ' + n(ay - 2),
          fill: 'none', stroke: (color(cs.color) || { hex: '#000' }).hex,
          'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
          'data-name': 'select-arrow'
        }) + '/>');
      }
      return out;
    }
    return null;
  }

  // ---- the clock, kept as real SVG --------------------------------------

  var SVG_PROPS = ['fill', 'fill-opacity', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width',
    'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity',
    'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline',
    'letter-spacing', 'paint-order'];
  var KEEP_ATTRS = /^(d|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|width|height|points|transform|viewBox|id|class|clip-path|mask|clipPathUnits|maskUnits|maskContentUnits|gradientUnits|offset|href|xlink:href)$/;

  function svgElToString(el, insideDefs) {
    var tag = el.tagName;
    if (!insideDefs) {
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return '';
    }
    var a = {};
    for (var i = 0; i < el.attributes.length; i++) {
      var at = el.attributes[i];
      if (KEEP_ATTRS.test(at.name)) a[at.name] = at.value;
    }
    if (a.id) a.id = uid(a.id);
    if (!insideDefs && tag !== 'g' || (tag === 'g')) {
      var st = getComputedStyle(el);
      SVG_PROPS.forEach(function (p) {
        var v = st.getPropertyValue(p);
        if (!v || v === 'normal' || v === 'auto') return;
        if (p === 'font-size' && !/text|tspan|g|svg/i.test(tag)) return;
        if (/^font|letter-spacing|text-anchor|dominant-baseline/.test(p) && !/text|tspan|g|svg/i.test(tag)) return;
        if (p === 'fill-opacity' || p === 'stroke-opacity' || p === 'opacity') {
          if (parseFloat(v) === 1) return;
        }
        if (p === 'stroke' && v === 'none' && !el.hasAttribute('stroke')) return;
        a[p] = v;
      });
    }
    var kids = '', isDefs = insideDefs || tag === 'defs' || tag === 'clipPath' || tag === 'mask';
    for (var j = 0; j < el.childNodes.length; j++) {
      var c = el.childNodes[j];
      if (c.nodeType === 1) kids += svgElToString(c, isDefs);
      else if (c.nodeType === 3 && /\S/.test(c.nodeValue)) kids += esc(c.nodeValue);
    }
    var open = '<' + tag + (Object.keys(a).length ? ' ' + attrs(a) : '');
    return kids ? open + '>' + kids + '</' + tag + '>' : open + '/>';
  }

  function clockSvg(el, r) {
    var vb = (el.getAttribute('viewBox') || '0 0 440 440').split(/\s+/).map(Number);
    var scale = r.width / vb[2];
    var inner = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 1) inner += svgElToString(el.childNodes[i], false);
    }
    return '<g id="' + uid('clock-face') + '" data-name="clock face" transform="translate(' +
      n(r.left) + ' ' + n(r.top) + ') scale(' + n(scale * 1000) / 1000 + ') translate(' +
      n(-vb[0]) + ' ' + n(-vb[1]) + ')">' + inner + '</g>';
  }

  // ---- walk -------------------------------------------------------------

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, TITLE: 1, NOSCRIPT: 1, OPTION: 1 };

  function walk(el) {
    if (SKIP_TAGS[el.tagName]) return '';
    if (el.hasAttribute('hidden')) return '';
    if (el.classList.contains('visually-hidden')) return '';
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return '';
    var r = el.getBoundingClientRect();
    if (el.id === 'clock') return clockSvg(el, r);

    var body = [];
    var control = controlSvg(el, cs, r);
    if (control) body = control;
    else {
      if (r.width > 0 && r.height > 0) body = body.concat(boxSvg(el, cs, r));
      var kids = Array.prototype.slice.call(el.childNodes);
      for (var i = 0; i < kids.length; i++) {
        var c = kids[i];
        if (c.nodeType === 3) {
          // The chevron is rotated 180deg by CSS; the mirrored glyph draws the
          // same mark without carrying a transform into the export.
          var t = c;
          if (el.classList.contains('chevron')) {
            body.push(emitText('›', (r.left + r.right) / 2,
              baselineIn(cs, '›', r.top, r.height), cs, { 'text-anchor': 'middle' }));
            continue;
          }
          body = body.concat(textNodeSvg(t, cs));
        } else if (c.nodeType === 1) {
          body.push(walk(c));
        }
      }
    }
    body = body.filter(Boolean);
    if (!body.length) return '';
    var opacity = parseFloat(cs.opacity);
    return '<g ' + attrs({
      id: uid(nameFor(el)),
      'data-name': nameFor(el),
      'data-tag': el.tagName.toLowerCase(),
      opacity: opacity < 1 ? n(opacity) : null
    }) + '>' + body.join('') + '</g>';
  }

  var bodyCs = getComputedStyle(document.body);
  var pageBg = color(bodyCs.backgroundColor) || color(getComputedStyle(document.documentElement).backgroundColor);
  var parts = ['<rect id="page-background" data-name="page background" x="0" y="0" width="' +
    W + '" height="' + H + '" fill="' + (pageBg ? pageBg.hex : '#ffffff') + '"/>'];
  for (var i = 0; i < document.body.children.length; i++) {
    parts.push(walk(document.body.children[i]));
  }

  var svg = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
    'width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">\n' +
    parts.filter(Boolean).join('\n') + '\n</svg>\n';

  return svg;
})()
