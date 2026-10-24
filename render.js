// Safe message rendering: never builds markup from strings. Text goes in via text nodes; images only for validated http(s) URLs.
// Works in the browser (window.PersonaRender) and in Node (module.exports) so it can be unit-tested.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PersonaRender = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var IMG_EXT = /\.(?:jpe?g|png|webp|gif|avif)$/i;
  var IMGCHEST_HOST = /(^|\.)imgchest\.com$/i;
  var URL_RE = /https?:\/\/[^\s<>"'`\\]+/gi;

  // Returns a normalised http(s) image URL, or null.
  function imageUrl(raw) {
    if (typeof raw !== 'string' || raw.length > 2000) return null;
    var u;
    try { u = new URL(raw); } catch (_) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    if (!IMG_EXT.test(u.pathname) && !IMGCHEST_HOST.test(u.hostname)) return null;
    return u.href;
  }

  // Splits text into [{type:'text',value} | {type:'image',url}].
  // While streaming (final=false) a URL touching the end of the text may be incomplete, so it stays text.
  function tokenize(text, final) {
    var out = [];
    var last = 0;
    var m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(text)) !== null) {
      var raw = m[0];
      var trimmed = raw.replace(/[.,;:!?)\]}*_]+$/, ''); // trailing punctuation is not part of the link
      var end = m.index + raw.length;
      var url = imageUrl(trimmed);
      if (!url || (!final && end >= text.length)) continue;
      if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) });
      out.push({ type: 'image', url: url });
      last = m.index + trimmed.length;
      URL_RE.lastIndex = last;
    }
    if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
    return out;
  }

  var INLINE_RE = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;

  // Appends text (with `code`, **bold**, *italic*) to parent using DOM nodes only.
  function appendInline(doc, parent, text) {
    var last = 0;
    var m;
    INLINE_RE.lastIndex = 0;
    while ((m = INLINE_RE.exec(text)) !== null) {
      if (m.index > last) parent.appendChild(doc.createTextNode(text.slice(last, m.index)));
      var tag = m[1] !== undefined ? 'code' : m[2] !== undefined ? 'strong' : 'em';
      var el = doc.createElement(tag);
      el.textContent = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
      parent.appendChild(el);
      last = m.index + m[0].length;
    }
    if (last < text.length) parent.appendChild(doc.createTextNode(text.slice(last)));
  }

  function makeImage(doc, url, onZoom) {
    var img = doc.createElement('img');
    img.className = 'inline-img';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.setAttribute('referrerpolicy', 'no-referrer');
    img.alt = 'image';
    img.src = url;
    img.addEventListener('click', function () { if (onZoom) onZoom(url, ''); });
    img.addEventListener('error', function () {
      // Not a direct image (e.g. an imgchest.com/p/... page link): show a safe link instead.
      var a = doc.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer nofollow';
      a.referrerPolicy = 'no-referrer';
      a.textContent = url;
      if (img.parentNode) img.parentNode.replaceChild(a, img);
    });
    return img;
  }

  // Replaces container's content with the rendered message.
  function render(doc, container, text, opts) {
    opts = opts || {};
    while (container.firstChild) container.removeChild(container.firstChild);
    var parts = tokenize(text || '', opts.final !== false);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.type === 'text') appendInline(doc, container, p.value);
      else container.appendChild(makeImage(doc, p.url, opts.onZoom));
    }
  }

  return { imageUrl: imageUrl, tokenize: tokenize, render: render, appendInline: appendInline, makeImage: makeImage };
});
