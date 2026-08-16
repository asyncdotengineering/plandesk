/**
 * Prototype frame shim — runs inside the opaque-origin HTML screen and speaks
 * to the shell over postMessage. Pure helpers are authored here and injected
 * via Function.prototype.toString(); they must not close over module bindings.
 *
 * AnnotationSelector: minimum shape the shim needs. The annotation task must
 * adopt or replace this — do not treat it as the final comments.anchor contract.
 *
 * The injected body uses `var` and defensive checks so it runs under the
 * frame's CSP with no toolchain; eslint rules that fight that are disabled here.
 */
/* eslint-disable no-var, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-base-to-string */

export type CanvasMode = 'arrange' | 'interact' | 'comment';

/**
 * Minimum selector shape for frame→shell selection messages.
 * Inferred: text uses quote+context+offsets; point uses click coords.
 * Annotation task owns the stored comments.anchor schema.
 */
export type AnnotationSelector =
  | {
      mode: 'text';
      quote: string;
      prefix: string;
      suffix: string;
      start: number;
      end: number;
      revisionId: string;
    }
  | {
      mode: 'point';
      x: number;
      y: number;
      revisionId: string;
    };

/**
 * Build a text-quote / text-position selector from offsets into fullText.
 * Self-contained for .toString() injection — no external references.
 */
export function buildTextAnchor(
  fullText: string,
  start: number,
  end: number,
  revisionId: string,
): AnnotationSelector {
  // Literals in-body — module consts are not in the injected IIFE scope.
  var maxQuote = 1000;
  var maxCtx = 32;
  const rawQuote = fullText.slice(start, end);
  const quote = rawQuote.length > maxQuote ? rawQuote.slice(0, maxQuote) : rawQuote;
  const prefix = fullText.slice(Math.max(0, start - maxCtx), start);
  const quoteEnd = start + quote.length;
  const suffix = fullText.slice(quoteEnd, quoteEnd + maxCtx);
  return {
    mode: 'text',
    quote: quote,
    prefix: prefix,
    suffix: suffix,
    start: start,
    end: quoteEnd,
    revisionId: revisionId,
  };
}

/**
 * Map textContent offsets under root into a Range. Returns null when the
 * offsets do not address valid text — never clamps to a nearby range.
 * Self-contained for .toString() injection.
 */
export function offsetsToRange(root: Node, start: number, end: number): Range | null {
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end < start) return null;
  const full = root.textContent === null || root.textContent === undefined ? '' : root.textContent;
  if (end > full.length) return null;

  const doc = root.ownerDocument;
  if (doc === null) return null;

  const range = doc.createRange();
  let pos = 0;
  let startSet = false;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node !== null) {
    const text =
      node.textContent === null || node.textContent === undefined ? '' : node.textContent;
    const len = text.length;
    if (!startSet && pos + len >= start) {
      range.setStart(node, start - pos);
      startSet = true;
    }
    if (startSet && pos + len >= end) {
      range.setEnd(node, end - pos);
      return range;
    }
    pos += len;
    node = walker.nextNode();
  }
  return null;
}

/**
 * Install the frame bridge. References buildTextAnchor and offsetsToRange as
 * free names — the wrap site injects those bindings into the same IIFE.
 */
