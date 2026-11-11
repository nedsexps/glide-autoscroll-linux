# Glide Autoscroll — Chrome Web Store files

| File | What it's for |
|---|---|
| `glide-autoscroll-<version>-chrome-web-store.zip` | The package you upload. Not committed: build it with `npm run store:zip` |
| `listing.md` | Every dashboard field, with the exact text to paste |
| `release-<version>.md` | GitHub release notes for that version |
| `images/` | Store icon, four 1280×800 screenshots, small and marquee promo tiles |
| `kit.html` | The submission checklist page, built from `listing.md` and `../PRIVACY.md` |

The privacy policy is `PRIVACY.md` at the top of the repository; its GitHub page is the address to give the store.
| `art/` | The demo pages the screenshots are taken on (original content, made-up site) |

## Rebuilding after a change

From `glide-autoscroll-tests` (after `npm install`):

```sh
npm test               # everything still works
npm run store:zip      # new upload zip, named after the version in manifest.json
npm run store:images   # new screenshots and tiles, if anything visible changed
```

Then `python3 build-kit.py` here if you changed `listing.md` or `PRIVACY.md`.
Raise `version` in `glide-autoscroll/manifest.json` before uploading an update: the store
rejects a package whose version isn't higher than the published one.
