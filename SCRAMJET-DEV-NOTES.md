Observed issue

Sometimes after a "hard reset" the Scramjet UI or the Chatbot will not work until the user clears cookies and site data. Symptoms seen while reproducing locally:

- The `/scramjet/` route loads but asset requests under `/scramjet/` (like `/scramjet/index.css`) sometimes fail or are served without the Cross-Origin isolation headers.
- The app logs show repeated session creation retries and intermittent `fetch failed` or `Connect Timeout Error` while the server-side `create-session` route retries upstream requests.
- Deleting cookies and site data resolves the issue immediately.

Probable causes

- A stale service worker previously registered under a slightly different scope can intercept requests and respond incorrectly or without required headers (Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy), causing the Scramjet isolation mode to break.
- Session cookie (`chatkit_session_id`) persisted in the browser may point to a server-side session that later becomes invalid, or the presence of the cookie changes server-side behavior and error handling paths.

What I changed

- Updated `public/scramjet/register-sw.js` to aggressively unregister any existing service worker registrations whose scope includes `/scramjet/` or matches the site origin. This reduces the chance that a stale worker will remain active after local resets.

Suggested developer fixes / next steps

1. Version your service worker file names or add a manifest-based cache-busting strategy so that new builds always register a new worker and old ones unregister reliably.

2. When registering the SW, consider checking existing registrations and calling `registration.update()` or `registration.unregister()` for any mismatching scope as we now do in `register-sw.js`.

3. Make session cookie behavior more deterministic during dev:
   - Consider setting `Max-Age` smaller in development to avoid stale session ids.
   - Offer an endpoint or client-side control to explicitly remove the `chatkit_session_id` cookie (e.g., on hard reset button) so that developer resets are reproducible without manual site data cleanup.

4. If the service worker needs to proxy upstream requests, ensure it preserves required headers (COOP/COEP) on responses and that fallback behavior handles network errors gracefully.

Workarounds for users / testers

- Clear site cookies and site data for `localhost` (Chrome: DevTools -> Application -> Clear storage -> Clear site data).
- Or open an incognito window which starts with a clean storage area.

How to verify locally

- Run the app and open DevTools -> Application -> Service Workers. Confirm there are no unexpected registrations with `/scramjet/` scope after pressing the app's "start scramjet" flow.
- Trigger a hard reset in the UI and see whether the scramjet UI continues to work without clearing cookies.

If you want, I can also:
- Add an endpoint to clear the session cookie programmatically and wire it to the "Reset chat" button in the UI.
- Add a dev-only toggle to skip setting the `Secure` attribute or shorten `Max-Age` for cookies in development.
