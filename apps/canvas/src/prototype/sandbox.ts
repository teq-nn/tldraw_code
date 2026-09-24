/**
 * The sandbox every HTML prototype runs in (ADR 0016). The prototype's HTML is
 * written by a model and must be treated as untrusted: it may only draw into
 * its own frame and run its own scripts, never touch the canvas app, its
 * origin, the bridge, the user's other sites or the network.
 */

/**
 * `sandbox` tokens of the prototype iframe. Deliberately NOT granted:
 * `allow-same-origin` (the document keeps an opaque origin, so it cannot reach
 * the canvas's DOM, storage, cookies or IndexedDB, and its requests carry
 * `Origin: null`), `allow-top-navigation*`, `allow-popups*`, `allow-modals`,
 * `allow-downloads`, `allow-pointer-lock`, `allow-presentation`,
 * `allow-orientation-lock` and `allow-storage-access-by-user-activation`.
 * `allow-forms` only lets submit events fire; the CSP's `form-action 'none'`
 * still blocks every actual submission.
 */
export const PROTOTYPE_SANDBOX = 'allow-scripts allow-forms'

/**
 * Content Security Policy injected as the first element of every prototype
 * document. Inline scripts and styles only; images, fonts and media only from
 * `data:` / `blob:` URLs; no fetch, XHR, WebSocket, EventSource, form
 * submission, nested frames, workers, plugins or `<base>` rewriting. A
 * policy delivered by `<meta>` cannot be loosened by later markup or script:
 * a second policy can only restrict further.
 */
export const PROTOTYPE_CSP = [
	"default-src 'none'",
	"script-src 'unsafe-inline'",
	"style-src 'unsafe-inline'",
	'img-src data: blob:',
	'font-src data:',
	'media-src data: blob:',
	"connect-src 'none'",
	"form-action 'none'",
	"base-uri 'none'",
	"frame-src 'none'",
	"child-src 'none'",
	"worker-src 'none'",
	"object-src 'none'",
	"manifest-src 'none'",
].join('; ')

/** Permissions Policy of the iframe: no powerful feature at all. */
export const PROTOTYPE_ALLOW =
	"camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; " +
	"clipboard-write 'none'; display-capture 'none'; fullscreen 'none'; payment 'none'; usb 'none'"

/** `type` of the snapshot request and reply between the canvas and a prototype. */
export const SNAPSHOT_MESSAGE = 'tldraw-code:prototype-snapshot'

/**
 * Runs inside the prototype (under its CSP) and answers the canvas's snapshot
 * requests with the document's current markup, scripts removed and form state
 * copied into attributes, so a screenshot shows what the user sees. The reply
 * is untrusted data to the canvas: it is only ever rasterised as an SVG image
 * (no scripts, no network), never inserted into the canvas's DOM.
 */
const SNAPSHOT_SCRIPT = `(function () {
  var T = '${SNAPSHOT_MESSAGE}';
  addEventListener('message', function (e) {
    var d = e.data;
    if (e.source !== parent || !d || d.type !== T) return;
    var markup = '';
    try {
      var root = document.documentElement.cloneNode(true);
      var live = document.documentElement.querySelectorAll('input,textarea,select');
      var copy = root.querySelectorAll('input,textarea,select');
      for (var i = 0; i < live.length && i < copy.length; i++) {
        var a = live[i], b = copy[i];
        if (a.tagName === 'TEXTAREA') b.textContent = a.value;
        else if (a.tagName === 'SELECT') {
          for (var j = 0; j < a.options.length; j++) {
            if (a.options[j].selected) b.options[j].setAttribute('selected', '');
            else b.options[j].removeAttribute('selected');
          }
        } else if (a.type === 'checkbox' || a.type === 'radio') {
          if (a.checked) b.setAttribute('checked', ''); else b.removeAttribute('checked');
        } else b.setAttribute('value', a.value);
      }
      var scripts = root.querySelectorAll('script');
      for (var k = 0; k < scripts.length; k++) scripts[k].remove();
      markup = new XMLSerializer().serializeToString(root);
    } catch (err) {}
    parent.postMessage({ type: T, nonce: d.nonce, markup: markup }, '*');
  });
})();`

const LEADING_DOCTYPE = /^\s*<!doctype[^>]*>/i

/**
 * The `srcdoc` of a prototype frame: a standards-mode document whose very
 * first element is the CSP, followed by the snapshot helper and then the
 * prototype's own markup. The prototype cannot place anything before the
 * policy, so nothing it contains loads or runs outside it.
 */
export function sandboxDocument(html: string): string {
	const body = html.replace(LEADING_DOCTYPE, '')
	return [
		'<!doctype html>',
		`<meta http-equiv="Content-Security-Policy" content="${PROTOTYPE_CSP}">`,
		'<meta name="referrer" content="no-referrer">',
		`<script>${SNAPSHOT_SCRIPT}</script>`,
		body,
	].join('\n')
}

/**
 * Escape hatch: `?prototypes=off` in the canvas URL shows every prototype as
 * a placeholder instead of running it, e.g. when one hangs the tab.
 */
export function prototypesDisabled(search: string = globalThis.location?.search ?? ''): boolean {
	return new URLSearchParams(search).get('prototypes') === 'off'
}
