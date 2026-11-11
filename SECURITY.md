# Security policy — Ledwall Visuals

## Production safety

- **Do not make this repository private or disable GitHub Pages until an authenticated hosting replacement has been deployed and tested.**
- `index.html` currently downloads `widget.js` from the GitHub Contents API for Scriptable iOS. A private repository would break its automatic updates without a replacement public asset URL.
- Test Scriptable automatic updates from an iPhone or iPad before switching the widget source or private repository visibility.
- Use the Supabase **publishable** key in browser code only. Never commit Supabase service-role or secret keys, webhook secrets, Green API credentials, passwords, access tokens, or `.env` files.
- Access control must be enforced by Supabase RLS/server code, not only by UI checks.
- Serve the widget JavaScript from a **dedicated, public, versioned read-only endpoint** while keeping the app private. Publishing just widget code does not require publishing the application's source. Do not put personal calendar tokens in that public code.
- The Scriptable bootstrapper currently executes remotely fetched code with `eval()`. Preserve reliable iOS updates during migration, then replace the remote-code execution design with a tested Scriptable module-loading mechanism and a trusted update channel.

## Safe migration checklist

1. Inventory GitHub Pages, Netlify, Scriptable, calendar URLs and relevant redirects.
2. Provision the new app host with deployment protection and verify account access from iOS, iPadOS and desktop.
3. Provision a dedicated publicly readable `widget.js` URL, deploy current code, test it from iOS Scriptable.
4. Update widget download URL and any installation instructions, retain a rollback path, verify subsequent script changes automatically appear on iOS.
5. Only after the tests succeed, make this application repository private and disable obsolete public copies.
6. Rotate any actual **secret** credentials previously committed; history and existing clones cannot be made private retroactively.

## Reporting

For security issues contact the repository administrators privately; never paste production credentials in GitHub Issues.
