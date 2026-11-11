## Middle-click autoscroll for Linux

First public release. Chrome, Brave and Chromium on Linux have no middle-click autoscroll, the feature Windows users get out of the box. Existing extensions that try to add it fell short in everyday use (jerky scrolling, inner panels that wouldn't scroll, middle-click paste going off), so Glide was written from scratch. It adds the feature properly: press the mouse wheel on a page, move the mouse, and the page glides. It works on Mac too.

### Install

**Chrome Web Store:** coming soon.

**From this release** (no automatic updates):
1. Download `glide-autoscroll-1.2.1-chrome-web-store.zip` below and unzip it into a folder you'll keep.
2. Open `chrome://extensions` (`brave://extensions` in Brave) and turn on **Developer mode**.
3. Click **Load unpacked** and choose the unzipped folder.

### What it does

- Scrolls whatever is under the pointer: the page, a sidebar, a chat or mail list, a code panel, a carousel or an embedded frame
- Smooth, steady speed at any display scaling or zoom level
- Click once to keep gliding until you click again, or hold and drag to stop when you let go
- Links still open in a new tab on middle-click, and middle-click paste into text boxes still works
- Starting or stopping a glide never pastes
- Settings for speed, acceleration and dead zone, with a test area; switch it off per site from the toolbar button
- No servers, no network requests, no data collected ([privacy policy](https://github.com/nedsexps/glide-autoscroll-linux/blob/main/PRIVACY.md))

### Tested

Chrome 153 on Linux (X11) with 142 automated browser tests. Not yet tested in Brave, on Wayland or on a Mac. If something doesn't work, please [open an issue](https://github.com/nedsexps/glide-autoscroll-linux/issues).
