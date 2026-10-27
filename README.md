# 3R Valentine's Office TV

Static GitHub Pages board for the office TV. One playlist of ten silent 15-second clips plays all year. A small opaque countdown chip in the corner counts calendar days to Valentine's Day in America/New_York.

The TV opens <https://ross680.github.io/Valentines-Office-Board/>.

The player is the hardened one from the [Holiday Office Board](https://github.com/ross680/Holiday-Office-Board), simplified to this single playlist: one reused `<video>` element, muted autoplay, an 8-second stall skip, a reload after 3 failures, a 4-hour reload on a clip boundary with a 4-hour-15-minute fallback, a per-clip `?v=` hash, a service-worker cache, a screen wake lock requested again when the page becomes visible, a hidden cursor, and a shuffle that does not repeat the clip that just played.

Clips live in `clips/` as `vl01.mp4` through `vl10.mp4`. Those filenames stay put. `vl02.mp4` and `vl10.mp4` may be replaced later under the same names.

## Countdown

The chip is a static label. It does not fade, animate, or sit on a translucent panel. The page background is black and the video uses `object-fit: contain`.

| America/New_York date | Chip |
| --- | --- |
| Any day except Feb 14 | `N DAYS UNTIL VALENTINE'S DAY` (or `1 DAY UNTIL VALENTINE'S DAY`) |
| Feb 14 | `HAPPY VALENTINE'S DAY!` |

After Feb 14 the count aims at Feb 14 of the next year. The date is read when the page loads and again each minute, so midnight Eastern updates the chip without waiting out the 4-hour reload. `?date=YYYY-MM-DD` pretends today is that calendar day.

## Publish on GitHub Pages

The page is a normal static site. It does not call the GitHub API. Pages is not turned on from this repo; switch it on once in GitHub:

1. Push this folder to `main`.
2. In GitHub: **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Branch: **main**. Folder: **/** (root).
5. Open <https://ross680.github.io/Valentines-Office-Board/> on the TV browser.

Pages can take a minute after the push. The TV may keep the previous `index.html` for about 10 minutes. The board reloads itself 4 hours after it was opened, after the current clip finishes, and the reload URL carries a `bust` query so the TV fetches a fresh copy. If a clip never ends, a second timer reloads at about 4 hours 15 minutes anyway. Each reload reads the New York date again.

`.nojekyll` is in the repo so Pages serves the files as they are.

## URL options

- `?date=YYYY-MM-DD` pretends today is that America/New_York calendar day.
- `?reload=4` reloads 4 hours after the page opened (the default), after the current clip ends. `?reload=0` turns that scheduled reload, and the 4 hour 15 minute fallback, off.
- `?maxclip=60` is a hard cap per video, in seconds (default 60). A normal clip ends itself first.
- `?stall=8` skips a clip when playback time has not moved for 8 seconds (the default). The same skip happens on a media error, or on abort, emptied, or stalled once that clip is actually stuck.
- `?slide=3` starts on that clip in the shuffled list (1 is the first).
- `?fresh=1` loads a new page for every clip. Last resort for a TV that still leaks memory.
- `?debug=1` shows the clip name, uptime, page loads, and the last problem.

A clip that errors, or never produces a picture, is skipped. One bad file does not stop the board. Three failures in a row reload the page. If the network is down, the board keeps cycling whatever the service worker has cached and does not reload into a dead page. When the network comes back it tries the current clip again. A failure reload will not repeat for 3 minutes, so a bad file cannot reboot the TV in a loop.

## Controls

Right arrow or Space: next · Left arrow: previous · P: pause · M: sound on/off · F: fullscreen

Clips start muted so Chrome and TV browsers allow autoplay. M, or the sound button, turns sound on. The clips in this set are silent.

The pointer stays hidden. Move it to see the controls and the clip count (`3 / 10`). The pointer hides again after a few seconds still. Nothing translucent is painted over the video.

## Playlist order

The ten clips are shuffled when the page starts and again when the cycle wraps. The clip that just finished is not placed first, so the same file does not play back to back.

## Replace a clip

`playlist.js` is the only playlist. The board does not scan the folder. Keep the filenames `vl01.mp4`–`vl10.mp4`.

1. Put the new 16:9 file in `clips/` under the same name.
2. Change the `?v=` text on that line (first 10 hex characters of the new SHA-256). Leave `?v=` alone when the bytes did not change, or the TV downloads the clip again for no reason.
3. Commit and push to `main`.

`app.js`, `styles.css`, and `playlist.js` are linked with `?v=20261027a`. Bump that text in `index.html` and the matching shell list in `sw.js` when you change those files so the TV does not keep an old copy.

Saved resume state uses its own `vl_` keys so it does not collide with the other office boards on the same `github.io` origin. The service worker only deletes cache buckets named `valentines-board-*`.

## Keeping the picture moving

One `<video>` element in the page is reused. Each clip is detached (`pause`, clear `src`, `load()`) before the next one so the TV can free the decoder. The next file is warmed on a single off-screen video that is never added to the page. That warmer is aborted the same way before it takes another file.

If `play()` is rejected, the board mutes and tries once more, then skips. Listeners and timers are registered once for the life of the page, not once per clip.

The screen wake lock is requested where the browser allows it, and requested again when the page becomes visible.

A service worker caches the page and the clips. After the TV has loaded them once, a network drop keeps the playlist playing from that cache.

After a scheduled reload the page resumes on the next clip.

## Encoding

Every shipped clip is the file as delivered: 1920×1080, 24 fps, 15.0 seconds, H.264 Main profile level 4.0, yuv420p, faststart, plus a silent AAC track. The player stays muted.

A lot of TVs only hardware-decode Baseline or Main. High profile with B-frames can stay black. If this TV does that, re-encode on a computer, put the new file in place of the old one, change `?v=`, and push:

```bash
ffmpeg -y -i "INPUT.mp4" \
  -c:v libx264 -profile:v main -level:v 4.0 -pix_fmt yuv420p \
  -r 24 -b:v 1800k -maxrate 2200k -bufsize 3600k -bf 0 \
  -an \
  -movflags +faststart \
  "OUTPUT.mp4"
```

If the picture is still black, use `-profile:v baseline -level:v 4.0 -bf 0` in place of the Main profile line.

## Tests

`npm test` checks the countdown (including Feb 14, the next Feb 14, leap day, and the New York midnight boundary), the `?date=` override, clip specs and `?v=` hashes, and a headless Chrome soak. The soak plays every clip once at 1× and records `getVideoPlaybackQuality` dropped frames, then keeps running clip ends faster and checks that the video element count, DOM size, listener count, and JS heap stay flat.
