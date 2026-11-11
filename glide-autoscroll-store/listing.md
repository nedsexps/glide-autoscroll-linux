# Glide Autoscroll — Chrome Web Store listing

Everything to paste into the Chrome Web Store Developer Dashboard, field by field.
Text inside each `text` block goes into the dashboard exactly as written.

## Package tab

Upload `glide-autoscroll-1.2.1-chrome-web-store.zip` (built by `npm run store:zip` in
`glide-autoscroll-tests`, and attached to the GitHub release). Name, summary, version and icon come from the extension itself:

- Name: Glide Autoscroll
- Summary (from the manifest, 128 of 132 characters): Middle-click autoscroll for Linux and Mac. Press the wheel, move the mouse and the page glides, in panels, lists and embeds too.

## Store listing tab

### Description

```text
On Windows, you can press the mouse wheel and move the mouse to scroll a page. Chrome, Brave and other Chromium browsers on Linux don't have this: middle-click does nothing on a page, or pastes. Glide was made to fill that gap. It works the same on Mac, where Chrome doesn't have it either.

Press the middle mouse button (the scroll wheel) on a page, then move the mouse. The page glides in that direction, faster the further you move. Move back to where you clicked to stop.

WHAT IT DOES
• Scrolls whatever is under the pointer: the page, a sidebar, a chat or mail list, a code panel, a carousel or an embedded frame
• Smooth, steady speed at any display scaling or zoom level
• Two styles: click once and it keeps gliding until you click again, or hold the button and drag and it stops when you let go
• Middle-clicking a link still opens it in a new tab, and middle-click paste into text boxes still works
• Starting or stopping a glide never triggers Linux middle-click paste
• Hold Ctrl or Shift to get the browser's normal middle-click instead
• Stops with Esc, any click, any key or the scroll wheel

SETTINGS
• Speed, acceleration and dead zone, with a test area that uses your changes straight away
• Click to toggle, hold only, or both
• Switch it off for any site from the toolbar button
• Options to scroll an app's main panel when you click outside it, leave canvas-based pages such as maps and games alone, or invert the direction

PRIVATE BY DESIGN
Glide has no servers and makes no network requests. Your settings stay in your browser's extension storage (synced by your browser if you use sync). Apart from the sites you choose to switch it off on, nothing about the pages you visit is saved or sent anywhere.

OPEN SOURCE
Code, issues and the privacy policy: github.com/nedsexps/glide-autoscroll-linux

GOOD TO KNOW
Like every extension, Glide can't run on the browser's own pages (settings, extensions, new tab), on the Chrome Web Store or in the built-in PDF viewer. To use it on local files, turn on "Allow access to file URLs" for Glide on the extensions page.
```

### Category

```text
Functionality & UI
```

(Under "Make Chrome Yours". "Accessibility" is the other reasonable choice.)

### Language

```text
English
```

### Graphic assets (from `images/`)

| Dashboard field | File |
|---|---|
| Store icon (128×128) | `store-icon-128x128.png` |
| Screenshots (1280×800), in this order | `screenshot-1-glide.png`, `screenshot-2-panels.png`, `screenshot-3-settings.png`, `screenshot-4-popup.png` |
| Small promo tile (440×280) | `small-promo-tile-440x280.png` |
| Marquee promo tile (1400×560) | `marquee-promo-tile-1400x560.png` |

- Homepage URL: `https://github.com/nedsexps/glide-autoscroll-linux`
- Support URL: `https://github.com/nedsexps/glide-autoscroll-linux/issues`
- Global promo video and official URL: leave empty. Mature content: off.

## Privacy tab

### Single purpose description

```text
Glide Autoscroll adds middle-click autoscrolling to web pages: the user presses the middle mouse button and moves the mouse, and the page, or the scrollable area under the pointer, scrolls smoothly in that direction. The settings page, the toolbar popup and the per-site switch exist only to configure that one feature.
```

### Permission justification: storage

```text
Saves the user's autoscroll settings (speed, acceleration, dead zone, click style, display options, and the sites where they have switched Glide off) with chrome.storage.sync so they apply in every tab. Also keeps one random identifier in chrome.storage.local that the extension's own scripts use to recognise each other's messages between frames of the same page. No browsing data is stored and nothing is sent to any server.
```

### Permission justification: scripting

```text
Used only when the extension is installed, updated or re-enabled. Tabs that were already open don't have the content script yet, so chrome.scripting.executeScript injects the extension's own packaged files (shared.js and content.js) into them. This makes autoscroll work without the user reloading every tab. Nothing from outside the package is ever injected.
```

### Permission justification: host permission

```text
Autoscroll has to work on whatever page the user is reading, so the content script runs on all sites and in all frames (embedded frames and app panels scroll too). It listens for the middle mouse button, finds the scrollable element under the pointer and scrolls it. It only checks page layout (which elements can scroll) at the moment of a middle-click; it doesn't read, store or transmit page content. Users can switch it off for any site from the toolbar popup or limit it with the browser's site access settings.
```

### Remote code

Select **No, I am not using remote code.** (Every script ships inside the package; nothing is
fetched or evaluated at run time.)

### Data usage

Tick **none** of the data types. Glide doesn't collect user data: the mouse position and
clicks it reacts to are used in memory, only while scrolling, and are never stored or sent.
Then tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

If a reviewer ever disagrees, the fallback is to tick "User activity" and explain that it's
processed in memory only to scroll, never stored or transmitted.

### Privacy policy URL

```text
https://github.com/nedsexps/glide-autoscroll-linux/blob/main/PRIVACY.md
```

`PRIVACY.md` at the top of the repository. Google's User Data FAQ says an extension that only
uses Chrome's own storage still needs a policy, so don't skip it.

## Distribution tab

- Payments: Free
- Visibility: Public
- Regions: All regions

## Test instructions tab

```text
No account or setup needed. Open any long web page, press the middle mouse button (scroll wheel) and move the mouse up or down: the page scrolls, faster the further you move. Click again or press Esc to stop. The options page (right-click the toolbar icon, then Options) has scrollable test boxes next to the settings. As with all extensions, it doesn't run on chrome:// pages or the Chrome Web Store.
```
