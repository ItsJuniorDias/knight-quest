# Deploying Knight Quest

The game is a static site: `index.html` + `bundle.js` + `assets/*.glb`.
Total payload ~35MB. Any static host works.

Recommended: **Vercel** (fastest CDN, zero config, custom domain free).

## Option 1 — Vercel (recommended, 2 minutes)

```bash
npm install -g vercel
cd knight-quest/
vercel                 # first run: choose "link to new project"
vercel --prod          # deploy to production
```

The URL Vercel prints (e.g. `knight-quest.vercel.app`) goes into
`Magic-World/app/(tabs)/games.tsx` — search for `externalUrl:` in the
Knight Quest entry and replace the placeholder.

For a custom domain (`knight-quest.magicworld.app`):
1. Vercel dashboard → project → Settings → Domains
2. Add `knight-quest.magicworld.app`
3. Add the CNAME record they show at your DNS provider

## Option 2 — Netlify

```bash
npm install -g netlify-cli
cd knight-quest/
netlify deploy         # preview URL
netlify deploy --prod  # production URL
```

Same drop-in URL swap in `games.tsx`.

## Option 3 — Cloudflare Pages

Web UI: dashboard.cloudflare.com → Pages → Create → Upload assets.
Drag the `knight-quest/` folder in. Done.

Or via CLI:
```bash
npm install -g wrangler
cd knight-quest/
wrangler pages deploy . --project-name knight-quest
```

The `_headers` file is picked up automatically.

## Option 4 — GitHub Pages (free but no build step)

Push the repo including `bundle.js`. Enable Pages in Settings → Pages,
serve from `main` branch, root.

URL will be `<username>.github.io/<repo>/`.

## Testing locally before deploying

```bash
cd knight-quest/
node build.mjs      # regenerate bundle.js
npx serve .         # opens http://localhost:3000
```

Open on a phone browser to test the touch controls — desktop and mobile
share the same HTML.

## Cache-busting after an update

Every host above caches `assets/*.glb` for a year (they never change) and
`bundle.js` for an hour. If you push a hot-fix, the game will pick it up
within an hour without users having to reinstall. For urgent fixes,
rename `bundle.js` to `bundle.v2.js` and update the reference in
`index.html`.

## Integration in Magic World

Once deployed, in `Magic-World/app/(tabs)/games.tsx`:

```ts
{
  id: "knight-quest",
  externalUrl: "https://YOUR-DEPLOYED-URL",  // ← swap here
  ...
},
```

The card in the Games tab will open the URL in the in-app browser (via
`expo-web-browser`), full-screen, with amber-tinted controls. The player
doesn't perceive it as leaving the app.
