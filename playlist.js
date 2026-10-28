// Single playlist for the Valentine's office TV.
// Clip filenames stay vl01.mp4–vl10.mp4. Replace a file in place, then change
// only the ?v= text (first 10 hex characters of the new SHA-256).
// The countdown is the real time left until the next Feb 14 00:00 America/New_York.
(function (root) {
  var LABEL = "VALENTINE'S DAY";
  var HAPPY = "HAPPY VALENTINE'S DAY\nFROM THE 3R FAMILY";
  var CLIPS = [
    "clips/vl01.mp4?v=d9483328fc",
    "clips/vl02.mp4?v=e6be609226",
    "clips/vl03.mp4?v=2db9f3b60b",
    "clips/vl04.mp4?v=30601c592c",
    "clips/vl05.mp4?v=9c3bd587a7",
    "clips/vl06.mp4?v=3481ff6a40",
    "clips/vl07.mp4?v=82f0c34db4",
    "clips/vl08.mp4?v=b8039bb1a3",
    "clips/vl09.mp4?v=6d0e0c3b2d",
    "clips/vl10.mp4?v=922471c39d"
  ];

  function padKey(y, m, d) {
    return y * 10000 + m * 100 + d;
  }

  function daysBetween(y1, m1, d1, y2, m2, d2) {
    var a = Date.UTC(y1, m1 - 1, d1);
    var b = Date.UTC(y2, m2 - 1, d2);
    return Math.round((b - a) / 86400000);
  }

  var formatters = {};

  function formatterFor(timeZone) {
    var hit = formatters[timeZone];
    if (hit) return hit;
    hit = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    formatters[timeZone] = hit;
    return hit;
  }

  function partsInTimeZone(date, timeZone) {
    try {
      var bits = formatterFor(timeZone).formatToParts(date);
      var grab = function (type) {
        for (var n = 0; n < bits.length; n++) {
          if (bits[n].type === type) return Number(bits[n].value);
        }
        return 0;
      };
      var y = grab("year");
      var m = grab("month");
      var d = grab("day");
      var h = grab("hour");
      if (h === 24) h = 0;
      if (!y || !m || !d) throw new Error("parts");
      return { y: y, m: m, d: d, h: h, mi: grab("minute"), s: grab("second") };
    } catch (e) {
      return {
        y: date.getFullYear(),
        m: date.getMonth() + 1,
        d: date.getDate(),
        h: date.getHours(),
        mi: date.getMinutes(),
        s: date.getSeconds()
      };
    }
  }

  // UTC instant whose wall clock in timeZone is y-m-d h:mi:s.
  function zonedTimeToUtc(y, m, d, h, mi, s, timeZone) {
    var guess = Date.UTC(y, m - 1, d, h, mi, s);
    var offset = offsetMs(guess, timeZone);
    var utc = guess - offset;
    var offset2 = offsetMs(utc, timeZone);
    if (offset2 !== offset) utc = guess - offset2;
    return utc;
  }

  function offsetMs(utcMs, timeZone) {
    var parts = partsInTimeZone(new Date(utcMs), timeZone);
    var asUtc = Date.UTC(parts.y, parts.m - 1, parts.d, parts.h || 0, parts.mi || 0, parts.s || 0);
    return asUtc - utcMs;
  }

  function parseISODate(raw) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw || "");
    if (!match) return null;
    var y = Number(match[1]);
    var m = Number(match[2]);
    var d = Number(match[3]);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return { y: y, m: m, d: d };
  }

  // Feb 14 is the day itself. Any other calendar day counts to the next Feb 14.
  function daysUntil(y, m, d) {
    var targetYear = y;
    if (padKey(y, m, d) > padKey(y, 2, 14)) targetYear = y + 1;
    return daysBetween(y, m, d, targetYear, 2, 14);
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function messageFor(days, hours, minutes, seconds) {
    return days + "d " + pad2(hours || 0) + "h " + pad2(minutes || 0) + "m " + pad2(seconds || 0) + "s\nUNTIL " + LABEL;
  }

  // Real time remaining until the next Feb 14 00:00 America/New_York.
  // The whole Eastern calendar day of Feb 14 is the celebratory line.
  // After that day the count rolls to Feb 14 of the next year.
  function countdownFromDate(date) {
    var zone = "America/New_York";
    var parts = partsInTimeZone(date, zone);
    if (parts.m === 2 && parts.d === 14) {
      return {
        mode: "day",
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
        message: HAPPY,
        clips: CLIPS.slice(),
        label: LABEL
      };
    }
    var year = parts.y;
    if (padKey(parts.y, parts.m, parts.d) > padKey(parts.y, 2, 14)) year += 1;
    var target = zonedTimeToUtc(year, 2, 14, 0, 0, 0, zone);
    var diff = target - date.getTime();
    if (diff < 0) diff = 0;
    var total = Math.floor(diff / 1000);
    var days = Math.floor(total / 86400);
    var hours = Math.floor((total % 86400) / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var seconds = total % 60;
    return {
      mode: "countdown",
      days: days,
      hours: hours,
      minutes: minutes,
      seconds: seconds,
      message: messageFor(days, hours, minutes, seconds),
      clips: CLIPS.slice(),
      label: LABEL
    };
  }

  // ?date= and the test hook are a calendar day. Treat them as midnight Eastern
  // so the preview does not depend on what time the page was opened.
  function resolve(parts) {
    var utc = zonedTimeToUtc(parts.y, parts.m, parts.d, 0, 0, 0, "America/New_York");
    return countdownFromDate(new Date(utc));
  }

  function clipPath(src) {
    return String(src || "").split("?")[0];
  }

  // Fisher-Yates. `avoid` is a clip path that must not land first when there is
  // another choice, so a reshuffle does not repeat the clip that just played.
  function shuffleClips(list, avoid) {
    var arr = list.slice();
    for (var n = arr.length - 1; n > 0; n--) {
      var j = Math.floor(Math.random() * (n + 1));
      var swap = arr[n];
      arr[n] = arr[j];
      arr[j] = swap;
    }
    var avoidPath = clipPath(avoid);
    if (avoidPath && arr.length > 1 && clipPath(arr[0]) === avoidPath) {
      var k = 1 + Math.floor(Math.random() * (arr.length - 1));
      var first = arr[0];
      arr[0] = arr[k];
      arr[k] = first;
    }
    return arr;
  }

  function rotateTo(list, srcPath) {
    var want = clipPath(srcPath);
    if (!want) return list.slice();
    var i = -1;
    for (var n = 0; n < list.length; n++) {
      if (clipPath(list[n]) === want) {
        i = n;
        break;
      }
    }
    if (i <= 0) return list.slice();
    return list.slice(i).concat(list.slice(0, i));
  }

  var api = {
    LABEL: LABEL,
    HAPPY: HAPPY,
    CLIPS: CLIPS,
    timeZone: "America/New_York",
    partsInTimeZone: partsInTimeZone,
    parseISODate: parseISODate,
    daysBetween: daysBetween,
    daysUntil: daysUntil,
    messageFor: messageFor,
    countdownFromDate: countdownFromDate,
    resolve: resolve,
    shuffleClips: shuffleClips,
    rotateTo: rotateTo,
    clipPath: clipPath
  };

  root.ValentineBoard = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
