# Glide Autoscroll tests

Browser tests for the extension in `../glide-autoscroll`. They load the unpacked extension
into a real Chromium-family browser, drive real middle-clicks, and check what scrolled.
Nothing here is needed to use the extension.

## Running

Needs Node 18+ and Chrome, Chromium or Brave installed.

```sh
cd glide-autoscroll-tests
npm install
npm test             # store, core, fixes-1.1, fixes-1.2, install (headless, about 4 minutes)
npm run test:paste   # Linux middle-click paste; opens a browser window
npm run lint
npm run store:zip    # the Chrome Web Store upload, in ../glide-autoscroll-store
npm run store:images # store screenshots and promo tiles, in ../glide-autoscroll-store/images
```

Each suite can also be run by itself, e.g. `node fixes-1.2.mjs`.

- `GLIDE_BROWSER=/usr/bin/brave npm test` picks the browser. The suites were written and run
  against Chrome; running them in Brave should work but hasn't been tried.
- `GLIDE_EXT=/some/other/copy npm test` tests a different copy of the extension.
- Ports 8123 and 8124 must be free (8125 for `store:images`): the test pages are served from two origins so embedded
  frames are genuinely cross-site.
- `test:paste` selects some text and middle-clicks, so on a desktop it uses (and replaces)
  your real selection clipboard. `xvfb-run -a npm run test:paste` keeps it off your screen.

## What's covered

| Suite | Covers |
|---|---|
| `core.mjs` | What gets scrolled (nested boxes, carousels, shadow DOM, the page), click styles, links and text boxes left alone, iframes, blocklist, smoothness, settings page, popup |
| `fixes-1.1.mjs` | Display scaling and page zoom, chorded clicks, hidden pointer events, modal dialogs, embeds, app-style pages, scrollbars, closed shadow roots, settings saving |
| `fixes-1.2.mjs` | Bottom-up and right-to-left scroll areas, frames cooperating with junk screen coordinates, embeds that can't pass a click on, vanishing scroll targets, made-up events, forged frame messages, settings page access |
| `install.mjs` | Tabs already open at install, at update, and when the extension is switched off and on |
| `store.mjs` | Chrome Web Store readiness: manifest limits, minimal permissions, icon sizes and padding, no remote code, the real toolbar popup |
| `paste-x11.mjs` | No glide ever pastes; ordinary middle-click paste still works |

A timing-sensitive check can fail on a heavily loaded machine; run the suite again before
believing a single failure.
