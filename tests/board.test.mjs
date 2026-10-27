// Headless checks for the Valentine's office board.
// Countdown and clip specs run in node. The same cases load in headless Chrome,
// then a soak plays many clip ends and records heap, listeners, and 1x frame drops.
import { createRequire } from "module";
import { execFileSync } from "child_process";
import crypto from "crypto";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const board = require("../playlist.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const shots = path.join("/tmp", "valentines-shots");

function check(cond, message) {
  if (!cond) failures.push(message);
}

function days(from, to) {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

function expectFor(date) {
  const parts = board.parseISODate(date);
  const onDay = parts.m === 2 && parts.d === 14;
  let targetYear = parts.y;
  if (parts.m > 2 || (parts.m === 2 && parts.d > 14)) targetYear += 1;
  const n = onDay ? 0 : days(date, targetYear + "-02-14");
  return {
    mode: onDay ? "day" : "countdown",
    days: n,
    message: board.messageFor(n)
  };
}

const fixtures = [
  "2026-01-01",
  "2026-02-13",
  "2026-02-14",
  "2026-02-15",
  "2026-10-27",
  "2026-12-31",
  "2027-02-13",
  "2027-02-14",
  "2027-02-15",
  "2028-02-14",
  "2028-02-29",
  "2028-03-01",
  "2029-02-14"
];

function handChecked() {
  const want = {
    "2026-01-01": 44,
    "2026-02-13": 1,
    "2026-02-14": 0,
    "2026-02-15": 364,
    "2026-10-27": 110,
    "2026-12-31": 45,
    "2028-02-14": 0,
    "2028-02-29": 351
  };
  for (const date of Object.keys(want)) {
    check(board.daysUntil(...date.split("-").map(Number)) === want[date], date + " days " + board.daysUntil(...date.split("-").map(Number)));
  }
  check(board.messageFor(0) === "HAPPY VALENTINE'S DAY!", "happy text");
  check(board.messageFor(1) === "1 DAY UNTIL VALENTINE'S DAY", "one day text");
  check(board.messageFor(7) === "7 DAYS UNTIL VALENTINE'S DAY", "seven day text");
  check(board.messageFor(110) === "110 DAYS UNTIL VALENTINE'S DAY", "110 day text");
}

function scheduleTests() {
  check(board.timeZone === "America/New_York", "timezone");
  check(board.CLIPS.length === 10, "clip count");
  handChecked();

  for (const date of fixtures) {
    const parts = board.parseISODate(date);
    const got = board.resolve(parts);
    const want = expectFor(date);
    check(got.mode === want.mode, date + " mode " + got.mode);
    check(got.days === want.days, date + " days " + got.days + " !== " + want.days);
    check(got.message === want.message, date + " message [" + got.message + "]");
    check(got.clips.length === 10, date + " clips");
  }

  // Every calendar day in a non-leap year and a leap year agrees with the fixture helper.
  for (const year of [2026, 2028]) {
    for (let month = 1; month <= 12; month++) {
      for (let day = 1; day <= 31; day++) {
        const iso = year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
        const parts = board.parseISODate(iso);
        if (!parts) continue;
        const got = board.resolve(parts);
        const want = expectFor(iso);
        check(got.message === want.message && got.days === want.days && got.mode === want.mode, "year sweep " + iso + " " + got.message);
      }
    }
  }

  check(board.parseISODate("2026-02-31") === null, "reject Feb 31");
  check(board.parseISODate("2026-02-29") === null, "reject non-leap Feb 29");
  check(board.parseISODate("2028-02-29") !== null, "accept leap Feb 29");
  check(board.parseISODate("nope") === null, "reject bad date");

  const ny = board.partsInTimeZone(new Date("2026-02-14T04:30:00Z"), "America/New_York");
  check(ny.y === 2026 && ny.m === 2 && ny.d === 13, "EST still Feb 13 at 04:30Z " + JSON.stringify(ny));
  const midnight = board.partsInTimeZone(new Date("2026-02-14T05:00:00Z"), "America/New_York");
  check(midnight.y === 2026 && midnight.m === 2 && midnight.d === 14, "EST midnight Feb 14 " + JSON.stringify(midnight));
  const edt = board.partsInTimeZone(new Date("2026-07-04T03:30:00Z"), "America/New_York");
  check(edt.m === 7 && edt.d === 3, "EDT still Jul 3 at 03:30Z " + JSON.stringify(edt));
  const edtMidnight = board.partsInTimeZone(new Date("2026-07-04T04:00:00Z"), "America/New_York");
  check(edtMidnight.m === 7 && edtMidnight.d === 4, "EDT midnight Jul 4 " + JSON.stringify(edtMidnight));

  const names = board.CLIPS.map((src) => path.basename(board.clipPath(src)));
  const disk = fs.readdirSync(path.join(root, "clips")).filter((name) => name.endsWith(".mp4")).sort();
  check(disk.join() === names.join(), "clips on disk !== playlist\n disk " + disk.join(",") + "\n list " + names.join(","));
  for (let n = 1; n <= 10; n++) {
    const name = "vl" + String(n).padStart(2, "0") + ".mp4";
    check(names[n - 1] === name, "stable name " + names[n - 1]);
  }
  check(new Set(names).size === 10, "unique clips");

  for (const src of board.CLIPS) {
    const file = path.join(root, board.clipPath(src));
    const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 10);
    const listed = (src.split("v=")[1] || "");
    check(listed === hash, board.clipPath(src) + " ?v=" + listed + " !== " + hash);
    const probed = JSON.parse(execFileSync("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,profile,level,width,height,pix_fmt,avg_frame_rate",
      "-show_entries", "format=duration",
      "-of", "json",
      file
    ], { encoding: "utf8" }));
    const stream = probed.streams[0];
    const duration = Number(probed.format.duration);
    check(stream.codec_name === "h264", file + " codec");
    check(stream.profile === "Main", file + " profile " + stream.profile);
    check(Number(stream.level) === 40, file + " level " + stream.level);
    check(stream.width === 1920 && stream.height === 1080, file + " size");
    check(stream.pix_fmt === "yuv420p", file + " pix " + stream.pix_fmt);
    check(stream.avg_frame_rate === "24/1", file + " fps " + stream.avg_frame_rate);
    check(duration > 14.9 && duration < 15.1, file + " duration " + duration);
  }

  let repeats = 0;
  let prev = "";
  let order = board.shuffleClips(board.CLIPS, "");
  for (let cycle = 0; cycle < 40; cycle++) {
    const paths = order.map(board.clipPath);
    check(new Set(paths).size === paths.length, "shuffle unique");
    check(paths.length === 10, "shuffle length");
    if (prev && paths[0] === prev) repeats += 1;
    prev = paths[paths.length - 1];
    order = board.shuffleClips(board.CLIPS, prev);
  }
  check(repeats === 0, "back-to-back repeats " + repeats);

  const rotated = board.rotateTo(board.CLIPS, "clips/vl04.mp4?v=ignored");
  check(board.clipPath(rotated[0]) === "clips/vl04.mp4", "rotate starts at vl04");
  check(rotated.length === 10, "rotate length");
  check(board.rotateTo(board.CLIPS, "clips/missing.mp4").length === 10, "rotate unknown");

  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const version = (html.match(/styles\.css\?v=([A-Za-z0-9]+)/) || [])[1];
  check(version && html.includes("app.js?v=" + version), "app.js version");
  check(version && html.includes("playlist.js?v=" + version), "playlist version");
  check(version && sw.includes("styles.css?v=" + version) && sw.includes("app.js?v=" + version) && sw.includes("playlist.js?v=" + version), "sw shell version");
  check(sw.includes('CACHE = "valentines-board-v1"'), "cache name");
  check(sw.includes("valentines-board-"), "cache prefix");
  check(!sw.includes("holiday-board"), "sw does not use the holiday cache name");
  check(!app.includes("hol_") && !app.includes("tg_"), "no foreign storage keys");
  check(app.includes("vl_"), "vl_ storage keys");
  check(fs.existsSync(path.join(root, ".nojekyll")), ".nojekyll");
  check(html.includes('id="vid"'), "video element");
  check(html.includes("muted") && html.includes("autoplay") && html.includes("playsinline"), "autoplay attrs");
}

