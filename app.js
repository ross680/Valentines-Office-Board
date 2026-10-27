(() => {
  // Office TV board for Valentine's Day. One <video> plays playlist.js.
  // One off-document warmer preloads the next file and is aborted (src cleared,
  // load()) before it is reused. Listeners and timers are created once.
  // A stuck or broken clip is skipped. The countdown is resolved on load
  // (including the 4-hour reload) and again each minute, so midnight
  // America/New_York updates the chip.
  const params = new URLSearchParams(location.search);
  const schedule = window.ValentineBoard;

  function num(key, fallback, min, max) {
    if (!params.has(key)) return fallback;
    const n = Number(params.get(key));
    if (!isFinite(n)) return fallback;
    if (n < min) return min;
    if (max != null && n > max) return max;
    return n;
  }

  const maxClip = num("maxclip", 60, 10, 600);
  const stallMs = num("stall", 8, 1, 120) * 1000;
  const reloadHours = num("reload", 4, 0, 168);
  const fresh = params.get("fresh") === "1";
  const debug = params.get("debug") === "1";
  const FAIL_LIMIT = 3;
  const FAILURE_BACKOFF_MS = 180000;
  const HARD_EXTRA_MS = 15 * 60 * 1000;
  const HOUR_MS = 3600000;

  const stage = document.getElementById("stage");
  const vid = document.getElementById("vid");
  const counter = document.getElementById("counter");
  const countdown = document.getElementById("countdown");
  const pauseBtn = document.getElementById("pause");
  const soundBtn = document.getElementById("sound");

  // vl_ keys stay off the Thanksgiving, Christmas, and year-round holiday
  // boards. Those sites share this github.io origin.
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  if (!store.get("vl_since")) store.set("vl_since", String(Date.now()));
  store.set("vl_loads", String((Number(store.get("vl_loads")) || 0) + 1));

  // The muted property has to be set in script. The HTML attribute alone is not
  // enough for some TV browsers, and audible autoplay is what they block.
  vid.muted = true;
  vid.defaultMuted = true;
  vid.loop = false;
  vid.playsInline = true;
  vid.preload = "auto";
  try { vid.disablePictureInPicture = true; } catch (e) {}
  let wantSound = false;

  let clips = [];
  let sourceClips = [];
  let index = 0;
  let generation = 0;
  let expectedSrc = "";
  let paused = false;
  let failures = 0;
  let failedGen = -1;
  let retryGen = -1;
  let reloading = false;
  let releasing = false;
  let armed = false;
  let offline = typeof navigator.onLine === "boolean" ? navigator.onLine === false : false;
  let lastGood = Date.now();
  let lastMediaTime = -1;
  let sawFrame = false;
  let clipStarted = 0;
  let wakeLock = null;
  let lastWake = 0;
  let preloader = null;
  let preloaded = "";
  let armTimer = 0;
  let failTimer = 0;
  let idleTimer = 0;
  let countdownTimer = 0;
  let cacheAsked = false;
  const booted = Date.now();
  const reloadAt = reloadHours > 0 ? booted + reloadHours * HOUR_MS : 0;
  const hardAt = reloadAt ? reloadAt + HARD_EXTRA_MS : 0;
  let lastMessage = null;

  function clock() {
    try {
      if (typeof window.__nowMs === "function") return window.__nowMs();
    } catch (e) {}
    return Date.now();
  }

  function nowDate() {
    try {
      if (typeof window.__now === "function") return window.__now();
    } catch (e) {}
    return new Date();
  }

  function note(msg) {
    store.set("vl_err", new Date().toLocaleTimeString() + " " + msg);
  }

  function labelOf(src) {
    const path = (src || "").split("?")[0];
    const parts = path.split("/");
    return parts[parts.length - 1] || src || "clip";
  }

  function activeParts() {
    try {
      if (typeof window.__parts === "function") {
        const hooked = window.__parts();
        if (hooked && hooked.y && hooked.m && hooked.d) return hooked;
      }
    } catch (e) {}
    const raw = params.get("date");
    if (raw && schedule) {
      const parsed = schedule.parseISODate(raw);
      if (parsed) return parsed;
    }
    return schedule.partsInTimeZone(nowDate(), schedule.timeZone);
  }

  function currentResolved() {
    if (!schedule) {
      return { mode: "empty", days: 0, message: "", clips: [] };
    }
    return schedule.resolve(activeParts());
  }

  function paintChip(resolved) {
    const next = resolved || currentResolved();
    const text = next && next.message ? next.message : "";
    if (text !== lastMessage) {
      lastMessage = text;
      countdown.textContent = text;
    }
    countdown.hidden = !text;
  }

  function publish() {
    const resolved = currentResolved();
    window.__board = {
      index: index,
      count: clips.length,
      src: clips.length ? clips[index] : "",
      mode: resolved.mode,
      days: resolved.days,
      message: countdown.hidden ? "" : countdown.textContent,
      paused: paused,
      failures: failures,
      preload: preloaded,
      offline: offline,
      videos: document.querySelectorAll("video").length,
      booted: booted,
      reloadAt: reloadAt,
      hardAt: hardAt
    };
  }

  function askCache() {
    if (cacheAsked || !schedule || !navigator.serviceWorker) return;
    cacheAsked = true;
    navigator.serviceWorker.ready.then((reg) => {
      if (reg.active) reg.active.postMessage({ type: "cache-clips", urls: schedule.CLIPS.slice() });
    }).catch(() => {});
  }

  function warmer() {
    if (preloader) return preloader;
    preloader = document.createElement("video");
    preloader.muted = true;
    preloader.defaultMuted = true;
    preloader.playsInline = true;
    preloader.preload = "auto";
    preloader.setAttribute("aria-hidden", "true");
    try { preloader.disablePictureInPicture = true; } catch (e) {}
    // Swallow preload errors. The playback element decides if a file is bad.
    preloader.addEventListener("error", () => {});
    return preloader;
  }

  function abortPreload() {
    preloaded = "";
    if (!preloader) return;
    try { preloader.pause(); } catch (e) {}
    preloader.removeAttribute("src");
    preloader.src = "";
    try { preloader.load(); } catch (e) {}
  }

  function preloadNext() {
    if (clips.length < 2) {
      abortPreload();
      return;
    }
    const next = clips[(index + 1) % clips.length];
    if (!next || next === preloaded) return;
    abortPreload();
    preloaded = next;
    warmer().src = next;
  }

  function releaseVideo() {
    releasing = true;
    armed = false;
    abortPreload();
    expectedSrc = "";
    try { vid.pause(); } catch (e) {}
    vid.classList.remove("on");
    vid.removeAttribute("src");
    try { vid.load(); } catch (e) {}
    releasing = false;
  }

  function playClip() {
    const gen = generation;
    let ret;
    try { ret = vid.play(); } catch (e) { ret = Promise.reject(e); }
    // Older TV browsers return undefined from play(). Calling .then on that throws.
    Promise.resolve(ret).then(() => {
      if (gen !== generation) return;
      if (paused) {
        try { vid.pause(); } catch (e) {}
        return;
      }
      vid.classList.add("on");
      lastGood = Date.now();
    }).catch((err) => {
      if (gen !== generation || paused || reloading) return;
      if (err && err.name === "AbortError") return;
      // One muted retry per clip. Audible autoplay is what TV browsers reject.
      if (retryGen !== gen) {
        retryGen = gen;
        vid.muted = true;
        wantSound = false;
        soundBtn.textContent = "\uD83D\uDD07";
        soundBtn.setAttribute("aria-label", "Turn sound on");
        playClip();
        return;
      }
      failClip("playback rejected");
    });
  }

  function rememberPosition(nextIndex) {
    if (!clips.length) return;
    const next = ((nextIndex % clips.length) + clips.length) % clips.length;
    store.set("vl_last", schedule.clipPath(clips[index]));
    store.set("vl_next", schedule.clipPath(clips[next]));
  }

  function safeReload(reason, nextIndex) {
    if (reloading) return;
    const failureReload = reason === "failures";
    if (failureReload && offline) return;
    const last = Number(store.get("vl_reload_at")) || 0;
    // A clip that kills the page must not reboot the TV every few seconds.
    if (failureReload && Date.now() - last < FAILURE_BACKOFF_MS) {
      failures = 0;
      advance(true);
      return;
    }
    reloading = true;
    note(reason);
    store.set("vl_reload_at", String(Date.now()));
    store.set("vl_reason", reason);
    if (clips.length) {
      const next = nextIndex == null ? (index + 1) % clips.length : nextIndex;
      rememberPosition(next);
    }
    const url = new URL(location.href);
    url.searchParams.set("bust", String(Date.now()));
    location.replace(url.toString());
  }

  function failClip(reason) {
    if (reloading || releasing) return;
    const gen = generation;
    if (failedGen === gen) return;
    failedGen = gen;
    note(reason);
    failures += 1;
    const snapshot = failures;
    if (failTimer) clearTimeout(failTimer);
    // Leave the current call stack. error/abort can fire inside show().
    failTimer = setTimeout(() => {
      failTimer = 0;
      if (generation !== gen || reloading) return;
      if (failures < snapshot) return;
      if (failures >= FAIL_LIMIT && !offline) {
        safeReload("failures");
        return;
      }
      if (failures >= FAIL_LIMIT && offline) failures = 0;
      advance(false);
    }, 0);
  }

  function goTo(n) {
    if (reloading) return;
    if (fresh && clips.length > 1) {
      const next = ((n % clips.length) + clips.length) % clips.length;
      safeReload("fresh", next);
      return;
    }
    show(n);
  }

  function advance(manual) {
    if (!clips.length || reloading) return;
    if (!manual && reloadAt && clock() >= reloadAt) {
      safeReload("scheduled");
      return;
    }
    if (clips.length === 1) {
      show(0);
      return;
    }
    if (index >= clips.length - 1) {
      clips = schedule.shuffleClips(sourceClips, clips[index]);
      show(0);
      return;
    }
    goTo(index + 1);
  }

  function show(n) {
    if (!clips.length) {
      showEmpty();
      return;
    }
    if (reloading) return;
    const gen = ++generation;
    armed = false;
    releaseVideo();
    index = ((n % clips.length) + clips.length) % clips.length;
    const src = clips[index];
    expectedSrc = src;
    counter.textContent = (index + 1) + " / " + clips.length;
    lastMediaTime = -1;
    sawFrame = false;
    lastGood = Date.now();
    clipStarted = lastGood;
    vid.muted = !wantSound;
    vid.src = src;
    preloadNext();
    publish();
    if (armTimer) clearTimeout(armTimer);
    armTimer = setTimeout(() => {
      armTimer = 0;
      if (generation === gen) armed = true;
    }, 0);
    if (paused) return;
    playClip();
  }

  function showEmpty() {
    releaseVideo();
    counter.textContent = schedule ? "No clips yet" : "Playlist missing";
    stage.classList.add("empty");
    publish();
  }

  function onEnded() {
    if (!armed || reloading || releasing || swapGrace()) return;
    if ((vid.getAttribute("src") || "") !== expectedSrc) return;
    failures = 0;
    failedGen = -1;
    lastGood = Date.now();
    advance(false);
  }

  function onError() {
    if (releasing || reloading) return;
    const current = vid.getAttribute("src") || "";
    if (!current || current !== expectedSrc) return;
    failClip("error");
  }

  // load() queues abort/emptied. Ignore that burst so a healthy cut is not a failure.
  function swapGrace() {
    return clipStarted > 0 && Date.now() - clipStarted < 400;
  }

  function onAbort() {
    if (!armed || releasing || reloading || paused || swapGrace()) return;
    if ((vid.getAttribute("src") || "") !== expectedSrc) return;
    failClip("abort");
  }

  function onEmptied() {
    if (!armed || releasing || reloading || paused || swapGrace()) return;
    if ((vid.getAttribute("src") || "") !== expectedSrc) return;
    failClip("emptied");
  }

  function onStalled() {
    if (!armed || releasing || reloading || paused || document.hidden) return;
    if ((vid.getAttribute("src") || "") !== expectedSrc) return;
    if (Date.now() - lastGood >= stallMs) failClip("stalled");
  }

  function onPlaying() {
    if ((vid.getAttribute("src") || "") !== expectedSrc) return;
    vid.classList.add("on");
    lastGood = Date.now();
    askCache();
  }

  function onTime() {
    if ((vid.getAttribute("src") || "") !== expectedSrc) return;
    // A last timeupdate from a file that already failed must not cancel the skip.
    if (vid.error) return;
    if (vid.currentTime > lastMediaTime + 0.2) {
      lastMediaTime = vid.currentTime;
      lastGood = Date.now();
      if (vid.videoWidth > 0) {
        sawFrame = true;
        failures = 0;
        failedGen = -1;
        if (failTimer) {
          clearTimeout(failTimer);
          failTimer = 0;
        }
      } else if (vid.currentTime > 1) {
        failClip("no frames");
      }
    }
  }

  vid.addEventListener("ended", onEnded);
  vid.addEventListener("error", onError);
  vid.addEventListener("abort", onAbort);
  vid.addEventListener("emptied", onEmptied);
  vid.addEventListener("stalled", onStalled);
  vid.addEventListener("playing", onPlaying);
  vid.addEventListener("timeupdate", onTime);

  function togglePause() {
    paused = !paused;
    pauseBtn.textContent = paused ? "\u25b6" : "\u2161";
    pauseBtn.setAttribute("aria-label", paused ? "Resume slideshow" : "Pause slideshow");
    publish();
    if (!clips.length) return;
    if (paused) {
      try { vid.pause(); } catch (e) {}
      if (reloadAt && clock() >= reloadAt) safeReload("scheduled");
      return;
    }
    lastGood = Date.now();
    playClip();
  }

  function toggleSound() {
    wantSound = !wantSound;
    vid.muted = !wantSound;
    soundBtn.textContent = vid.muted ? "\uD83D\uDD07" : "\uD83D\uDD0A";
    soundBtn.setAttribute("aria-label", vid.muted ? "Turn sound on" : "Turn sound off");
    if (wantSound && !paused && clips.length) playClip();
  }

  document.getElementById("next").onclick = () => advance(true);
  document.getElementById("prev").onclick = () => show(index - 1);
  pauseBtn.onclick = togglePause;
  soundBtn.onclick = (e) => {
    e.stopPropagation();
    toggleSound();
  };
  document.getElementById("full").onclick = () => {
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
    if (request && request.catch) request.catch(() => {});
  };
  addEventListener("keydown", (e) => {
    const key = (e.key || "").toLowerCase();
    if (key === "arrowright" || key === " ") {
      e.preventDefault();
      advance(true);
    } else if (key === "arrowleft") {
      e.preventDefault();
      show(index - 1);
    } else if (key === "p") togglePause();
    else if (key === "m") toggleSound();
    else if (key === "f") document.getElementById("full").click();
  });

  function wakeCursor() {
    stage.classList.add("awake");
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = 0;
      stage.classList.remove("awake");
    }, 3000);
  }
  stage.addEventListener("mousemove", wakeCursor);
  stage.addEventListener("pointerdown", wakeCursor);

  async function wake() {
    if (!("wakeLock" in navigator) || document.hidden) return;
    try {
      if (wakeLock && !wakeLock.released) return;
      wakeLock = await navigator.wakeLock.request("screen");
    } catch (e) {}
  }

  function onVisible() {
    if (document.hidden) {
      lastGood = Date.now();
      return;
    }
    wake();
    if (!paused && expectedSrc && vid.paused && !reloading) playClip();
  }

  function tick() {
    if (reloading) return;
    if (hardAt && clock() >= hardAt) {
      safeReload("hard");
      return;
    }
    if (reloadAt && clock() >= reloadAt && (paused || !clips.length)) {
      safeReload("scheduled");
      return;
    }
    const now = Date.now();
    if (paused || !clips.length || document.hidden) {
      lastGood = now;
    } else if (expectedSrc) {
      if (!sawFrame && vid.currentTime > 1 && vid.videoWidth === 0) failClip("no frames");
      else if (now - lastGood >= stallMs) failClip("stalled");
      else if (clipStarted && now - clipStarted >= maxClip * 1000) advance(false);
    }
    if (now - lastWake >= 60000) {
      lastWake = now;
      wake();
    }
    if (debug) paintDebug();
  }

  addEventListener("offline", () => {
    offline = true;
    publish();
  });
  addEventListener("online", () => {
    offline = false;
    publish();
    if (Date.now() - booted < 5000 || paused || !clips.length || reloading) return;
    if (vid.error || vid.networkState === 3) show(index);
    else if (expectedSrc && vid.paused) playClip();
  });

  window.onerror = (msg) => { note("error: " + msg); };

  let dbg = null;
  function paintDebug() {
    if (!dbg) return;
    const up = Math.round((Date.now() - Number(store.get("vl_since"))) / 60000);
    dbg.textContent = "clip: " + (clips.length ? (index + 1) + "/" + clips.length + "  " + labelOf(clips[index]) : "none")
      + "\nrunning: " + up + " min"
      + "\npage loads: " + store.get("vl_loads")
      + "\nfailures: " + failures
      + "\nlast problem: " + (store.get("vl_err") || "none");
  }

  if (debug) {
    dbg = document.createElement("div");
    dbg.id = "debug";
    dbg.style.cssText = "position:fixed;left:28px;bottom:28px;z-index:9;background:#1a0c0c;color:#f6edd8;font:16px/1.4 monospace;padding:8px 10px;border-radius:6px;white-space:pre;opacity:1";
    document.body.appendChild(dbg);
  }

  function installPlaylist(resolved, avoid) {
    sourceClips = resolved.clips ? resolved.clips.slice() : [];
    clips = schedule.shuffleClips(sourceClips, avoid || "");
    const savedNext = store.get("vl_next");
    store.set("vl_next", "");
    store.set("vl_last", "");
    if (!params.has("slide") && savedNext) clips = schedule.rotateTo(clips, savedNext);
    failures = 0;
    failedGen = -1;
    paintChip(resolved);
  }

  function startIndex() {
    if (params.has("slide")) {
      const q = Number(params.get("slide"));
      if (isFinite(q)) return Math.max(1, Math.floor(q)) - 1;
    }
    return 0;
  }

  // Called on load and once a minute. The playlist does not change; the chip does.
  function recheck() {
    window.__rechecks = (window.__rechecks || 0) + 1;
    paintChip(currentResolved());
    publish();
  }

  // Once a minute, just after the clock minute, so midnight America/New_York
  // updates the chip on that tick instead of waiting for the 4-hour reload.
  function recheckDelay(now) {
    return 60000 - (now % 60000) + 40;
  }

  function scheduleRecheck() {
    recheck();
    countdownTimer = setTimeout(scheduleRecheck, recheckDelay(Date.now()));
  }

  window.__recheck = recheck;
  window.__recheckDelay = recheckDelay;
  window.__tick = tick;

  function boot() {
    if (!schedule) {
      countdown.hidden = false;
      countdown.textContent = "CONFIG MISSING";
      return;
    }
    const resolved = currentResolved();
    installPlaylist(resolved, store.get("vl_last") || "");
    scheduleRecheck();
    wake();
    document.addEventListener("visibilitychange", onVisible);
    setInterval(tick, 500);
    if (!clips.length) showEmpty();
    else show(startIndex());
  }

  function registerWorker() {
    if (!("serviceWorker" in navigator)) return Promise.resolve(false);
    return navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((reg) => {
      return reg;
    }).catch(() => null);
  }

  let started = false;
  function startOnce() {
    if (started) return;
    started = true;
    boot();
  }

  // Playback starts when the worker claims the page, so clip requests are cached.
  // A hard cap keeps a broken worker from leaving the TV on a black screen.
  const startTimer = setTimeout(startOnce, 2500);
  registerWorker().then(() => {
    if (!navigator.serviceWorker || navigator.serviceWorker.controller) {
      clearTimeout(startTimer);
      startOnce();
      return;
    }
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      clearTimeout(startTimer);
      startOnce();
    });
  });
})();
