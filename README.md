# Angle Rip-off

A Wordle-style daily game: a random angle between 0° and 360° is picked once per day
(resetting at midnight America/New_York), and you have 10 guesses to find it — in radians.
Guesses are graded Cold 🧊 / Warm 🌤️ / Hot 🔥 / Boiling 🥵 / Correct ✅ by how close you are.

Entirely static and client-side — no backend, no build step. The day's angle is derived
deterministically from the date (so it's the same for everyone), and your guesses/results for
the day persist in `localStorage`.

## Deploy to Netlify (drag & drop)

1. Go to [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag this whole `angle-rip-off` folder into the browser window.
3. It deploys instantly to a `*.netlify.app` URL — no git, no build config needed since it's
   just static files.
4. Optional: in the Netlify dashboard, add your own custom domain under Site settings → Domain
   management, then point a CNAME at your registrar to the `*.netlify.app` address Netlify
   gives you.

Clipboard copy (`navigator.clipboard`) needs HTTPS, which Netlify gives you automatically — the
`document.execCommand('copy')` fallback in `script.js` is only there for plain-HTTP self-hosting.

## Self-hosting elsewhere

Any static file server works. From this folder:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`. It's just three files (`index.html`, `style.css`,
`script.js`) — put them behind whatever you already use to self-host (nginx, Caddy, etc.).