function mime(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".mp4")) return "video/mp4";
  return "application/octet-stream";
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = path.normalize(path.join(root, pathname));
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const type = mime(file);
      const range = req.headers.range;
      if (range) {
        const match = /bytes=(\d+)-(\d*)/.exec(range);
        if (match) {
          const start = Number(match[1]);
          const end = match[2] ? Number(match[2]) : stat.size - 1;
          res.writeHead(206, {
            "Content-Type": type,
            "Content-Range": "bytes " + start + "-" + end + "/" + stat.size,
            "Accept-Ranges": "bytes",
            "Content-Length": end - start + 1,
            "Cache-Control": "no-cache"
          });
          fs.createReadStream(file, { start: start, end: end }).pipe(res);
          return;
        }
      }
      res.writeHead(200, {
        "Content-Type": type,
        "Content-Length": stat.size,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache"
      });
      fs.createReadStream(file).pipe(res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function listenerCount(cdp, expression) {
  const evaluated = await cdp.send("Runtime.evaluate", { expression: expression, returnByValue: false });
  if (!evaluated.result || !evaluated.result.objectId) return -1;
  const listed = await cdp.send("DOMDebugger.getEventListeners", { objectId: evaluated.result.objectId });
  return listed.listeners.length;
}

async function videoObjectCount(cdp) {
  const evaluated = await cdp.send("Runtime.evaluate", {
    expression: "HTMLVideoElement.prototype",
    returnByValue: false
  });
  const objects = await cdp.send("Runtime.queryObjects", { prototypeObjectId: evaluated.result.objectId });
  const counted = await cdp.send("Runtime.callFunctionOn", {
    objectId: objects.objects.objectId,
    functionDeclaration: "function(){return this.length}",
    returnByValue: true
  });
  return counted.result.value;
}

async function heapUsed(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const row = metrics.find((metric) => metric.name === "JSHeapUsedSize");
  return row ? row.value : 0;
}

function chromeArgs() {
  return [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-precise-memory-info",
    "--mute-audio",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding"
  ];
}

async function browserTests(browser, base) {
  const report = { dates: 0, soak: null, offline: null, reload: null, failuresReload: null, wake: null, screenshots: [] };

  async function openPage(query, setup) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    page.on("pageerror", (err) => console.error("pageerror", err.message));
    if (setup) await setup(page);
    await page.goto(base + "/" + query, { waitUntil: "domcontentloaded", timeout: 30000 });
    return { context, page };
  }

  async function closePair(pair) {
    await pair.page.close();
    await pair.context.close();
  }

  const dateCases = [
    "2026-02-07",
    "2026-02-13",
    "2026-02-14",
    "2026-02-15",
    "2026-10-27",
    "2028-02-29"
  ];

  for (const date of dateCases) {
    const pair = await openPage("?date=" + date);
    try {
      await pair.page.waitForFunction(() => window.__board && window.__board.count === 10, { timeout: 15000 });
      const got = await pair.page.evaluate(() => {
        const chipEl = document.getElementById("countdown");
        return {
          mode: window.__board.mode,
          days: window.__board.days,
          message: window.__board.message,
          count: window.__board.count,
          hidden: chipEl.hidden,
          videos: window.__board.videos,
          text: chipEl.textContent
        };
      });
      const want = expectFor(date);
      report.dates += 1;
      check(got.mode === want.mode, "chrome " + date + " mode " + got.mode);
      check(got.days === want.days, "chrome " + date + " days " + got.days);
      check(got.message === want.message, "chrome " + date + " message [" + got.message + "]");
      check(got.text === want.message, "chrome " + date + " chip text");
      check(got.hidden === false, "chrome chip hidden " + date);
      check(got.videos === 1, "chrome videos " + got.videos);
      check(got.count === 10, "chrome count");
    } finally {
      await closePair(pair);
    }
  }

  const styled = await openPage("?date=2026-02-07");
  try {
    await styled.page.waitForFunction(() => window.__board && window.__board.message, { timeout: 15000 });
    const css = await styled.page.evaluate(() => {
      const vid = document.getElementById("vid");
      const chipEl = document.getElementById("countdown");
      const stage = document.getElementById("stage");
      const vs = getComputedStyle(vid);
      const cs = getComputedStyle(chipEl);
      return {
        objectFit: vs.objectFit,
        vidOpacity: vs.opacity,
        vidFilter: vs.filter,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        stageBg: getComputedStyle(stage).backgroundColor,
        htmlCursor: getComputedStyle(document.documentElement).cursor,
        cursor: getComputedStyle(stage).cursor,
        chipBg: cs.backgroundColor,
        chipOpacity: cs.opacity,
        chipAnimation: cs.animationName,
        chipTransition: cs.transitionDuration,
        chipShadow: cs.boxShadow,
        chipBackdrop: cs.backdropFilter || cs.webkitBackdropFilter || "none",
        ids: [...stage.children].map((el) => el.id),
        debug: !!document.getElementById("debug"),
        muted: vid.muted,
        playsInline: vid.playsInline
      };
    });
    check(css.objectFit === "contain", "object-fit " + css.objectFit);
    check(css.vidOpacity === "1", "video opacity " + css.vidOpacity);
    check(css.vidFilter === "none", "video filter " + css.vidFilter);
    check(css.bodyBg === "rgb(0, 0, 0)" && css.stageBg === "rgb(0, 0, 0)", "background " + css.bodyBg + " " + css.stageBg);
    check(css.cursor === "none" && css.htmlCursor === "none", "cursor " + css.cursor + " " + css.htmlCursor);
    check(css.chipBg === "rgb(26, 12, 12)", "chip background " + css.chipBg);
    check(css.chipOpacity === "1", "chip opacity " + css.chipOpacity);
    check(css.chipAnimation === "none", "chip animation " + css.chipAnimation);
    check(css.chipTransition === "0s" || css.chipTransition.indexOf("0s") === 0, "chip transition " + css.chipTransition);
    check(css.chipShadow === "none", "chip shadow " + css.chipShadow);
    check(!css.chipBackdrop || css.chipBackdrop === "none", "chip backdrop " + css.chipBackdrop);
    check(css.ids.join(",") === "vid,countdown,counter,controls", "stage children " + css.ids.join(","));
    check(css.debug === false, "debug overlay present");
    check(css.muted === true && css.playsInline === true, "muted playsinline");

    const delay = await styled.page.evaluate(() => window.__recheckDelay(100000));
    check(delay === 20040, "recheck delay " + delay);

    await styled.page.evaluate(() => {
      window.__parts = () => ({ y: 2026, m: 2, d: 14 });
      window.__recheck();
    });
    let flipped = await styled.page.evaluate(() => ({
      message: window.__board.message,
      mode: window.__board.mode,
      days: window.__board.days,
      videos: document.querySelectorAll("video").length,
      rechecks: window.__rechecks
    }));
    check(flipped.message === "HAPPY VALENTINE'S DAY!" && flipped.mode === "day" && flipped.days === 0, "midnight to Feb 14 " + JSON.stringify(flipped));
    check(flipped.videos === 1, "videos after recheck " + flipped.videos);
    check(flipped.rechecks >= 2, "rechecks " + flipped.rechecks);

    await styled.page.evaluate(() => {
      window.__parts = () => ({ y: 2026, m: 2, d: 15 });
      window.__recheck();
    });
    flipped = await styled.page.evaluate(() => window.__board);
    check(flipped.mode === "countdown" && flipped.days === 364 && flipped.message === "364 DAYS UNTIL VALENTINE'S DAY", "Feb 15 chip " + flipped.message);

    const badDate = await openPage("?date=2026-02-31");
    try {
      await badDate.page.waitForFunction(() => window.__board && window.__board.message, { timeout: 15000 });
      const fell = await badDate.page.evaluate(() => window.__board.message);
      const today = board.partsInTimeZone(new Date(), "America/New_York");
      const iso = today.y + "-" + String(today.m).padStart(2, "0") + "-" + String(today.d).padStart(2, "0");
      check(fell === expectFor(iso).message, "bad date falls back [" + fell + "] want [" + expectFor(iso).message + "]");
    } finally {
      await closePair(badDate);
    }
  } finally {
    await closePair(styled);
  }

  fs.mkdirSync(shots, { recursive: true });
  const countdownShot = path.join(shots, "valentines_countdown_chip.png");
  const dayShot = path.join(shots, "valentines_day.png");
  const shotCountdown = await openPage("?date=2026-02-07");
  try {
    await shotCountdown.page.waitForFunction(() => {
      const vid = document.getElementById("vid");
      return window.__board && window.__board.message === "7 DAYS UNTIL VALENTINE'S DAY" && vid.videoWidth > 100 && vid.currentTime > 0.2 && !vid.paused;
    }, { timeout: 20000 });
    await shotCountdown.page.screenshot({ path: countdownShot });
    report.screenshots.push(countdownShot);
  } finally {
    await closePair(shotCountdown);
  }
  const shotDay = await openPage("?date=2026-02-14");
  try {
    await shotDay.page.waitForFunction(() => {
      const vid = document.getElementById("vid");
      const chipEl = document.getElementById("countdown");
      return window.__board && chipEl.textContent === "HAPPY VALENTINE'S DAY!" && !chipEl.hidden && vid.videoWidth > 100 && vid.currentTime > 0.2;
    }, { timeout: 20000 });
    await shotDay.page.screenshot({ path: dayShot });
    report.screenshots.push(dayShot);
  } finally {
    await closePair(shotDay);
  }

  const offline = await openPage("?date=2026-02-10");
  try {
    await offline.page.waitForFunction(() => {
      const vid = document.getElementById("vid");
      return window.__board && vid.videoWidth > 0 && navigator.serviceWorker && navigator.serviceWorker.controller;
    }, { timeout: 20000 });
    await offline.page.waitForFunction(async () => {
      const keys = await caches.keys();
      if (!keys.length) return false;
      const cache = await caches.open(keys[0]);
      const reqs = await cache.keys();
      const urls = reqs.map((entry) => entry.url);
      const ids = [];
      for (let n = 1; n <= 10; n++) ids.push("vl" + String(n).padStart(2, "0") + ".mp4");
      return ids.every((id) => urls.some((url) => url.indexOf(id) !== -1));
    }, { timeout: 60000 });
    await offline.page.setOfflineMode(true);
    await offline.page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await offline.page.waitForFunction(() => {
      const vid = document.getElementById("vid");
      return window.__board && window.__board.offline === true && window.__board.count === 10 && vid.videoWidth > 0 && vid.currentTime > 0;
    }, { timeout: 20000 });
    report.offline = await offline.page.evaluate(() => ({
      message: window.__board.message,
      src: window.__board.src,
      offline: window.__board.offline,
      width: document.getElementById("vid").videoWidth,
      count: window.__board.count
    }));
    check(report.offline.offline === true, "offline flag");
    check(report.offline.width > 0, "offline frame");
    check(report.offline.message === "4 DAYS UNTIL VALENTINE'S DAY", "offline chip " + report.offline.message);
  } finally {
    await closePair(offline);
  }

  const scheduled = await openPage("?date=2026-02-07", async (page) => {
    await page.evaluateOnNewDocument(() => {
      if (sessionStorage.getItem("vl_clock_once")) return;
      sessionStorage.setItem("vl_clock_once", "1");
      window.__nowMs = () => Date.now() + 4 * 3600000 + 20000;
    });
  });
  try {
    await scheduled.page.waitForFunction(() => window.__board && window.__board.src && window.__board.reloadAt, { timeout: 20000 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const early = await scheduled.page.evaluate(() => ({
      bust: location.search.indexOf("bust=") !== -1,
      reason: localStorage.getItem("vl_reason") || "",
      pastReload: window.__nowMs() >= window.__board.reloadAt,
      beforeHard: window.__nowMs() < window.__board.hardAt
    }));
    check(early.pastReload && early.beforeHard, "clock sits in the reload window " + JSON.stringify(early));
    check(!early.bust && !early.reason, "reloaded before the clip boundary " + JSON.stringify(early));
    await scheduled.page.evaluate(() => document.getElementById("vid").dispatchEvent(new Event("ended")));
    await scheduled.page.waitForFunction(() => localStorage.getItem("vl_reason") === "scheduled" && location.search.indexOf("bust=") !== -1, { timeout: 15000 });
    report.reload = await scheduled.page.evaluate(() => ({
      reason: localStorage.getItem("vl_reason"),
      bust: location.search.indexOf("bust=") !== -1,
      loads: Number(localStorage.getItem("vl_loads") || 0)
    }));
    check(report.reload.reason === "scheduled" && report.reload.bust, "scheduled reload " + JSON.stringify(report.reload));
    check(report.reload.loads === 2, "scheduled reload loads " + report.reload.loads);
  } finally {
    await closePair(scheduled);
  }

  const hard = await openPage("?date=2026-02-07", async (page) => {
    await page.evaluateOnNewDocument(() => {
      if (sessionStorage.getItem("vl_clock_once")) return;
      sessionStorage.setItem("vl_clock_once", "1");
      window.__nowMs = () => Date.now() + 4 * 3600000 + 16 * 60 * 1000;
    });
  });
  try {
    await hard.page.waitForFunction(() => localStorage.getItem("vl_reason") === "hard" && location.search.indexOf("bust=") !== -1, { timeout: 15000 });
    const hardReport = await hard.page.evaluate(() => ({
      reason: localStorage.getItem("vl_reason"),
      loads: Number(localStorage.getItem("vl_loads") || 0)
    }));
    check(hardReport.reason === "hard", "hard reload " + JSON.stringify(hardReport));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const loads = await hard.page.evaluate(() => Number(localStorage.getItem("vl_loads") || 0));
    check(loads === 2, "hard reload once " + loads);
    report.reload = Object.assign({}, report.reload, { hard: hardReport.reason, hardLoads: loads });
  } finally {
    await closePair(hard);
  }

  const broken = await openPage("?date=2026-02-07", async (page) => {
    await page.evaluateOnNewDocument(() => {
      const original = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        if (this.id !== "vid") return original.apply(this, arguments);
        return Promise.reject(new DOMException("blocked", "NotSupportedError"));
      };
    });
  });
  try {
    await broken.page.waitForFunction(() => localStorage.getItem("vl_reason") === "failures", { timeout: 20000 });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    report.failuresReload = await broken.page.evaluate(() => ({
      reason: localStorage.getItem("vl_reason"),
      loads: Number(localStorage.getItem("vl_loads") || 0),
      videos: document.querySelectorAll("video").length
    }));
    check(report.failuresReload.reason === "failures", "failure reload " + JSON.stringify(report.failuresReload));
    check(report.failuresReload.loads === 2, "failure backoff loads " + report.failuresReload.loads);
    check(report.failuresReload.videos === 1, "failure videos " + report.failuresReload.videos);
  } finally {
    await closePair(broken);
  }

  const wake = await openPage("?date=2026-02-07", async (page) => {
    await page.evaluateOnNewDocument(() => {
      window.__wakes = 0;
      window.__wakeReleased = false;
      const fake = {
        request() {
          window.__wakes += 1;
          const lock = { get released() { return window.__wakeReleased; } };
          return Promise.resolve(lock);
        }
      };
      try {
        Object.defineProperty(navigator, "wakeLock", { configurable: true, get: () => fake });
      } catch (e) {
        navigator.wakeLock = fake;
      }
    });
  });
  try {
    await wake.page.waitForFunction(() => window.__board && window.__wakes >= 1, { timeout: 15000 });
    const first = await wake.page.evaluate(() => window.__wakes);
    await wake.page.evaluate(() => {
      window.__wakeReleased = true;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await wake.page.waitForFunction(() => window.__wakes >= 2, { timeout: 5000 });
    report.wake = await wake.page.evaluate(() => window.__wakes);
    check(first >= 1 && report.wake >= first + 1, "wake re-requested " + first + " -> " + report.wake);
  } finally {
    await closePair(wake);
  }

  const soak = await browser.newPage();
  await soak.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await soak.evaluateOnNewDocument(() => {
    window.__rate = 1;
    window.__quality = [];
    window.__seq = [];
    window.__repeats = [];
    const originalAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
      if (type === "ended" && this && this.id === "vid" && !window.__qualityHooked) {
        window.__qualityHooked = true;
        let pending = null;
        const readQuality = function () {
          const quality = typeof this.getVideoPlaybackQuality === "function"
            ? this.getVideoPlaybackQuality()
            : { droppedVideoFrames: 0, totalVideoFrames: 0 };
          return {
            dropped: quality.droppedVideoFrames || 0,
            total: quality.totalVideoFrames || 0,
            rate: this.playbackRate || 1,
            clip: (this.getAttribute("src") || "").split("?")[0]
          };
        };
        originalAdd.call(this, "timeupdate", function () {
          const row = readQuality.call(this);
          if (row.total > 0) pending = row;
        });
        originalAdd.call(this, "ended", function () {
          const row = readQuality.call(this);
          if (row.total === 0 && pending) {
            row.dropped = pending.dropped;
            row.total = pending.total;
            row.rate = pending.rate;
            row.clip = pending.clip || row.clip;
          }
          pending = null;
          window.__quality.push(row);
          if (window.__quality.length >= 10) window.__rate = 4;
        });
      }
      return originalAdd.call(this, type, fn, opts);
    };
    window.addEventListener("DOMContentLoaded", () => {
      const vid = document.getElementById("vid");
      let last = "";
      vid.addEventListener("loadstart", () => {
        const clip = (vid.getAttribute("src") || "").split("?")[0];
        if (!clip) return;
        if (last && clip === last) window.__repeats.push(clip);
        last = clip;
        window.__seq.push(clip);
      });
    });
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      try { this.playbackRate = window.__rate || 1; } catch (e) {}
      return original.apply(this, arguments);
    };
  });
  const cdp = await soak.createCDPSession();
  await cdp.send("Performance.enable");
  await cdp.send("Runtime.enable");
  await soak.goto(base + "/?date=2026-02-07", { waitUntil: "domcontentloaded", timeout: 30000 });
  await soak.waitForFunction(() => window.__seq && window.__seq.length >= 1 && window.__board && window.__board.preload, { timeout: 20000 });

  const samples = [];
  async function sample(label) {
    const dom = await soak.evaluate(() => ({
      nodes: document.querySelectorAll("*").length,
      videos: document.querySelectorAll("video").length,
      ends: window.__quality.length,
      seq: window.__seq.length,
      repeats: window.__repeats.slice(),
      failures: window.__board.failures,
      loads: Number(localStorage.getItem("vl_loads") || 0)
    }));
    let listeners = {};
    let videos = dom.videos;
    let heap = 0;
    try { listeners.vid = await listenerCount(cdp, "document.getElementById('vid')"); } catch (e) { listeners.vid = -1; }
    try { listeners.window = await listenerCount(cdp, "window"); } catch (e) { listeners.window = -1; }
    try { listeners.document = await listenerCount(cdp, "document"); } catch (e) { listeners.document = -1; }
    try { videos = await videoObjectCount(cdp); } catch (e) {}
    try { heap = await heapUsed(cdp); } catch (e) {}
    const row = Object.assign({ label: label, heap: heap, videoObjects: videos }, dom, { listeners: listeners });
    samples.push(row);
    console.error("sample", label, "seq", dom.seq, "ends", dom.ends, "heap", heap, "videos", videos);
    return row;
  }

  await sample("start");
  const deadline = Date.now() + 480000;
  let lastSeq = 0;
  while (Date.now() < deadline) {
    const seq = await soak.evaluate(() => window.__seq.length);
    if (seq >= 30) break;
    if (seq !== lastSeq && seq % 5 === 0) await sample("clip-" + seq);
    lastSeq = seq;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const finalRow = await sample("end");
  const quality = await soak.evaluate(() => ({
    quality: window.__quality,
    seq: window.__seq,
    repeats: window.__repeats,
    reason: localStorage.getItem("vl_reason") || ""
  }));
  const realtime = quality.quality.filter((row) => row.rate < 1.5);
  const sped = quality.quality.filter((row) => row.rate >= 1.5);
  const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] || 0), 0);
  report.soak = {
    clipsStarted: quality.seq.length,
    clipEnds: quality.quality.length,
    repeats: quality.repeats,
    reloadReason: quality.reason,
    samples: samples,
    realtime: {
      clips: realtime.length,
      totalFrames: sum(realtime, "total"),
      droppedFrames: sum(realtime, "dropped"),
      perClip: realtime.map((row) => ({
        clip: row.clip,
        dropped: row.dropped,
        total: row.total,
        rate: row.rate
      }))
    },
    spedUp: {
      clips: sped.length,
      totalFrames: sum(sped, "total"),
      droppedFrames: sum(sped, "dropped")
    }
  };

  check(quality.seq.length >= 30, "soak started " + quality.seq.length + " clips");
  check(quality.quality.length >= 29, "soak ended " + quality.quality.length + " clips");
  check(realtime.length >= 10, "1x clips " + realtime.length);
  check(quality.repeats.length === 0, "soak back-to-back " + quality.repeats.join(","));
  check(!quality.reason, "unexpected reload " + quality.reason);
  check(finalRow.failures === 0, "soak failures " + finalRow.failures);
  check(finalRow.loads === 1, "soak loads " + finalRow.loads);
  check(finalRow.videos === 1, "document videos " + finalRow.videos);
  check(finalRow.videoObjects === samples[0].videoObjects, "video objects " + samples[0].videoObjects + " -> " + finalRow.videoObjects);
  check(finalRow.videoObjects <= 2, "video objects high " + finalRow.videoObjects);
  check(finalRow.heap > 0, "heap unavailable");
  const startNodes = samples[0].nodes;
  check(finalRow.nodes - startNodes <= 2, "DOM grew " + startNodes + " -> " + finalRow.nodes);
  for (const kind of ["vid", "window", "document"]) {
    const a = samples[0].listeners[kind];
    const b = finalRow.listeners[kind];
    if (a >= 0 && b >= 0) check(b <= a, kind + " listeners " + a + " -> " + b);
  }
  const warmed = samples.find((row) => row.seq >= 5) || samples[0];
  const heapGrowth = finalRow.heap - warmed.heap;
  check(heapGrowth < 24 * 1024 * 1024, "heap growth " + Math.round(heapGrowth / 1048576) + "MB");
  check(report.soak.realtime.totalFrames > 0, "no realtime frames");
  check(report.soak.realtime.droppedFrames < report.soak.realtime.totalFrames, "all 1x frames dropped");
  console.error(
    "FRAME DROPS 1x:",
    report.soak.realtime.droppedFrames + "/" + report.soak.realtime.totalFrames,
    "across",
    report.soak.realtime.clips,
    "clips"
  );
  await soak.close();
  return report;
}

scheduleTests();
if (failures.length) {
  console.log(JSON.stringify({ ok: false, phase: "node", failures: failures }, null, 2));
  process.exit(1);
}

const puppeteer = require("puppeteer-core");
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
  args: chromeArgs()
});
const server = await startServer();
const base = "http://127.0.0.1:" + server.address().port;
let report = null;
try {
  report = await browserTests(browser, base);
} catch (err) {
  failures.push("browser exception: " + (err && err.stack ? err.stack : err));
} finally {
  server.close();
  await browser.close();
}

const ok = failures.length === 0;
console.log(JSON.stringify({ ok: ok, failures: failures, report: report }, null, 2));
process.exit(ok ? 0 : 1);