export function installHtmlFrameShim(): void {
  var mode = 'interact';

  function post(msg: Record<string, unknown>): void {
    window.parent.postMessage(msg, '*');
  }

  function rectPayload(r: DOMRect): Record<string, number> {
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      left: r.left,
    };
  }

  function revisionId(): string {
    try {
      var v = new URL(location.href).searchParams.get('v');
      return v === null ? '' : v;
    } catch (_e) {
      return '';
    }
  }

  function bodyText(): string {
    if (!document.body) return '';
    return document.body.textContent === null || document.body.textContent === undefined
      ? ''
      : document.body.textContent;
  }

  function bodyHeight(): number {
    var docEl = document.documentElement;
    var body = document.body;
    var a = docEl ? docEl.scrollHeight : 0;
    var b = body ? body.scrollHeight : 0;
    return a > b ? a : b;
  }

  function reportReady(): void {
    post({ kind: 'plandesk:ready', height: bodyHeight(), text: bodyText() });
  }

  function reportResize(): void {
    post({ kind: 'plandesk:resize', height: bodyHeight(), text: bodyText() });
  }

  function isMode(value: unknown): boolean {
    return value === 'arrange' || value === 'interact' || value === 'comment';
  }

  function offsetOf(root: Node, node: Node, off: number): number {
    if (node.nodeType !== 3) {
      var wEl = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      var totalEl = 0;
      var nEl: Node | null = wEl.nextNode();
      var inside = false;
      var acc = 0;
      while (nEl !== null) {
        var p: Node | null = nEl;
        var hit = false;
        while (p) {
          if (p === node) {
            hit = true;
            break;
          }
          p = p.parentNode;
        }
        var nElText =
          nEl.textContent === null || nEl.textContent === undefined ? '' : nEl.textContent;
        if (hit) {
          if (!inside) {
            inside = true;
            if (off === 0) return totalEl;
          }
          acc += nElText.length;
          if (off > 0 && acc >= off) return totalEl + nElText.length - (acc - off);
        } else if (inside) {
          return totalEl;
        }
        totalEl += nElText.length;
        nEl = wEl.nextNode();
      }
      return totalEl;
    }
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var total = 0;
    var n: Node | null = w.nextNode();
    while (n !== null) {
      var nText = n.textContent === null || n.textContent === undefined ? '' : n.textContent;
      if (n === node) return total + off;
      total += nText.length;
      n = w.nextNode();
    }
    return total;
  }

  window.addEventListener('message', function (event: MessageEvent) {
    if (event.source !== window.parent) return;
    var m = event.data;
    if (m === null || typeof m !== 'object') return;
    var data = m as { kind?: string; mode?: string; start?: number; end?: number };
    if (data.kind === 'plandesk:mode' && isMode(data.mode)) {
      mode = data.mode as string;
      return;
    }
    if (data.kind === 'plandesk:highlight') {
      var start = data.start;
      var end = data.end;
      if (typeof start !== 'number' || typeof end !== 'number' || !document.body) {
        post({ kind: 'plandesk:rect', rect: null });
        return;
      }
      var range = offsetsToRange(document.body, start, end);
      if (range === null) {
        post({ kind: 'plandesk:rect', rect: null });
        return;
      }
      var scrollTarget: Element | null =
        range.startContainer.nodeType === 1
          ? (range.startContainer as Element)
          : range.startContainer.parentElement;
      if (scrollTarget) {
        scrollTarget.scrollIntoView({ block: 'nearest' });
      }
      post({ kind: 'plandesk:rect', rect: rectPayload(range.getBoundingClientRect()) });
    }
  });

  document.addEventListener(
    'wheel',
    function (e: WheelEvent) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    },
    { capture: true, passive: false },
  );

  document.addEventListener(
    'click',
    function (e: MouseEvent) {
      if (mode === 'comment') {
        e.preventDefault();
        var sel = window.getSelection();
        var full = bodyText();
        var rev = revisionId();
        if (sel && !sel.isCollapsed && sel.rangeCount > 0 && document.body) {
          var selRange = sel.getRangeAt(0);
          var startOff = offsetOf(document.body, selRange.startContainer, selRange.startOffset);
          var endOff = offsetOf(document.body, selRange.endContainer, selRange.endOffset);
          if (endOff > startOff && full.slice(startOff, endOff).trim() !== '') {
            post({
              kind: 'plandesk:selection',
              selector: buildTextAnchor(full, startOff, endOff, rev),
              rect: rectPayload(selRange.getBoundingClientRect()),
            });
            return;
          }
        }
        post({
          kind: 'plandesk:selection',
          selector: { mode: 'point', x: e.clientX, y: e.clientY, revisionId: rev },
          rect: {
            x: e.clientX,
            y: e.clientY,
            width: 0,
            height: 0,
            top: e.clientY,
            right: e.clientX,
            bottom: e.clientY,
            left: e.clientX,
          },
        });
        return;
      }

      var target = e.target;
      if (!(target instanceof Element)) return;
      var anchor = target.closest('a[href]');
      if (!anchor) return;
      var href = anchor.getAttribute('href');
      if (href === null) return;
      if (href.indexOf('plandesk://') === 0) {
        e.preventDefault();
        post({ kind: 'plandesk:navigate', target: href });
        return;
      }
      if (href.indexOf('/') === 0 || href.indexOf('#') === 0) {
        e.preventDefault();
      }
    },
    true,
  );

  window.onerror = function (message: string | Event) {
    post({
      kind: 'plandesk:error',
      message: typeof message === 'string' ? message : String(message),
    });
    return false;
  };

  window.addEventListener('unhandledrejection', function (event: PromiseRejectionEvent) {
    var reason = event.reason;
    post({
      kind: 'plandesk:error',
      message: reason instanceof Error ? reason.message : String(reason),
    });
  });

  var origError = console.error;
  console.error = function (...args: unknown[]) {
    post({
      kind: 'plandesk:error',
      message: args
        .map(function (a) {
          return a instanceof Error ? a.message : String(a);
        })
        .join(' '),
    });
    Function.prototype.apply.call(origError, console, args);
  };

  document.addEventListener(
    'securitypolicyviolation',
    function (event: SecurityPolicyViolationEvent) {
      post({
        kind: 'plandesk:blocked',
        directive: event.violatedDirective,
        blockedUri: event.blockedURI,
      });
    },
  );

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reportReady);
  } else {
    reportReady();
  }

  if (typeof ResizeObserver !== 'undefined' && document.body) {
    var lastText = bodyText();
    var lastHeight = bodyHeight();
    var ro = new ResizeObserver(function () {
      var nextText = bodyText();
      var nextHeight = bodyHeight();
      if (nextText !== lastText || nextHeight !== lastHeight) {
        lastText = nextText;
        lastHeight = nextHeight;
        reportResize();
      }
    });
    ro.observe(document.body);
  }
}

function escapeScriptContents(source: string): string {
  return source.replace(/<\/(script)/gi, '<\\/$1');
}

/** Assemble the injectable `<script>` from .toString() of the pure helpers. */
export function buildHtmlArtifactShimScript(): string {
  const body = escapeScriptContents(
    `(function(){\n` +
      `var buildTextAnchor=${buildTextAnchor.toString()};\n` +
      `var offsetsToRange=${offsetsToRange.toString()};\n` +
      `(${installHtmlFrameShim.toString()})();\n` +
      `})();`,
  );
  return `<script>${body}</script>`;
}

export const HTML_ARTIFACT_SHIM = buildHtmlArtifactShimScript();
