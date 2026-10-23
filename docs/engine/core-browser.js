"use strict";
var PairNativeCore = (() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __commonJS = (cb, mod) => function __require2() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // adapter:fs
  var require_fs = __commonJS({
    "adapter:fs"(exports, module) {
      module.exports = { readFileSync: (p) => new TextDecoder().decode(globalThis.PairFS.readFile(p)), writeFileSync: (p, s) => globalThis.PairFS.writeFile(p, s), existsSync: (p) => {
        try {
          globalThis.PairFS.stat(p);
          return true;
        } catch {
          return false;
        }
      }, mkdirSync: (p) => globalThis.PairFS.mkdirTree(p) };
    }
  });

  // adapter:path
  var require_path = __commonJS({
    "adapter:path"(exports, module) {
      var norm = (p) => {
        let a = [];
        for (const x of p.split("/")) {
          if (x === "..") a.pop();
          else if (x && x !== ".") a.push(x);
        }
        return "/" + a.join("/");
      };
      module.exports = { join: (...p) => norm(p.join("/")), resolve: (...p) => norm(p.join("/")), dirname: (p) => p.slice(0, p.lastIndexOf("/")) || "/", relative: (a, b) => b.startsWith(a) ? b.slice(a.length + 1) : b };
    }
  });

  // research/refinement/round10_sequence_strategy/engine.js
  var require_engine = __commonJS({
    "research/refinement/round10_sequence_strategy/engine.js"(exports, module) {
      "use strict";
      var DAY = 864e5;
      var WEEK0 = Math.round(Date.UTC(2022, 11, 13) / DAY);
      var EXCLUDED = new Set(["USDC", "FDUSD", "USDE", "USDP", "TUSD", "DAI", "PAXG", "XAUT", "BTCDOM", "DEFI", "FOOTBALL", "BLUEBIRD"].map((s) => s + "USDT"));
      var positive = (v) => Number.isFinite(v) && v > 0;
      var iso = (t) => new Date(t).toISOString();
      var weekStart = (d) => WEEK0 + 7 * Math.floor((d - WEEK0) / 7);
      var assert = (test, message) => {
        if (!test) throw new Error(message);
      };
      function prepareData(raw) {
        if (raw && raw.__prepared) return raw;
        assert(raw && Array.isArray(raw.symbols || raw.tokens), "Dataset requires symbols array");
        const rows = raw.symbols || raw.tokens;
        const day0 = raw.startDay ?? raw.day0;
        const day1 = raw.endDay ?? raw.day1;
        assert(Number.isInteger(day0) && Number.isInteger(day1) && day1 >= day0, "Dataset needs integer UTC startDay/endDay");
        const n = day1 - day0 + 1, tokens = [], bySymbol = /* @__PURE__ */ new Map();
        const omitted = [];
        for (const row of rows) {
          assert(typeof row.sym === "string" && !bySymbol.has(row.sym), "Missing/duplicate symbol");
          if (!Number.isInteger(row.listDay) && !(row.bars?.length || row.closes?.length)) {
            omitted.push({ symbol: row.sym, reason: "NO_LISTING_DATE_OR_PRICE_HISTORY" });
            continue;
          }
          assert(Number.isInteger(row.listDay), `Unknown listing day: ${row.sym}`);
          const k = { ...row, open: new Float64Array(n).fill(NaN), exitOnlyOpen: new Float64Array(n).fill(NaN), high: new Float64Array(n).fill(NaN), low: new Float64Array(n).fill(NaN), close: new Float64Array(n).fill(NaN), volume: new Float64Array(n).fill(NaN) };
          const bars = row.bars || (row.closes || []).map((c, i) => [row.day0 + i, row.open?.[i], row.high?.[i], row.low?.[i], c, row.qv?.[i]]);
          const seen = /* @__PURE__ */ new Set();
          for (const b of bars) {
            const d = b[0], i = d - day0;
            assert(Number.isInteger(d) && !seen.has(d), `Invalid/duplicate candle: ${row.sym}`);
            seen.add(d);
            if (i < 0 || i >= n) continue;
            assert(b.slice(1, 5).every(positive) && Number.isFinite(b[5]) && b[5] >= 0, `Invalid OHLC/volume: ${row.sym} ${d}`);
            assert(b[2] >= Math.max(b[1], b[4]) && b[3] <= Math.min(b[1], b[4]) && b[2] >= b[3], `Inconsistent OHLC: ${row.sym} ${d}`);
            k.open[i] = b[1];
            k.high[i] = b[2];
            k.low[i] = b[3];
            k.close[i] = b[4];
            k.volume[i] = b[5];
          }
          const terminalDays = /* @__PURE__ */ new Set();
          for (const terminal of row.terminalOpens || []) {
            const d = terminal.day, i = d - day0;
            assert(Number.isInteger(d) && !terminalDays.has(d), `Invalid/duplicate terminal day: ${row.sym}`);
            terminalDays.add(d);
            assert(terminal.openTimestamp === d * DAY && Number.isSafeInteger(terminal.deliveryTimestamp) && terminal.openTimestamp + 1e3 < terminal.deliveryTimestamp && positive(terminal.openPrice), `Invalid terminal open or pre-delivery fill ordering: ${row.sym}`);
            if (i < 0 || i >= n) continue;
            if (positive(k.open[i])) assert(Math.abs(k.open[i] - terminal.openPrice) < 1e-10 * Math.max(1, k.open[i]), `Conflicting terminal and full-candle open: ${row.sym}`);
            k.exitOnlyOpen[i] = terminal.openPrice;
          }
          k.volumeSum = new Float64Array(n + 1);
          k.validSum = new Int32Array(n + 1);
          for (let i = 0; i < n; i++) {
            k.volumeSum[i + 1] = k.volumeSum[i] + (Number.isFinite(k.volume[i]) ? k.volume[i] : 0);
            k.validSum[i + 1] = k.validSum[i] + (positive(k.close[i]) ? 1 : 0);
          }
          tokens.push(k);
          bySymbol.set(k.sym, k);
        }
        tokens.sort((a, b) => a.sym.localeCompare(b.sym));
        return { __prepared: true, day0, day1, n, tokens, bySymbol, metadata: { ...raw.metadata || raw.quality || {}, omittedSymbols: omitted }, source: { asOf: raw.asOf, universe: raw.universe, coverage: raw.coverage, provenance: raw.provenance } };
      }
      function prefix(x) {
        const n = x.length, p = { x: new Float64Array(n + 1), xx: new Float64Array(n + 1), tx: new Float64Array(n + 1), valid: new Int32Array(n + 1), dy2: new Float64Array(n + 1), zdy: new Float64Array(n + 1) };
        for (let i = 0; i < n; i++) {
          const valid = Number.isFinite(x[i]), v = valid ? x[i] : 0;
          p.x[i + 1] = p.x[i] + v;
          p.xx[i + 1] = p.xx[i] + v * v;
          p.tx[i + 1] = p.tx[i] + i * v;
          p.valid[i + 1] = p.valid[i] + Number(valid);
          const dy = i && valid && Number.isFinite(x[i - 1]) ? x[i] - x[i - 1] : 0;
          p.dy2[i + 1] = p.dy2[i] + dy * dy;
          p.zdy[i + 1] = p.zdy[i] + (i && Number.isFinite(x[i - 1]) ? x[i - 1] * dy : 0);
        }
        return p;
      }
      function windowStats(x, p, a, b) {
        const n = b - a;
        if (a < 0 || b > x.length || n < 4 || p.valid[b] - p.valid[a] !== n) return null;
        const sum = (k, l = a, r = b) => p[k][r] - p[k][l], sx = sum("x"), mu = sx / n;
        const ss = Math.max(0, sum("xx") - sx * sx / n), sd = Math.sqrt(ss / (n - 1));
        if (!(sd > 0)) return null;
        const m = n - 1, sz = sum("x", a, b - 1), sy = x[b - 1] - x[a];
        const szz = Math.max(0, sum("xx", a, b - 1) - sz * sz / m);
        const szy = sum("zdy", a + 1, b) - sz * sy / m, syy = Math.max(0, sum("dy2", a + 1, b) - sy * sy / m);
        const beta = szz > 0 ? szy / szz : NaN, rss = Math.max(1e-30, syy - beta * szy), se = Math.sqrt(rss / (m - 2) / szz);
        const cov = sum("tx") - (a + (n - 1) / 2) * sx, tt = n * (n * n - 1) / 12;
        return { mu, sd, df: beta / se, r2: cov * cov / (tt * ss), drift: Math.abs(cov / tt * (n - 1)) / sd };
      }
      function oscillator(x, p, a, b) {
        const st = windowStats(x, p, a, b);
        if (!st) return null;
        let state = 0, sw = 0, both = 0;
        for (let i = a; i < b; i++) {
          if (x[i] >= st.mu + st.sd) {
            if (state === -1) sw++;
            state = 1;
          } else if (x[i] <= st.mu - st.sd) {
            if (state === 1) sw++;
            state = -1;
          }
        }
        for (let k = 0; k < 3; k++) {
          let low = Infinity, high = -Infinity;
          for (let i = a + Math.floor(k * (b - a) / 3); i < a + Math.floor((k + 1) * (b - a) / 3); i++) {
            low = Math.min(low, x[i]);
            high = Math.max(high, x[i]);
          }
          if (high >= st.mu + 0.8 * st.sd && low <= st.mu - 0.8 * st.sd) both++;
        }
        return { drift: st.drift, sw, both, sd: st.sd };
      }
      function gate(st, c) {
        return !!st && st.sd >= c.minSD && st.sd <= c.maxSD && st.df <= c.maxDF && st.r2 < c.maxR2;
      }
      function weeklyUniverses(data, c) {
        const weeks = /* @__PURE__ */ new Map(), pairs = /* @__PURE__ */ new Map();
        for (let w = weekStart(c.startDay) - 7; w <= c.endDay; w += 7) {
          const wi = w - data.day0, ranked = [];
          for (const k of data.tokens) {
            if (EXCLUDED.has(k.sym) || k.excludedByControl || k.listDay > w - c.minHist || wi < 30 || wi > data.n || k.validSum[wi] - k.validSum[wi - 30] !== 30) continue;
            ranked.push({ sym: k.sym, liq: (k.volumeSum[wi] - k.volumeSum[wi - 30]) / 30, listDay: k.listDay });
          }
          ranked.sort((a, b) => b.liq - a.liq || a.sym.localeCompare(b.sym));
          const members = ranked.slice(0, c.topK).map((k, i) => ({ ...k, rank: i + 1 }));
          const ranks = new Map(members.map((k) => [k.sym, k]));
          weeks.set(w, { day: w, members, ranks, candidateCount: ranked.length });
          for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
            const a = members[i], b = members[j];
            if (Math.max(a.listDay, b.listDay) + c.minAge > w + 6) continue;
            const syms = [a.sym, b.sym].sort(), key = syms.join("|");
            if (!pairs.has(key)) pairs.set(key, { a: syms[0], b: syms[1], weeks: [] });
            pairs.get(key).weeks.push(w);
          }
        }
        return { weeks, pairs };
      }
      function signals(input, config = {}) {
        const data = prepareData(input);
        const c = { L: 180, minAge: 365, minHist: 95, topK: 150, minSD: 0.03, maxSD: 0.6, maxDF: -2.86, maxR2: 0.5, episodeStartZ: -2, thetas: [2, 3], bounceZ: 0.75, minDaysSinceLow: 2, maxEntryZ: -1, startDay: data.day0 + 365, endDay: data.day1, ...config };
        assert(c.L === 180, "This registered reconstruction requires L=180");
        const { weeks, pairs } = weeklyUniverses(data, c), rows = [];
        const diag = { pairs: pairs.size, pairWeeks: 0, gatedPairWeeks: 0, bounceRows: 0, missingOscillatorRows: 0 };
        for (const pair of pairs.values()) {
          const A = data.bySymbol.get(pair.a), B = data.bySymbol.get(pair.b), x = new Float64Array(data.n).fill(NaN);
          for (let i = 0; i < data.n; i++) if (positive(A.close[i]) && positive(B.close[i])) x[i] = Math.log(A.close[i] / B.close[i]);
          const p = prefix(x), z = new Float64Array(data.n).fill(NaN), sd = new Float64Array(data.n).fill(NaN), mu = new Float64Array(data.n).fill(NaN);
          for (let i = c.L; i < data.n; i++) if (Number.isFinite(x[i]) && p.valid[i] - p.valid[i - c.L] === c.L) {
            const sum = p.x[i] - p.x[i - c.L], ss = p.xx[i] - p.xx[i - c.L];
            mu[i] = sum / c.L;
            sd[i] = Math.sqrt(Math.max(0, (ss - sum * sum / c.L) / (c.L - 1)));
            if (sd[i] > 0) z[i] = (x[i] - mu[i]) / sd[i];
          }
          const gates = /* @__PURE__ */ new Map();
          for (const w of pair.weeks) {
            const st = windowStats(x, p, w - data.day0 - c.L, w - data.day0);
            diag.pairWeeks++;
            if (gate(st, c)) {
              gates.set(w, st);
              diag.gatedPairWeeks++;
            }
          }
          if (!gates.size) continue;
          for (const dir of [1, -1]) {
            let ep = null, previousEligible = false, lastFinite = -1;
            const deque = [];
            let head = 0, prevCond = c.thetas.map(() => false);
            for (let i = c.L; i < data.n; i++) {
              const d = data.day0 + i, zz = dir * z[i];
              if (!Number.isFinite(zz)) {
                ep = null;
                deque.length = 0;
                head = 0;
                previousEligible = false;
                prevCond.fill(false);
                lastFinite = -1;
                continue;
              }
              if (lastFinite < 0) lastFinite = i;
              if (!ep && zz <= c.episodeStartZ) {
                let f = i;
                for (let j = i - 1; j >= Math.max(c.L, i - 120); j--) {
                  if (!Number.isFinite(z[j])) break;
                  f = j;
                  if (dir * z[j] > -1) break;
                }
                let high = -Infinity;
                for (let j = f; j <= i; j++) high = Math.max(high, dir * x[j]);
                ep = { start: i, lastDeep: i, pre: f, high, low: dir * x[i], osc: void 0 };
              } else if (ep) {
                if (zz <= c.episodeStartZ) ep.lastDeep = i;
                ep.low = Math.min(ep.low, dir * x[i]);
              }
              while (head < deque.length && deque[head] < i - 19) head++;
              while (deque.length > head && dir * z[deque[deque.length - 1]] > zz) deque.pop();
              deque.push(i);
              const e = deque[head], min = dir * z[e], extreme = zz === min ? i : e;
              const base = i - lastFinite >= 20 && i - extreme >= c.minDaysSinceLow && zz >= min + c.bounceZ && zz <= c.maxEntryZ && zz > dir * z[i - 1];
              const cond = c.thetas.map((theta) => base && min <= -theta);
              const w = weekStart(d), st = gates.get(w), eligible = d - A.listDay >= c.minAge && d - B.listDay >= c.minAge && !!st;
              const triggers = c.thetas.filter((_, j) => d >= c.startDay && d <= c.endDay && eligible && cond[j] && !(previousEligible && prevCond[j]));
              if (triggers.length && ep) {
                if (ep.osc === void 0) ep.osc = oscillator(x, p, ep.pre - c.L, ep.pre);
                const S = dir === 1 ? B : A, L = dir === 1 ? A : B;
                let vs = NaN;
                if (i >= 32 && S.validSum[i + 1] - S.validSum[i - 32] === 33) {
                  const recent = (S.volumeSum[i + 1] - S.volumeSum[i - 2]) / 3, prior = (S.volumeSum[i - 2] - S.volumeSum[i - 32]) / 30;
                  if (recent > 0 && prior > 0) vs = Math.log(recent / prior);
                }
                const ranks = weeks.get(w).ranks;
                rows.push({ id: `${d}:${L.sym}/${S.sym}`, day: d, date: iso(d * DAY).slice(0, 10), signalTime: (d + 1) * DAY - 1, long: L.sym, short: S.sym, entryZ: zz, zEntry: zz, zExtreme: min, daysSinceLow: i - extreme, triggerByTheta: Object.fromEntries(c.thetas.map((t) => [t, triggers.includes(t)])), fall: ep.high - ep.low, volumeLogRatio: vs, minVS: vs, vS: vs, osc: ep.osc, gap: Math.expm1(-zz * sd[i]), mu: dir * mu[i], sd: sd[i], df: st.df, r2: st.r2, weeklyDay: w, rankLong: ranks.get(L.sym).rank, rankShort: ranks.get(S.sym).rank, minLiquidity: Math.min(ranks.get(L.sym).liq, ranks.get(S.sym).liq), episodeStartDay: data.day0 + ep.start, preDipDay: data.day0 + ep.pre, oscillatorStartDay: data.day0 + ep.pre - c.L, shortReturnFromPreDip: S.close[i] / S.close[ep.pre] - 1, longReturnFromPreDip: L.close[i] / L.close[ep.pre] - 1 });
                diag.bounceRows++;
                if (!ep.osc) diag.missingOscillatorRows++;
              }
              if (ep && (zz >= 0 && i - ep.lastDeep > 20 || i - ep.lastDeep > 40 || i - ep.start > 120)) ep = null;
              previousEligible = eligible;
              prevCond = cond;
            }
          }
          if (config.onProgress && diag.pairWeeks % 1e3 < 10) config.onProgress({ ...diag });
        }
        rows.sort((a, b) => a.day - b.day || b.gap - a.gap || a.id.localeCompare(b.id));
        return { rows, config: { ...c, onProgress: void 0 }, diagnostics: diag, universes: [...weeks.values()].map((w) => ({ day: w.day, candidateCount: w.candidateCount, members: w.members })), dataQuality: data.metadata };
      }
      function causalSignalFields(s) {
        if (!Number.isInteger(s.day)) return false;
        const available = (s.day + 1) * DAY;
        return ["signalTime", "signalAvailableTime"].every((k) => s[k] == null || Number.isSafeInteger(s[k]) && s[k] <= available);
      }
      function validExitMode(v) {
        const family = v.family ?? "event", mode = v.exitMode ?? "rolling_z";
        if (family === "mixed") return mode === "mixed" && v.components?.event?.family === "event" && v.components?.channel?.family === "channel" && v.components.event.exitMode === "frozen_half" && ["event", "channel"].every((k) => v.components[k].pairStop == null && v.components[k].netStop == null && (v.components[k].maxHold ?? 45) === (v.maxHold ?? 45) && (v.components[k].minCarry ?? -5e-3) === (v.minCarry ?? -5e-3)) && validExitMode(v.components.event) && validExitMode(v.components.channel);
        return family === "event" ? ["rolling_z", "frozen_half"].includes(mode) : family === "channel" && ["channel_mean", "channel_top", "channel_half"].includes(mode);
      }
      function validNetStop(v) {
        return v.netStop == null || (v.family ?? "event") === "event" && Number.isFinite(v.netStop) && v.netStop > 0;
      }
      function fixedEventTarget(s, v) {
        return s.mu + (v.exitZFraction ?? 0.5) * s.entryZ * s.sd;
      }
      function validChannel(s) {
        const c = s.channel;
        return !!c && causalSignalFields(s) && Number.isFinite(s.entryZ) && Number.isFinite(s.gap) && ["mu", "sd", "averageBottomLog", "averageTopLog", "breakLog"].every((k) => Number.isFinite(c[k])) && c.sd > 0 && c.breakLog < c.averageBottomLog && c.averageBottomLog < c.mu && c.mu < c.averageTopLog && Number.isInteger(c.formationStartDay) && Number.isInteger(c.formationEndDay) && c.formationEndDay - c.formationStartDay === 179 && c.formationEndDay === weekStart(s.day) - 1 && c.formationEndDay < s.day;
      }
      function qualifies(s, v) {
        if (v.family === "mixed") {
          const component = v.components?.[s.family ?? "event"];
          return !!component && validExitMode(v) && validNetStop(v) && qualifies(s, component);
        }
        const family = v.family ?? "event";
        if ((s.family ?? "event") !== family || !validExitMode(v) || !validNetStop(v)) return false;
        if (family === "channel") return validChannel(s);
        if (v.rawRatioUp === true && (!causalSignalFields(s) || !Number.isFinite(s.rawRatioChange) || !(s.rawRatioChange > 0))) return false;
        if (v.exitMode === "frozen_half" && (!causalSignalFields(s) || !Number.isFinite(s.mu) || !positive(s.sd) || !Number.isFinite(s.entryZ) || !Number.isFinite(v.exitZFraction ?? 0.5) || !Number.isFinite(fixedEventTarget(s, v)))) return false;
        return !!s.triggerByTheta?.[v.theta ?? 3] && Number.isFinite(s.fall) && s.fall >= (v.minFall ?? 0.5) && s.osc && s.osc.drift <= (v.maxDrift ?? 0.7) && s.osc.sw >= (v.minSw ?? 5) && s.osc.both >= (v.minThirds ?? 3) && (v.minVS === null || Number.isFinite(s.volumeLogRatio) && s.volumeLogRatio >= (v.minVS ?? 0));
      }
      function freezeExitMetadata(s, v) {
        if (v.family === "mixed") return freezeExitMetadata(s, v.components[s.family ?? "event"]);
        if (v.family === "channel") return { family: "channel", exitMode: v.exitMode, targetLog: v.exitMode === "channel_mean" ? s.channel.mu : v.exitMode === "channel_half" ? fixedEventTarget(s, { exitZFraction: 0.5 }) : s.channel.averageTopLog, targetFrozenAtSignalTime: (s.day + 1) * DAY, channel: { ...s.channel } };
        const metadata = {};
        if (v.rawRatioUp === true) metadata.signalRawRatioChange = s.rawRatioChange;
        if (v.exitMode === "frozen_half") Object.assign(metadata, { exitMode: "frozen_half", targetLog: fixedEventTarget(s, v), targetFrozenAtSignalTime: (s.day + 1) * DAY, signalMeanLogRatio: s.mu, signalLogRatioSd: s.sd });
        return metadata;
      }
      function positionExitReason(p, v, logRatio, z, profit, age) {
        if (p.family === "channel") {
          if (logRatio <= p.channel.breakLog) return "channel_break";
          if (logRatio >= p.targetLog) return p.exitMode;
        } else {
          if (v.pairStop != null && profit / p.entryLegNotional <= -v.pairStop) return "pair_stop";
          if (p.exitMode === "frozen_half") {
            if (logRatio >= p.targetLog) return "frozen_half";
          } else if (Number.isFinite(z) && z >= (v.exitZFraction ?? 0.5) * p.entryZ) return "rolling_z";
        }
        return age >= (v.maxHold ?? 45) ? "time" : null;
      }
      function estimateNetLiquidation(p, longClose, shortClose, feeRate, slippage) {
        assert(positive(longClose) && positive(shortClose) && positive(p.entryLegNotional), "Invalid net-stop price/notional");
        const estimatedLongExit = longClose * (1 - slippage), estimatedShortExit = shortClose * (1 + slippage);
        const estimatedGrossPnl = p.longQty * (estimatedLongExit - p.longEntry) + p.shortQty * (p.shortEntry - estimatedShortExit);
        const estimatedExitFees = (p.longQty * estimatedLongExit + p.shortQty * estimatedShortExit) * feeRate;
        const estimatedExitSlippage = p.longQty * (longClose - estimatedLongExit) + p.shortQty * (estimatedShortExit - shortClose);
        const entryFees = p.fees, settledFunding = p.funding;
        const estimatedNetPnl = estimatedGrossPnl + settledFunding - entryFees - estimatedExitFees;
        const estimatedReturnOnEntryLeg = estimatedNetPnl / p.entryLegNotional;
        assert([estimatedLongExit, estimatedShortExit, estimatedGrossPnl, estimatedExitFees, estimatedExitSlippage, entryFees, settledFunding, estimatedNetPnl, estimatedReturnOnEntryLeg].every(Number.isFinite), "Nonfinite net-stop estimate");
        return { longClose, shortClose, estimatedLongExit, estimatedShortExit, estimatedGrossPnl, estimatedExitFees, estimatedExitSlippage, entryFees, settledFunding, estimatedNetPnl, estimatedReturnOnEntryLeg, entryLegNotional: p.entryLegNotional, feeRate, slippage };
      }
      function fundingIndex(raw) {
        if (raw?.__indexedFunding) return raw;
        const source = raw?.symbols || raw || {}, bySymbol = /* @__PURE__ */ new Map();
        for (const [name, sourceRow] of Array.isArray(source) ? source.map((x) => [x.sym || x.symbol, x]) : Object.entries(source)) {
          if (!sourceRow || typeof sourceRow !== "object") continue;
          const row = Array.isArray(sourceRow) ? { events: sourceRow } : sourceRow;
          const events = (row.events || []).map((e) => ({ ...e, timestamp: Number(e.timestamp ?? e.fundingTime), rate: Number(e.rate ?? e.fundingRate), markPrice: Number(e.markPrice) })).sort((a, b) => a.timestamp - b.timestamp);
          let previous = -Infinity;
          for (const e of events) {
            assert(Number.isSafeInteger(e.timestamp) && Number.isFinite(e.rate), `Invalid funding event timestamp/rate ${name}`);
            assert(e.timestamp > previous, `Duplicate funding event ${name}`);
            previous = e.timestamp;
          }
          const intervals = row.intervals || row.coverageIntervals || row.coverage || [{ start: row.coverageStart, end: row.coverageEnd, complete: row.complete }];
          bySymbol.set(name, { ...row, events, intervals: intervals.map((r) => ({ start: Number(r.start ?? r.startTime ?? r.coverageStart), end: Number(r.end ?? r.endTime ?? r.coverageEnd), complete: r.complete ?? (r.status === "retrieved" ? true : row.complete) })), gaps: row.gaps || [] });
        }
        return { __indexedFunding: true, bySymbol, metadata: { source: raw?.source, counts: raw?.counts, coverageInterpretation: raw?.coverage_interpretation, ...raw?.metadata || {} } };
      }
      function covered(f, s, a, b) {
        const r = f.bySymbol.get(s);
        if (!r) return false;
        if (r.gaps.some((g) => Number(g.start ?? g.startTime ?? g[0]) <= b && Number(g.end ?? g.endTime ?? g[1]) >= a)) return false;
        let reached = a;
        for (const i of [...r.intervals].filter((i2) => i2.complete === true).sort((x, y) => x.start - y.start)) {
          if (i.end < reached) continue;
          if (i.start > reached) return false;
          reached = Math.max(reached, i.end + 1);
          if (reached > b) return true;
        }
        return false;
      }
      function lowerBound(events, t) {
        let lo = 0, hi = events.length;
        while (lo < hi) {
          const m = lo + hi >> 1;
          if (events[m].timestamp < t) lo = m + 1;
          else hi = m;
        }
        return lo;
      }
      function fundingBetween(f, s, a, b) {
        const events = f.bySymbol.get(s)?.events || [], out = [];
        for (let i = lowerBound(events, a); i < events.length && events[i].timestamp <= b; i++) out.push(events[i]);
        return out;
      }
      function carryAt(f, s) {
        const a = (s.day - 6) * DAY, b = (s.day + 1) * DAY - 1;
        if (!covered(f, s.long, a, b) || !covered(f, s.short, a, b)) return null;
        const sum = (sym) => fundingBetween(f, sym, a, b).reduce((n, e) => n + e.rate, 0);
        return (sum(s.short) - sum(s.long)) / 7;
      }
      function simulate(input, signalInput, variant, fundingRaw, costs = {}, options = {}) {
        assert(validExitMode(variant), "Invalid or incompatible variant family/exitMode");
        assert(validNetStop(variant), "Invalid or incompatible netStop");
        const data = prepareData(input), funding = fundingIndex(fundingRaw), allSignals = Array.isArray(signalInput) ? signalInput : signalInput.rows || signalInput.signals;
        const startDay = options.startDay ?? data.day0 + 365, endDay = options.endDay ?? data.day1, entryEndDay = options.entryEndDay ?? endDay;
        assert(Number.isInteger(startDay) && Number.isInteger(endDay) && startDay >= data.day0 && endDay <= data.day1 && endDay >= startDay, "Invalid simulation range");
        const startingEquity = options.startingEquity ?? 1e4, slots = options.slots ?? 5, exposure = options.grossExposure ?? options.leverage ?? variant.grossExposure ?? variant.leverage ?? 1;
        const feeRate = (costs.feeBpsPerFill ?? 5) / 1e4, slippage = (costs.slippageBpsPerFill ?? 5) / 1e4;
        assert(startingEquity > 0 && slots > 0 && exposure >= 0 && feeRate >= 0 && slippage >= 0 && slippage < 1, "Invalid capital/exposure/cost assumption");
        const byDay = /* @__PURE__ */ new Map(), rejections = [], blockers = [], trades = [], valuations = [], fills = [], fundingCashflows = [], open = [];
        for (const s of allSignals) if (qualifies(s, variant) && s.day >= startDay - 1 && s.day + 1 <= Math.min(endDay, entryEndDay)) {
          if (!byDay.has(s.day + 1)) byDay.set(s.day + 1, []);
          byDay.get(s.day + 1).push(s);
        }
        for (const a of byDay.values()) a.sort(options.signalComparator ?? ((x, y) => y.gap - x.gap || x.id.localeCompare(y.id)));
        let cash = startingEquity, totalFees = 0, totalFunding = 0, totalSlippage = 0, realizedPnl = 0, invalid = false, proxyFundingEvents = 0, proxyFundingCash = 0, fundingLowerAdjustment = 0, fundingUpperAdjustment = 0;
        const price = (sym, d, kind) => data.bySymbol.get(sym)?.[kind]?.[d - data.day0];
        const exitPrice = (sym, d) => positive(price(sym, d, "open")) ? price(sym, d, "open") : price(sym, d, "exitOnlyOpen");
        const pnlAt = (p, d, kind) => p.longQty * (price(p.long, d, kind) - p.longEntry) + p.shortQty * (p.shortEntry - price(p.short, d, kind));
        const grossAt = (p, d, kind) => p.longQty * price(p.long, d, kind) + p.shortQty * price(p.short, d, kind);
        const block = (code, day, extra = {}) => {
          blockers.push({ code, day, ...extra });
          invalid = true;
        };
        const currentEquity = (d, kind) => cash + open.reduce((n, p) => n + pnlAt(p, d, kind), 0);
        const fill = (p, sym, side, qty, reference, timestamp, stage, referenceSource = "complete_daily_trade_open") => {
          const actual = reference * (side === "buy" ? 1 + slippage : 1 - slippage), fee = qty * actual * feeRate, impact = qty * Math.abs(actual - reference);
          totalFees += fee;
          totalSlippage += impact;
          p.fees += fee;
          p.slippageCost += impact;
          cash -= fee;
          fills.push({ id: `${p.id}:${stage}:${sym}`, tradeId: p.id, timestamp, symbol: sym, side, quantity: qty, referencePrice: reference, referenceSource, price: actual, fee });
          return actual;
        };
        const settle = (p, a, b) => {
          for (const [sym, qty] of [[p.long, p.longQty], [p.short, -p.shortQty]]) for (const e of fundingBetween(funding, sym, a, b)) {
            const amount = -qty * e.markPrice * e.rate;
            cash += amount;
            p.funding += amount;
            totalFunding += amount;
            let lowAmount = amount, highAmount = amount;
            if (e.markPriceSource === "hour_open_proxy") {
              proxyFundingEvents++;
              proxyFundingCash += amount;
              if (positive(Number(e.markLow)) && positive(Number(e.markHigh))) {
                const a2 = -qty * Number(e.markLow) * e.rate, b2 = -qty * Number(e.markHigh) * e.rate;
                lowAmount = Math.min(a2, b2);
                highAmount = Math.max(a2, b2);
                fundingLowerAdjustment += lowAmount - amount;
                fundingUpperAdjustment += highAmount - amount;
              }
            }
            fundingCashflows.push({ tradeId: p.id, symbol: sym, ...e, quantity: qty, amount, lowAmount, highAmount });
          }
        };
        valuations.push({ timestamp: startDay * DAY, observationTimestamp: startDay * DAY, equity: startingEquity, cash, openCount: 0, grossNotional: 0, totalFees: 0, totalFunding: 0, unrealizedPnl: 0 });
        for (let d = startDay; d <= endDay; d++) {
          const t = d * DAY, fillTime = t + 1e3, closeTime = (d + 1) * DAY - 1;
          for (const p of open) {
            const heldEnd = p.pendingExit ? fillTime : closeTime;
            for (const sym of [p.long, p.short]) {
              if (!positive(p.pendingExit ? exitPrice(sym, d) : price(sym, d, "open")) || !p.pendingExit && !positive(price(sym, d, "close"))) block("MISSING_HELD_PRICE", d, { tradeId: p.id, symbol: sym });
              if (!covered(funding, sym, t, heldEnd)) block("MISSING_HELD_FUNDING_COVERAGE", d, { tradeId: p.id, symbol: sym });
              if (fundingBetween(funding, sym, fillTime, fillTime).length) block("AMBIGUOUS_FUNDING_FILL_TIMESTAMP", d, { tradeId: p.id, symbol: sym });
              for (const e of fundingBetween(funding, sym, t, heldEnd)) if (!positive(e.markPrice)) block("MISSING_HELD_FUNDING_MARK", d, { tradeId: p.id, symbol: sym, timestamp: e.timestamp });
            }
          }
          if (invalid) break;
          for (const p of open) settle(p, t, fillTime - 1);
          for (let i = open.length - 1; i >= 0; i--) {
            const p = open[i];
            if (!p.pendingExit) continue;
            p.longExit = fill(p, p.long, "sell", p.longQty, exitPrice(p.long, d), fillTime, "exit", positive(price(p.long, d, "open")) ? "complete_daily_trade_open" : "verified_partial_delivery_day_open");
            p.shortExit = fill(p, p.short, "buy", p.shortQty, exitPrice(p.short, d), fillTime, "exit", positive(price(p.short, d, "open")) ? "complete_daily_trade_open" : "verified_partial_delivery_day_open");
            p.grossPnl = p.longQty * (p.longExit - p.longEntry) + p.shortQty * (p.shortEntry - p.shortExit);
            cash += p.grossPnl;
            realizedPnl += p.grossPnl;
            p.exitTime = fillTime;
            p.exitDay = d;
            p.exitReason = p.pendingExit.reason;
            p.exitSignalDay = p.pendingExit.day;
            p.netPnl = p.grossPnl + p.funding - p.fees;
            p.returnOnEntryLeg = p.netPnl / p.entryLegNotional;
            p.returnOnEntryGross = p.netPnl / (2 * p.entryLegNotional);
            p.holdDays = (p.exitTime - p.entryTime) / DAY;
            p.pendingExit = null;
            p.status = "closed";
            open.splice(i, 1);
          }
          const occupied = new Set(open.flatMap((p) => [p.long, p.short]));
          for (const s of byDay.get(d) || []) {
            if (open.length >= slots) {
              rejections.push({ id: s.id, day: d, reason: "SLOTS_OCCUPIED" });
              continue;
            }
            if (occupied.has(s.long) || occupied.has(s.short)) {
              rejections.push({ id: s.id, day: d, reason: "TOKEN_OCCUPIED" });
              continue;
            }
            const carry = carryAt(funding, s);
            if (carry === null) {
              rejections.push({ id: s.id, day: d, reason: "MISSING_ENTRY_FUNDING_COVERAGE" });
              continue;
            }
            if (!(carry > (variant.minCarry ?? -5e-3))) {
              rejections.push({ id: s.id, day: d, reason: "CARRY_FILTER", carry });
              continue;
            }
            if (!positive(price(s.long, d, "open")) || !positive(price(s.short, d, "open"))) {
              rejections.push({ id: s.id, day: d, reason: "MISSING_ENTRY_PRICE" });
              continue;
            }
            const equity = currentEquity(d, "open");
            if (!(equity > 0)) {
              rejections.push({ id: s.id, day: d, reason: "NONPOSITIVE_EQUITY" });
              continue;
            }
            const notional = equity * exposure / (2 * slots);
            if (!(notional > 0)) continue;
            const existingGross = open.reduce((n, p2) => n + grossAt(p2, d, "open"), 0);
            if (existingGross + 2 * notional > equity * exposure + 1e-8) {
              rejections.push({ id: s.id, day: d, reason: "OVER_GROSS_BUDGET", existingGross, newGross: 2 * notional, budget: equity * exposure });
              continue;
            }
            const longEntry = price(s.long, d, "open") * (1 + slippage), shortEntry = price(s.short, d, "open") * (1 - slippage);
            const p = { id: `${variant.id || "variant"}:${s.id}`, signalId: s.id, signalDay: s.day, signalTime: (s.day + 1) * DAY, signalAvailableTime: (s.day + 1) * DAY, candleCloseTime: s.signalTime ?? (s.day + 1) * DAY - 1, long: s.long, short: s.short, entryDay: d, entryTime: fillTime, exitTime: null, status: "open", entryZ: s.entryZ ?? s.zEntry, entryLegNotional: notional, entryGrossNotional: 2 * notional, entryAccountEquity: equity, longQty: notional / longEntry, shortQty: notional / shortEntry, longEntry, shortEntry, fees: 0, funding: 0, slippageCost: 0, grossPnl: null, netPnl: null, carryAtEntry: carry, episodeStartDay: s.episodeStartDay, preDipDay: s.preDipDay, variantId: variant.id, pendingExit: null };
            Object.assign(p, freezeExitMetadata(s, variant));
            if (variant.netStop != null) Object.assign(p, { netStopFraction: variant.netStop, netStopDecisions: [], netStopDecision: null });
            p.longEntry = fill(p, p.long, "buy", p.longQty, price(p.long, d, "open"), fillTime, "entry");
            p.shortEntry = fill(p, p.short, "sell", p.shortQty, price(p.short, d, "open"), fillTime, "entry");
            open.push(p);
            trades.push(p);
            occupied.add(p.long);
            occupied.add(p.short);
          }
          for (const p of open) {
            for (const sym of [p.long, p.short]) {
              if (!positive(price(sym, d, "close"))) block("MISSING_HELD_CLOSE", d, { tradeId: p.id, symbol: sym });
              if (!covered(funding, sym, fillTime + 1, closeTime)) block("MISSING_HELD_FUNDING_COVERAGE", d, { tradeId: p.id, symbol: sym });
              if (fundingBetween(funding, sym, fillTime, fillTime).length) block("AMBIGUOUS_FUNDING_FILL_TIMESTAMP", d, { tradeId: p.id, symbol: sym });
              for (const e of fundingBetween(funding, sym, fillTime + 1, closeTime)) if (!positive(e.markPrice)) block("MISSING_HELD_FUNDING_MARK", d, { tradeId: p.id, symbol: sym, timestamp: e.timestamp });
            }
          }
          if (invalid) break;
          for (const p of open) {
            settle(p, fillTime + 1, closeTime);
            const profit = pnlAt(p, d, "close");
            const z = exitZ(data, p.long, p.short, d, 180), age = d - p.entryDay + 1;
            const logRatio = Math.log(price(p.long, d, "close") / price(p.short, d, "close"));
            let netStopCheck = null;
            if (variant.netStop != null) {
              const estimate = estimateNetLiquidation(p, price(p.long, d, "close"), price(p.short, d, "close"), feeRate, slippage);
              netStopCheck = { day: d, observationTime: closeTime, decisionAvailableTime: (d + 1) * DAY, fundingThroughTime: closeTime, ...estimate, thresholdFraction: -variant.netStop, thresholdCash: -variant.netStop * p.entryLegNotional, triggered: estimate.estimatedReturnOnEntryLeg <= -variant.netStop };
              p.netStopDecisions.push(netStopCheck);
              if (netStopCheck.triggered) p.netStopDecision = netStopCheck;
            }
            const reason = netStopCheck?.triggered ? "net_stop" : positionExitReason(p, variant, logRatio, z, profit, age);
            if (reason) p.pendingExit = { day: d, reason };
            p.markedGrossPnl = profit;
            p.markedNetPnl = profit + p.funding - p.fees;
            p.lastMarkTime = closeTime;
          }
          const unrealizedPnl = open.reduce((n, p) => n + pnlAt(p, d, "close"), 0), grossNotional = open.reduce((n, p) => n + grossAt(p, d, "close"), 0);
          const positions = open.map((p) => ({ tradeId: p.id, long: p.long, short: p.short, longNotional: p.longQty * price(p.long, d, "close"), shortNotional: p.shortQty * price(p.short, d, "close"), unrealizedPnl: pnlAt(p, d, "close") }));
          const longNotional = positions.reduce((n, p) => n + p.longNotional, 0), shortNotional = positions.reduce((n, p) => n + p.shortNotional, 0);
          valuations.push({ timestamp: (d + 1) * DAY, observationTimestamp: closeTime, day: d, equity: cash + unrealizedPnl, cash, openCount: open.length, grossNotional, longNotional, shortNotional, netNotional: longNotional - shortNotional, positions, totalFees, totalFunding, totalSlippage, realizedPnl, unrealizedPnl, fundingLowerAdjustment, fundingUpperAdjustment });
        }
        const final = valuations[valuations.length - 1];
        for (const p of open) {
          p.status = "open_at_sample_end";
          p.netPnl = null;
          p.grossPnl = null;
        }
        let peak = startingEquity, maxDrawdown = 0, minEquity = startingEquity;
        for (const v of valuations) {
          peak = Math.max(peak, v.equity);
          minEquity = Math.min(minEquity, v.equity);
          maxDrawdown = Math.max(maxDrawdown, (peak - v.equity) / peak);
        }
        const months = [];
        let begin = valuations[0];
        for (let i = 1; i < valuations.length; i++) {
          const v = valuations[i], date = new Date(v.timestamp);
          if (date.getUTCDate() === 1 && date.getUTCHours() === 0 || i === valuations.length - 1) {
            months.push({ month: iso(begin.timestamp).slice(0, 7), startTime: begin.timestamp, endTime: v.timestamp, startEquity: begin.equity, endEquity: v.equity, pnl: v.equity - begin.equity, returnOnStartEquity: begin.equity > 0 ? v.equity / begin.equity - 1 : null, partial: new Date(begin.timestamp).getUTCDate() !== 1 || date.getUTCDate() !== 1 });
            begin = v;
          }
        }
        const missingEntryFundingCoverage = rejections.filter((r) => r.reason === "MISSING_ENTRY_FUNDING_COVERAGE").length;
        const missingEntryPrices = rejections.filter((r) => r.reason === "MISSING_ENTRY_PRICE").length;
        const missingEntryCoverage = missingEntryFundingCoverage + missingEntryPrices;
        return { variantId: variant.id, variant, exposure, costs: { feeBpsPerFill: feeRate * 1e4, slippageBpsPerFill: slippage * 1e4 }, startDay, endDay, entryEndDay, startTime: startDay * DAY, endTime: (endDay + 1) * DAY, startingEquity, finalEquity: final.equity, totalPnl: final.equity - startingEquity, totalReturn: final.equity / startingEquity - 1, final, valuations, months, trades, fills, fundingCashflows, rejections, blockers, valid: !invalid, complete: !invalid && missingEntryCoverage === 0, hasOpenPositions: open.length > 0, closedTrades: trades.filter((p) => p.exitTime !== null).length, openTrades: open.length, totalFees, totalFunding, totalSlippage, proxyFundingEvents, proxyFundingCash, fundingSensitivity: { lowerCashAdjustment: fundingLowerAdjustment, upperCashAdjustment: fundingUpperAdjustment, interpretation: "Fixed realized quantity path, replacing proxy event marks by hourly low/high; not a reoptimized portfolio or an intrahour probability model." }, quality: { executedCoverageComplete: !invalid, allCandidateEntryCoverageComplete: missingEntryCoverage === 0, criticalErrors: blockers, proxyFundingEvents, conditionalOnFundingMarkProxies: proxyFundingEvents > 0 }, observedRisk: { maxDrawdownFraction: maxDrawdown, minEquity, nonPositiveEquityObserved: minEquity <= 0, coverage: "daily_trade_price_close_snapshots_only", liquidationModeled: false, includesUnobservedIntradayExcursions: false }, dataQuality: { ...data.metadata, funding: funding.metadata, missingEntryCoverage, missingEntryFundingCoverage, missingEntryPrices, heldCoverageComplete: !invalid }, executionAssumptions: { entry: "first next-day daily open with adverse slippage; synthetic fill1second after finalized-bar availability at UTC00:00:01.000; actual executable quote/latency is unknown", exit: "next-day open after daily-close condition; no forced sample-end close", valuation: "daily last-price close labelled at following UTC midnight (observation 1ms earlier)", funding: "event contemporaneous mark price multiplied by fixed signed position quantity; midnight settlement precedes next-open fills", calendar: "complete status depends on externally supplied coverage intervals; event rows alone cannot prove expected settlements", liquidationModeled: false, partialFillsModeled: false } };
      }
      function exitZ(data, long, short, d, L = 180) {
        const A = data.bySymbol.get(long), B = data.bySymbol.get(short), i = d - data.day0;
        if (!A || !B || i < L) return NaN;
        let sum = 0, ss = 0;
        for (let j = i - L; j < i; j++) {
          if (!positive(A.close[j]) || !positive(B.close[j])) return NaN;
          const y = Math.log(A.close[j] / B.close[j]);
          sum += y;
          ss += y * y;
        }
        if (!positive(A.close[i]) || !positive(B.close[i])) return NaN;
        const sd = Math.sqrt(Math.max(0, (ss - sum * sum / L) / (L - 1)));
        return sd > 0 ? (Math.log(A.close[i] / B.close[i]) - sum / L) / sd : NaN;
      }
      module.exports = { DAY, WEEK0, EXCLUDED, prepareData, signals, qualifies, simulate, fundingIndex, covered, carryAt, exitZ, weekStart, _test: { prefix, windowStats, oscillator, weeklyUniverses, fundingBetween, causalSignalFields, validExitMode, validNetStop, validChannel, fixedEventTarget, freezeExitMetadata, positionExitReason, estimateNetLiquidation } };
    }
  });

  // adapter:crypto
  var require_crypto = __commonJS({
    "adapter:crypto"(exports, module) {
      module.exports = { createHash: () => {
        throw Error("CLI source hashing is unavailable inside the browser; published assets use Web Crypto validation.");
      } };
    }
  });

  // adapter:assert/strict
  var require_strict = __commonJS({
    "adapter:assert/strict"(exports, module) {
      function a(v, m) {
        if (!v) throw Error(m || "Assertion failed");
      }
      a.ok = a;
      a.equal = a.strictEqual = (x, y, m) => a(Object.is(x, y), m);
      a.deepEqual = a.deepStrictEqual = (x, y, m) => a(JSON.stringify(x) === JSON.stringify(y), m);
      module.exports = a;
    }
  });

  // research/refinement/round3/engine.js
  var require_engine2 = __commonJS({
    "research/refinement/round3/engine.js"(exports, module) {
      "use strict";
      var DAY = 864e5;
      var WEEK0 = Math.round(Date.UTC(2022, 11, 13) / DAY);
      var EXCLUDED = new Set(["USDC", "FDUSD", "USDE", "USDP", "TUSD", "DAI", "PAXG", "XAUT", "BTCDOM", "DEFI", "FOOTBALL", "BLUEBIRD"].map((s) => s + "USDT"));
      var positive = (v) => Number.isFinite(v) && v > 0;
      var iso = (t) => new Date(t).toISOString();
      var weekStart = (d) => WEEK0 + 7 * Math.floor((d - WEEK0) / 7);
      var assert = (test, message) => {
        if (!test) throw new Error(message);
      };
      function prepareData(raw) {
        if (raw && raw.__prepared) return raw;
        assert(raw && Array.isArray(raw.symbols || raw.tokens), "Dataset requires symbols array");
        const rows = raw.symbols || raw.tokens;
        const day0 = raw.startDay ?? raw.day0;
        const day1 = raw.endDay ?? raw.day1;
        assert(Number.isInteger(day0) && Number.isInteger(day1) && day1 >= day0, "Dataset needs integer UTC startDay/endDay");
        const n = day1 - day0 + 1, tokens = [], bySymbol = /* @__PURE__ */ new Map();
        const omitted = [];
        for (const row of rows) {
          assert(typeof row.sym === "string" && !bySymbol.has(row.sym), "Missing/duplicate symbol");
          if (!Number.isInteger(row.listDay) && !(row.bars?.length || row.closes?.length)) {
            omitted.push({ symbol: row.sym, reason: "NO_LISTING_DATE_OR_PRICE_HISTORY" });
            continue;
          }
          assert(Number.isInteger(row.listDay), `Unknown listing day: ${row.sym}`);
          const k = { ...row, open: new Float64Array(n).fill(NaN), exitOnlyOpen: new Float64Array(n).fill(NaN), high: new Float64Array(n).fill(NaN), low: new Float64Array(n).fill(NaN), close: new Float64Array(n).fill(NaN), volume: new Float64Array(n).fill(NaN) };
          const bars = row.bars || (row.closes || []).map((c, i) => [row.day0 + i, row.open?.[i], row.high?.[i], row.low?.[i], c, row.qv?.[i]]);
          const seen = /* @__PURE__ */ new Set();
          for (const b of bars) {
            const d = b[0], i = d - day0;
            assert(Number.isInteger(d) && !seen.has(d), `Invalid/duplicate candle: ${row.sym}`);
            seen.add(d);
            if (i < 0 || i >= n) continue;
            assert(b.slice(1, 5).every(positive) && Number.isFinite(b[5]) && b[5] >= 0, `Invalid OHLC/volume: ${row.sym} ${d}`);
            assert(b[2] >= Math.max(b[1], b[4]) && b[3] <= Math.min(b[1], b[4]) && b[2] >= b[3], `Inconsistent OHLC: ${row.sym} ${d}`);
            k.open[i] = b[1];
            k.high[i] = b[2];
            k.low[i] = b[3];
            k.close[i] = b[4];
            k.volume[i] = b[5];
          }
          const terminalDays = /* @__PURE__ */ new Set();
          for (const terminal of row.terminalOpens || []) {
            const d = terminal.day, i = d - day0;
            assert(Number.isInteger(d) && !terminalDays.has(d), `Invalid/duplicate terminal day: ${row.sym}`);
            terminalDays.add(d);
            assert(terminal.openTimestamp === d * DAY && Number.isSafeInteger(terminal.deliveryTimestamp) && terminal.openTimestamp + 1e3 < terminal.deliveryTimestamp && positive(terminal.openPrice), `Invalid terminal open or pre-delivery fill ordering: ${row.sym}`);
            if (i < 0 || i >= n) continue;
            if (positive(k.open[i])) assert(Math.abs(k.open[i] - terminal.openPrice) < 1e-10 * Math.max(1, k.open[i]), `Conflicting terminal and full-candle open: ${row.sym}`);
            k.exitOnlyOpen[i] = terminal.openPrice;
          }
          k.volumeSum = new Float64Array(n + 1);
          k.validSum = new Int32Array(n + 1);
          for (let i = 0; i < n; i++) {
            k.volumeSum[i + 1] = k.volumeSum[i] + (Number.isFinite(k.volume[i]) ? k.volume[i] : 0);
            k.validSum[i + 1] = k.validSum[i] + (positive(k.close[i]) ? 1 : 0);
          }
          tokens.push(k);
          bySymbol.set(k.sym, k);
        }
        tokens.sort((a, b) => a.sym.localeCompare(b.sym));
        return { __prepared: true, day0, day1, n, tokens, bySymbol, metadata: { ...raw.metadata || raw.quality || {}, omittedSymbols: omitted }, source: { asOf: raw.asOf, universe: raw.universe, coverage: raw.coverage, provenance: raw.provenance } };
      }
      function prefix(x) {
        const n = x.length, p = { x: new Float64Array(n + 1), xx: new Float64Array(n + 1), tx: new Float64Array(n + 1), valid: new Int32Array(n + 1), dy2: new Float64Array(n + 1), zdy: new Float64Array(n + 1) };
        for (let i = 0; i < n; i++) {
          const valid = Number.isFinite(x[i]), v = valid ? x[i] : 0;
          p.x[i + 1] = p.x[i] + v;
          p.xx[i + 1] = p.xx[i] + v * v;
          p.tx[i + 1] = p.tx[i] + i * v;
          p.valid[i + 1] = p.valid[i] + Number(valid);
          const dy = i && valid && Number.isFinite(x[i - 1]) ? x[i] - x[i - 1] : 0;
          p.dy2[i + 1] = p.dy2[i] + dy * dy;
          p.zdy[i + 1] = p.zdy[i] + (i && Number.isFinite(x[i - 1]) ? x[i - 1] * dy : 0);
        }
        return p;
      }
      function windowStats(x, p, a, b) {
        const n = b - a;
        if (a < 0 || b > x.length || n < 4 || p.valid[b] - p.valid[a] !== n) return null;
        const sum = (k, l = a, r = b) => p[k][r] - p[k][l], sx = sum("x"), mu = sx / n;
        const ss = Math.max(0, sum("xx") - sx * sx / n), sd = Math.sqrt(ss / (n - 1));
        if (!(sd > 0)) return null;
        const m = n - 1, sz = sum("x", a, b - 1), sy = x[b - 1] - x[a];
        const szz = Math.max(0, sum("xx", a, b - 1) - sz * sz / m);
        const szy = sum("zdy", a + 1, b) - sz * sy / m, syy = Math.max(0, sum("dy2", a + 1, b) - sy * sy / m);
        const beta = szz > 0 ? szy / szz : NaN, rss = Math.max(1e-30, syy - beta * szy), se = Math.sqrt(rss / (m - 2) / szz);
        const cov = sum("tx") - (a + (n - 1) / 2) * sx, tt = n * (n * n - 1) / 12;
        return { mu, sd, df: beta / se, r2: cov * cov / (tt * ss), drift: Math.abs(cov / tt * (n - 1)) / sd };
      }
      function oscillator(x, p, a, b) {
        const st = windowStats(x, p, a, b);
        if (!st) return null;
        let state = 0, sw = 0, both = 0;
        for (let i = a; i < b; i++) {
          if (x[i] >= st.mu + st.sd) {
            if (state === -1) sw++;
            state = 1;
          } else if (x[i] <= st.mu - st.sd) {
            if (state === 1) sw++;
            state = -1;
          }
        }
        for (let k = 0; k < 3; k++) {
          let low = Infinity, high = -Infinity;
          for (let i = a + Math.floor(k * (b - a) / 3); i < a + Math.floor((k + 1) * (b - a) / 3); i++) {
            low = Math.min(low, x[i]);
            high = Math.max(high, x[i]);
          }
          if (high >= st.mu + 0.8 * st.sd && low <= st.mu - 0.8 * st.sd) both++;
        }
        return { drift: st.drift, sw, both, sd: st.sd };
      }
      function gate(st, c) {
        return !!st && st.sd >= c.minSD && st.sd <= c.maxSD && st.df <= c.maxDF && st.r2 < c.maxR2;
      }
      function weeklyUniverses(data, c) {
        const weeks = /* @__PURE__ */ new Map(), pairs = /* @__PURE__ */ new Map();
        for (let w = weekStart(c.startDay) - 7; w <= c.endDay; w += 7) {
          const wi = w - data.day0, ranked = [];
          for (const k of data.tokens) {
            if (EXCLUDED.has(k.sym) || k.excludedByControl || k.listDay > w - c.minHist || wi < 30 || wi > data.n || k.validSum[wi] - k.validSum[wi - 30] !== 30) continue;
            ranked.push({ sym: k.sym, liq: (k.volumeSum[wi] - k.volumeSum[wi - 30]) / 30, listDay: k.listDay });
          }
          ranked.sort((a, b) => b.liq - a.liq || a.sym.localeCompare(b.sym));
          const members = ranked.slice(0, c.topK).map((k, i) => ({ ...k, rank: i + 1 }));
          const ranks = new Map(members.map((k) => [k.sym, k]));
          weeks.set(w, { day: w, members, ranks, candidateCount: ranked.length });
          for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
            const a = members[i], b = members[j];
            if (Math.max(a.listDay, b.listDay) + c.minAge > w + 6) continue;
            const syms = [a.sym, b.sym].sort(), key = syms.join("|");
            if (!pairs.has(key)) pairs.set(key, { a: syms[0], b: syms[1], weeks: [] });
            pairs.get(key).weeks.push(w);
          }
        }
        return { weeks, pairs };
      }
      function signals(input, config = {}) {
        const data = prepareData(input);
        const c = { L: 180, minAge: 365, minHist: 95, topK: 150, minSD: 0.03, maxSD: 0.6, maxDF: -2.86, maxR2: 0.5, episodeStartZ: -2, thetas: [2, 3], bounceZ: 0.75, minDaysSinceLow: 2, maxEntryZ: -1, startDay: data.day0 + 365, endDay: data.day1, ...config };
        assert(c.L === 180, "This registered reconstruction requires L=180");
        const { weeks, pairs } = weeklyUniverses(data, c), rows = [];
        const diag = { pairs: pairs.size, pairWeeks: 0, gatedPairWeeks: 0, bounceRows: 0, missingOscillatorRows: 0 };
        for (const pair of pairs.values()) {
          const A = data.bySymbol.get(pair.a), B = data.bySymbol.get(pair.b), x = new Float64Array(data.n).fill(NaN);
          for (let i = 0; i < data.n; i++) if (positive(A.close[i]) && positive(B.close[i])) x[i] = Math.log(A.close[i] / B.close[i]);
          const p = prefix(x), z = new Float64Array(data.n).fill(NaN), sd = new Float64Array(data.n).fill(NaN), mu = new Float64Array(data.n).fill(NaN);
          for (let i = c.L; i < data.n; i++) if (Number.isFinite(x[i]) && p.valid[i] - p.valid[i - c.L] === c.L) {
            const sum = p.x[i] - p.x[i - c.L], ss = p.xx[i] - p.xx[i - c.L];
            mu[i] = sum / c.L;
            sd[i] = Math.sqrt(Math.max(0, (ss - sum * sum / c.L) / (c.L - 1)));
            if (sd[i] > 0) z[i] = (x[i] - mu[i]) / sd[i];
          }
          const gates = /* @__PURE__ */ new Map();
          for (const w of pair.weeks) {
            const st = windowStats(x, p, w - data.day0 - c.L, w - data.day0);
            diag.pairWeeks++;
            if (gate(st, c)) {
              gates.set(w, st);
              diag.gatedPairWeeks++;
            }
          }
          if (!gates.size) continue;
          for (const dir of [1, -1]) {
            let ep = null, previousEligible = false, lastFinite = -1;
            const deque = [];
            let head = 0, prevCond = c.thetas.map(() => false);
            for (let i = c.L; i < data.n; i++) {
              const d = data.day0 + i, zz = dir * z[i];
              if (!Number.isFinite(zz)) {
                ep = null;
                deque.length = 0;
                head = 0;
                previousEligible = false;
                prevCond.fill(false);
                lastFinite = -1;
                continue;
              }
              if (lastFinite < 0) lastFinite = i;
              if (!ep && zz <= c.episodeStartZ) {
                let f = i;
                for (let j = i - 1; j >= Math.max(c.L, i - 120); j--) {
                  if (!Number.isFinite(z[j])) break;
                  f = j;
                  if (dir * z[j] > -1) break;
                }
                let high = -Infinity;
                for (let j = f; j <= i; j++) high = Math.max(high, dir * x[j]);
                ep = { start: i, lastDeep: i, pre: f, high, low: dir * x[i], osc: void 0 };
              } else if (ep) {
                if (zz <= c.episodeStartZ) ep.lastDeep = i;
                ep.low = Math.min(ep.low, dir * x[i]);
              }
              while (head < deque.length && deque[head] < i - 19) head++;
              while (deque.length > head && dir * z[deque[deque.length - 1]] > zz) deque.pop();
              deque.push(i);
              const e = deque[head], min = dir * z[e], extreme = zz === min ? i : e;
              const base = i - lastFinite >= 20 && i - extreme >= c.minDaysSinceLow && zz >= min + c.bounceZ && zz <= c.maxEntryZ && zz > dir * z[i - 1];
              const cond = c.thetas.map((theta) => base && min <= -theta);
              const w = weekStart(d), st = gates.get(w), eligible = d - A.listDay >= c.minAge && d - B.listDay >= c.minAge && !!st;
              const triggers = c.thetas.filter((_, j) => d >= c.startDay && d <= c.endDay && eligible && cond[j] && !(previousEligible && prevCond[j]));
              if (triggers.length && ep) {
                if (ep.osc === void 0) ep.osc = oscillator(x, p, ep.pre - c.L, ep.pre);
                const S = dir === 1 ? B : A, L = dir === 1 ? A : B;
                let vs = NaN;
                if (i >= 32 && S.validSum[i + 1] - S.validSum[i - 32] === 33) {
                  const recent = (S.volumeSum[i + 1] - S.volumeSum[i - 2]) / 3, prior = (S.volumeSum[i - 2] - S.volumeSum[i - 32]) / 30;
                  if (recent > 0 && prior > 0) vs = Math.log(recent / prior);
                }
                const ranks = weeks.get(w).ranks;
                rows.push({ id: `${d}:${L.sym}/${S.sym}`, day: d, date: iso(d * DAY).slice(0, 10), signalTime: (d + 1) * DAY - 1, long: L.sym, short: S.sym, entryZ: zz, zEntry: zz, zExtreme: min, daysSinceLow: i - extreme, triggerByTheta: Object.fromEntries(c.thetas.map((t) => [t, triggers.includes(t)])), fall: ep.high - ep.low, volumeLogRatio: vs, minVS: vs, vS: vs, osc: ep.osc, gap: Math.expm1(-zz * sd[i]), mu: dir * mu[i], sd: sd[i], df: st.df, r2: st.r2, weeklyDay: w, rankLong: ranks.get(L.sym).rank, rankShort: ranks.get(S.sym).rank, minLiquidity: Math.min(ranks.get(L.sym).liq, ranks.get(S.sym).liq), episodeStartDay: data.day0 + ep.start, preDipDay: data.day0 + ep.pre, oscillatorStartDay: data.day0 + ep.pre - c.L, shortReturnFromPreDip: S.close[i] / S.close[ep.pre] - 1, longReturnFromPreDip: L.close[i] / L.close[ep.pre] - 1 });
                diag.bounceRows++;
                if (!ep.osc) diag.missingOscillatorRows++;
              }
              if (ep && (zz >= 0 && i - ep.lastDeep > 20 || i - ep.lastDeep > 40 || i - ep.start > 120)) ep = null;
              previousEligible = eligible;
              prevCond = cond;
            }
          }
          if (config.onProgress && diag.pairWeeks % 1e3 < 10) config.onProgress({ ...diag });
        }
        rows.sort((a, b) => a.day - b.day || b.gap - a.gap || a.id.localeCompare(b.id));
        return { rows, config: { ...c, onProgress: void 0 }, diagnostics: diag, universes: [...weeks.values()].map((w) => ({ day: w.day, candidateCount: w.candidateCount, members: w.members })), dataQuality: data.metadata };
      }
      function causalSignalFields(s) {
        if (!Number.isInteger(s.day)) return false;
        const available = (s.day + 1) * DAY;
        return ["signalTime", "signalAvailableTime"].every((k) => s[k] == null || Number.isSafeInteger(s[k]) && s[k] <= available);
      }
      function validExitMode(v) {
        const family = v.family ?? "event", mode = v.exitMode ?? "rolling_z";
        return family === "event" ? ["rolling_z", "frozen_half"].includes(mode) : family === "channel" && ["channel_mean", "channel_top"].includes(mode);
      }
      function validNetStop(v) {
        return v.netStop == null || (v.family ?? "event") === "event" && Number.isFinite(v.netStop) && v.netStop > 0;
      }
      function fixedEventTarget(s, v) {
        return s.mu + (v.exitZFraction ?? 0.5) * s.entryZ * s.sd;
      }
      function validChannel(s) {
        const c = s.channel;
        return !!c && causalSignalFields(s) && Number.isFinite(s.entryZ) && Number.isFinite(s.gap) && ["mu", "sd", "averageBottomLog", "averageTopLog", "breakLog"].every((k) => Number.isFinite(c[k])) && c.sd > 0 && c.breakLog < c.averageBottomLog && c.averageBottomLog < c.mu && c.mu < c.averageTopLog && Number.isInteger(c.formationStartDay) && Number.isInteger(c.formationEndDay) && c.formationEndDay - c.formationStartDay === 179 && c.formationEndDay === weekStart(s.day) - 1 && c.formationEndDay < s.day;
      }
      function qualifies(s, v) {
        const family = v.family ?? "event";
        if ((s.family ?? "event") !== family || !validExitMode(v) || !validNetStop(v)) return false;
        if (family === "channel") return validChannel(s);
        if (v.rawRatioUp === true && (!causalSignalFields(s) || !Number.isFinite(s.rawRatioChange) || !(s.rawRatioChange > 0))) return false;
        if (v.exitMode === "frozen_half" && (!causalSignalFields(s) || !Number.isFinite(s.mu) || !positive(s.sd) || !Number.isFinite(s.entryZ) || !Number.isFinite(v.exitZFraction ?? 0.5) || !Number.isFinite(fixedEventTarget(s, v)))) return false;
        return !!s.triggerByTheta?.[v.theta ?? 3] && Number.isFinite(s.fall) && s.fall >= (v.minFall ?? 0.5) && s.osc && s.osc.drift <= (v.maxDrift ?? 0.7) && s.osc.sw >= (v.minSw ?? 5) && s.osc.both >= (v.minThirds ?? 3) && (v.minVS === null || Number.isFinite(s.volumeLogRatio) && s.volumeLogRatio >= (v.minVS ?? 0));
      }
      function freezeExitMetadata(s, v) {
        if (v.family === "channel") return { family: "channel", exitMode: v.exitMode, targetLog: v.exitMode === "channel_mean" ? s.channel.mu : s.channel.averageTopLog, targetFrozenAtSignalTime: (s.day + 1) * DAY, channel: { ...s.channel } };
        const metadata = {};
        if (v.rawRatioUp === true) metadata.signalRawRatioChange = s.rawRatioChange;
        if (v.exitMode === "frozen_half") Object.assign(metadata, { exitMode: "frozen_half", targetLog: fixedEventTarget(s, v), targetFrozenAtSignalTime: (s.day + 1) * DAY, signalMeanLogRatio: s.mu, signalLogRatioSd: s.sd });
        return metadata;
      }
      function positionExitReason(p, v, logRatio, z, profit, age) {
        if (p.family === "channel") {
          if (logRatio <= p.channel.breakLog) return "channel_break";
          if (logRatio >= p.targetLog) return p.exitMode;
        } else {
          if (v.pairStop != null && profit / p.entryLegNotional <= -v.pairStop) return "pair_stop";
          if (p.exitMode === "frozen_half") {
            if (logRatio >= p.targetLog) return "frozen_half";
          } else if (Number.isFinite(z) && z >= (v.exitZFraction ?? 0.5) * p.entryZ) return "rolling_z";
        }
        return age >= (v.maxHold ?? 45) ? "time" : null;
      }
      function estimateNetLiquidation(p, longClose, shortClose, feeRate, slippage) {
        assert(positive(longClose) && positive(shortClose) && positive(p.entryLegNotional), "Invalid net-stop price/notional");
        const estimatedLongExit = longClose * (1 - slippage), estimatedShortExit = shortClose * (1 + slippage);
        const estimatedGrossPnl = p.longQty * (estimatedLongExit - p.longEntry) + p.shortQty * (p.shortEntry - estimatedShortExit);
        const estimatedExitFees = (p.longQty * estimatedLongExit + p.shortQty * estimatedShortExit) * feeRate;
        const estimatedExitSlippage = p.longQty * (longClose - estimatedLongExit) + p.shortQty * (estimatedShortExit - shortClose);
        const entryFees = p.fees, settledFunding = p.funding;
        const estimatedNetPnl = estimatedGrossPnl + settledFunding - entryFees - estimatedExitFees;
        const estimatedReturnOnEntryLeg = estimatedNetPnl / p.entryLegNotional;
        assert([estimatedLongExit, estimatedShortExit, estimatedGrossPnl, estimatedExitFees, estimatedExitSlippage, entryFees, settledFunding, estimatedNetPnl, estimatedReturnOnEntryLeg].every(Number.isFinite), "Nonfinite net-stop estimate");
        return { longClose, shortClose, estimatedLongExit, estimatedShortExit, estimatedGrossPnl, estimatedExitFees, estimatedExitSlippage, entryFees, settledFunding, estimatedNetPnl, estimatedReturnOnEntryLeg, entryLegNotional: p.entryLegNotional, feeRate, slippage };
      }
      function fundingIndex(raw) {
        if (raw?.__indexedFunding) return raw;
        const source = raw?.symbols || raw || {}, bySymbol = /* @__PURE__ */ new Map();
        for (const [name, sourceRow] of Array.isArray(source) ? source.map((x) => [x.sym || x.symbol, x]) : Object.entries(source)) {
          if (!sourceRow || typeof sourceRow !== "object") continue;
          const row = Array.isArray(sourceRow) ? { events: sourceRow } : sourceRow;
          const events = (row.events || []).map((e) => ({ ...e, timestamp: Number(e.timestamp ?? e.fundingTime), rate: Number(e.rate ?? e.fundingRate), markPrice: Number(e.markPrice) })).sort((a, b) => a.timestamp - b.timestamp);
          let previous = -Infinity;
          for (const e of events) {
            assert(Number.isSafeInteger(e.timestamp) && Number.isFinite(e.rate), `Invalid funding event timestamp/rate ${name}`);
            assert(e.timestamp > previous, `Duplicate funding event ${name}`);
            previous = e.timestamp;
          }
          const intervals = row.intervals || row.coverageIntervals || row.coverage || [{ start: row.coverageStart, end: row.coverageEnd, complete: row.complete }];
          bySymbol.set(name, { ...row, events, intervals: intervals.map((r) => ({ start: Number(r.start ?? r.startTime ?? r.coverageStart), end: Number(r.end ?? r.endTime ?? r.coverageEnd), complete: r.complete ?? (r.status === "retrieved" ? true : row.complete) })), gaps: row.gaps || [] });
        }
        return { __indexedFunding: true, bySymbol, metadata: { source: raw?.source, counts: raw?.counts, coverageInterpretation: raw?.coverage_interpretation, ...raw?.metadata || {} } };
      }
      function covered(f, s, a, b) {
        const r = f.bySymbol.get(s);
        if (!r) return false;
        if (r.gaps.some((g) => Number(g.start ?? g.startTime ?? g[0]) <= b && Number(g.end ?? g.endTime ?? g[1]) >= a)) return false;
        let reached = a;
        for (const i of [...r.intervals].filter((i2) => i2.complete === true).sort((x, y) => x.start - y.start)) {
          if (i.end < reached) continue;
          if (i.start > reached) return false;
          reached = Math.max(reached, i.end + 1);
          if (reached > b) return true;
        }
        return false;
      }
      function lowerBound(events, t) {
        let lo = 0, hi = events.length;
        while (lo < hi) {
          const m = lo + hi >> 1;
          if (events[m].timestamp < t) lo = m + 1;
          else hi = m;
        }
        return lo;
      }
      function fundingBetween(f, s, a, b) {
        const events = f.bySymbol.get(s)?.events || [], out = [];
        for (let i = lowerBound(events, a); i < events.length && events[i].timestamp <= b; i++) out.push(events[i]);
        return out;
      }
      function carryAt(f, s) {
        const a = (s.day - 6) * DAY, b = (s.day + 1) * DAY - 1;
        if (!covered(f, s.long, a, b) || !covered(f, s.short, a, b)) return null;
        const sum = (sym) => fundingBetween(f, sym, a, b).reduce((n, e) => n + e.rate, 0);
        return (sum(s.short) - sum(s.long)) / 7;
      }
      function simulate(input, signalInput, variant, fundingRaw, costs = {}, options = {}) {
        assert(validExitMode(variant), "Invalid or incompatible variant family/exitMode");
        assert(validNetStop(variant), "Invalid or incompatible netStop");
        const data = prepareData(input), funding = fundingIndex(fundingRaw), allSignals = Array.isArray(signalInput) ? signalInput : signalInput.rows || signalInput.signals;
        const startDay = options.startDay ?? data.day0 + 365, endDay = options.endDay ?? data.day1, entryEndDay = options.entryEndDay ?? endDay;
        assert(Number.isInteger(startDay) && Number.isInteger(endDay) && startDay >= data.day0 && endDay <= data.day1 && endDay >= startDay, "Invalid simulation range");
        const startingEquity = options.startingEquity ?? 1e4, slots = options.slots ?? 5, exposure = options.grossExposure ?? options.leverage ?? variant.grossExposure ?? variant.leverage ?? 1;
        const feeRate = (costs.feeBpsPerFill ?? 5) / 1e4, slippage = (costs.slippageBpsPerFill ?? 5) / 1e4;
        assert(startingEquity > 0 && slots > 0 && exposure >= 0 && feeRate >= 0 && slippage >= 0 && slippage < 1, "Invalid capital/exposure/cost assumption");
        const byDay = /* @__PURE__ */ new Map(), rejections = [], blockers = [], trades = [], valuations = [], fills = [], fundingCashflows = [], open = [];
        for (const s of allSignals) if (qualifies(s, variant) && s.day >= startDay - 1 && s.day + 1 <= Math.min(endDay, entryEndDay)) {
          if (!byDay.has(s.day + 1)) byDay.set(s.day + 1, []);
          byDay.get(s.day + 1).push(s);
        }
        for (const a of byDay.values()) a.sort((x, y) => y.gap - x.gap || x.id.localeCompare(y.id));
        let cash = startingEquity, totalFees = 0, totalFunding = 0, totalSlippage = 0, realizedPnl = 0, invalid = false, proxyFundingEvents = 0, proxyFundingCash = 0, fundingLowerAdjustment = 0, fundingUpperAdjustment = 0;
        const price = (sym, d, kind) => data.bySymbol.get(sym)?.[kind]?.[d - data.day0];
        const exitPrice = (sym, d) => positive(price(sym, d, "open")) ? price(sym, d, "open") : price(sym, d, "exitOnlyOpen");
        const pnlAt = (p, d, kind) => p.longQty * (price(p.long, d, kind) - p.longEntry) + p.shortQty * (p.shortEntry - price(p.short, d, kind));
        const grossAt = (p, d, kind) => p.longQty * price(p.long, d, kind) + p.shortQty * price(p.short, d, kind);
        const block = (code, day, extra = {}) => {
          blockers.push({ code, day, ...extra });
          invalid = true;
        };
        const currentEquity = (d, kind) => cash + open.reduce((n, p) => n + pnlAt(p, d, kind), 0);
        const fill = (p, sym, side, qty, reference, timestamp, stage, referenceSource = "complete_daily_trade_open") => {
          const actual = reference * (side === "buy" ? 1 + slippage : 1 - slippage), fee = qty * actual * feeRate, impact = qty * Math.abs(actual - reference);
          totalFees += fee;
          totalSlippage += impact;
          p.fees += fee;
          p.slippageCost += impact;
          cash -= fee;
          fills.push({ id: `${p.id}:${stage}:${sym}`, tradeId: p.id, timestamp, symbol: sym, side, quantity: qty, referencePrice: reference, referenceSource, price: actual, fee });
          return actual;
        };
        const settle = (p, a, b) => {
          for (const [sym, qty] of [[p.long, p.longQty], [p.short, -p.shortQty]]) for (const e of fundingBetween(funding, sym, a, b)) {
            const amount = -qty * e.markPrice * e.rate;
            cash += amount;
            p.funding += amount;
            totalFunding += amount;
            let lowAmount = amount, highAmount = amount;
            if (e.markPriceSource === "hour_open_proxy") {
              proxyFundingEvents++;
              proxyFundingCash += amount;
              if (positive(Number(e.markLow)) && positive(Number(e.markHigh))) {
                const a2 = -qty * Number(e.markLow) * e.rate, b2 = -qty * Number(e.markHigh) * e.rate;
                lowAmount = Math.min(a2, b2);
                highAmount = Math.max(a2, b2);
                fundingLowerAdjustment += lowAmount - amount;
                fundingUpperAdjustment += highAmount - amount;
              }
            }
            fundingCashflows.push({ tradeId: p.id, symbol: sym, ...e, quantity: qty, amount, lowAmount, highAmount });
          }
        };
        valuations.push({ timestamp: startDay * DAY, observationTimestamp: startDay * DAY, equity: startingEquity, cash, openCount: 0, grossNotional: 0, totalFees: 0, totalFunding: 0, unrealizedPnl: 0 });
        for (let d = startDay; d <= endDay; d++) {
          const t = d * DAY, fillTime = t + 1e3, closeTime = (d + 1) * DAY - 1;
          for (const p of open) {
            const heldEnd = p.pendingExit ? fillTime : closeTime;
            for (const sym of [p.long, p.short]) {
              if (!positive(p.pendingExit ? exitPrice(sym, d) : price(sym, d, "open")) || !p.pendingExit && !positive(price(sym, d, "close"))) block("MISSING_HELD_PRICE", d, { tradeId: p.id, symbol: sym });
              if (!covered(funding, sym, t, heldEnd)) block("MISSING_HELD_FUNDING_COVERAGE", d, { tradeId: p.id, symbol: sym });
              if (fundingBetween(funding, sym, fillTime, fillTime).length) block("AMBIGUOUS_FUNDING_FILL_TIMESTAMP", d, { tradeId: p.id, symbol: sym });
              for (const e of fundingBetween(funding, sym, t, heldEnd)) if (!positive(e.markPrice)) block("MISSING_HELD_FUNDING_MARK", d, { tradeId: p.id, symbol: sym, timestamp: e.timestamp });
            }
          }
          if (invalid) break;
          for (const p of open) settle(p, t, fillTime - 1);
          for (let i = open.length - 1; i >= 0; i--) {
            const p = open[i];
            if (!p.pendingExit) continue;
            p.longExit = fill(p, p.long, "sell", p.longQty, exitPrice(p.long, d), fillTime, "exit", positive(price(p.long, d, "open")) ? "complete_daily_trade_open" : "verified_partial_delivery_day_open");
            p.shortExit = fill(p, p.short, "buy", p.shortQty, exitPrice(p.short, d), fillTime, "exit", positive(price(p.short, d, "open")) ? "complete_daily_trade_open" : "verified_partial_delivery_day_open");
            p.grossPnl = p.longQty * (p.longExit - p.longEntry) + p.shortQty * (p.shortEntry - p.shortExit);
            cash += p.grossPnl;
            realizedPnl += p.grossPnl;
            p.exitTime = fillTime;
            p.exitDay = d;
            p.exitReason = p.pendingExit.reason;
            p.exitSignalDay = p.pendingExit.day;
            p.netPnl = p.grossPnl + p.funding - p.fees;
            p.returnOnEntryLeg = p.netPnl / p.entryLegNotional;
            p.returnOnEntryGross = p.netPnl / (2 * p.entryLegNotional);
            p.holdDays = (p.exitTime - p.entryTime) / DAY;
            p.pendingExit = null;
            p.status = "closed";
            open.splice(i, 1);
          }
          const occupied = new Set(open.flatMap((p) => [p.long, p.short]));
          for (const s of byDay.get(d) || []) {
            if (open.length >= slots) {
              rejections.push({ id: s.id, day: d, reason: "SLOTS_OCCUPIED" });
              continue;
            }
            if (occupied.has(s.long) || occupied.has(s.short)) {
              rejections.push({ id: s.id, day: d, reason: "TOKEN_OCCUPIED" });
              continue;
            }
            const carry = carryAt(funding, s);
            if (carry === null) {
              rejections.push({ id: s.id, day: d, reason: "MISSING_ENTRY_FUNDING_COVERAGE" });
              continue;
            }
            if (!(carry > (variant.minCarry ?? -5e-3))) {
              rejections.push({ id: s.id, day: d, reason: "CARRY_FILTER", carry });
              continue;
            }
            if (!positive(price(s.long, d, "open")) || !positive(price(s.short, d, "open"))) {
              rejections.push({ id: s.id, day: d, reason: "MISSING_ENTRY_PRICE" });
              continue;
            }
            const equity = currentEquity(d, "open");
            if (!(equity > 0)) {
              rejections.push({ id: s.id, day: d, reason: "NONPOSITIVE_EQUITY" });
              continue;
            }
            const notional = equity * exposure / (2 * slots);
            if (!(notional > 0)) continue;
            const existingGross = open.reduce((n, p2) => n + grossAt(p2, d, "open"), 0);
            if (existingGross + 2 * notional > equity * exposure + 1e-8) {
              rejections.push({ id: s.id, day: d, reason: "OVER_GROSS_BUDGET", existingGross, newGross: 2 * notional, budget: equity * exposure });
              continue;
            }
            const longEntry = price(s.long, d, "open") * (1 + slippage), shortEntry = price(s.short, d, "open") * (1 - slippage);
            const p = { id: `${variant.id || "variant"}:${s.id}`, signalId: s.id, signalDay: s.day, signalTime: (s.day + 1) * DAY, signalAvailableTime: (s.day + 1) * DAY, candleCloseTime: s.signalTime ?? (s.day + 1) * DAY - 1, long: s.long, short: s.short, entryDay: d, entryTime: fillTime, exitTime: null, status: "open", entryZ: s.entryZ ?? s.zEntry, entryLegNotional: notional, entryGrossNotional: 2 * notional, entryAccountEquity: equity, longQty: notional / longEntry, shortQty: notional / shortEntry, longEntry, shortEntry, fees: 0, funding: 0, slippageCost: 0, grossPnl: null, netPnl: null, carryAtEntry: carry, episodeStartDay: s.episodeStartDay, preDipDay: s.preDipDay, variantId: variant.id, pendingExit: null };
            Object.assign(p, freezeExitMetadata(s, variant));
            if (variant.netStop != null) Object.assign(p, { netStopFraction: variant.netStop, netStopDecisions: [], netStopDecision: null });
            p.longEntry = fill(p, p.long, "buy", p.longQty, price(p.long, d, "open"), fillTime, "entry");
            p.shortEntry = fill(p, p.short, "sell", p.shortQty, price(p.short, d, "open"), fillTime, "entry");
            open.push(p);
            trades.push(p);
            occupied.add(p.long);
            occupied.add(p.short);
          }
          for (const p of open) {
            for (const sym of [p.long, p.short]) {
              if (!positive(price(sym, d, "close"))) block("MISSING_HELD_CLOSE", d, { tradeId: p.id, symbol: sym });
              if (!covered(funding, sym, fillTime + 1, closeTime)) block("MISSING_HELD_FUNDING_COVERAGE", d, { tradeId: p.id, symbol: sym });
              if (fundingBetween(funding, sym, fillTime, fillTime).length) block("AMBIGUOUS_FUNDING_FILL_TIMESTAMP", d, { tradeId: p.id, symbol: sym });
              for (const e of fundingBetween(funding, sym, fillTime + 1, closeTime)) if (!positive(e.markPrice)) block("MISSING_HELD_FUNDING_MARK", d, { tradeId: p.id, symbol: sym, timestamp: e.timestamp });
            }
          }
          if (invalid) break;
          for (const p of open) {
            settle(p, fillTime + 1, closeTime);
            const profit = pnlAt(p, d, "close");
            const z = exitZ(data, p.long, p.short, d, 180), age = d - p.entryDay + 1;
            const logRatio = Math.log(price(p.long, d, "close") / price(p.short, d, "close"));
            let netStopCheck = null;
            if (variant.netStop != null) {
              const estimate = estimateNetLiquidation(p, price(p.long, d, "close"), price(p.short, d, "close"), feeRate, slippage);
              netStopCheck = { day: d, observationTime: closeTime, decisionAvailableTime: (d + 1) * DAY, fundingThroughTime: closeTime, ...estimate, thresholdFraction: -variant.netStop, thresholdCash: -variant.netStop * p.entryLegNotional, triggered: estimate.estimatedReturnOnEntryLeg <= -variant.netStop };
              p.netStopDecisions.push(netStopCheck);
              if (netStopCheck.triggered) p.netStopDecision = netStopCheck;
            }
            const reason = netStopCheck?.triggered ? "net_stop" : positionExitReason(p, variant, logRatio, z, profit, age);
            if (reason) p.pendingExit = { day: d, reason };
            p.markedGrossPnl = profit;
            p.markedNetPnl = profit + p.funding - p.fees;
            p.lastMarkTime = closeTime;
          }
          const unrealizedPnl = open.reduce((n, p) => n + pnlAt(p, d, "close"), 0), grossNotional = open.reduce((n, p) => n + grossAt(p, d, "close"), 0);
          const positions = open.map((p) => ({ tradeId: p.id, long: p.long, short: p.short, longNotional: p.longQty * price(p.long, d, "close"), shortNotional: p.shortQty * price(p.short, d, "close"), unrealizedPnl: pnlAt(p, d, "close") }));
          const longNotional = positions.reduce((n, p) => n + p.longNotional, 0), shortNotional = positions.reduce((n, p) => n + p.shortNotional, 0);
          valuations.push({ timestamp: (d + 1) * DAY, observationTimestamp: closeTime, day: d, equity: cash + unrealizedPnl, cash, openCount: open.length, grossNotional, longNotional, shortNotional, netNotional: longNotional - shortNotional, positions, totalFees, totalFunding, totalSlippage, realizedPnl, unrealizedPnl, fundingLowerAdjustment, fundingUpperAdjustment });
        }
        const final = valuations[valuations.length - 1];
        for (const p of open) {
          p.status = "open_at_sample_end";
          p.netPnl = null;
          p.grossPnl = null;
        }
        let peak = startingEquity, maxDrawdown = 0, minEquity = startingEquity;
        for (const v of valuations) {
          peak = Math.max(peak, v.equity);
          minEquity = Math.min(minEquity, v.equity);
          maxDrawdown = Math.max(maxDrawdown, (peak - v.equity) / peak);
        }
        const months = [];
        let begin = valuations[0];
        for (let i = 1; i < valuations.length; i++) {
          const v = valuations[i], date = new Date(v.timestamp);
          if (date.getUTCDate() === 1 && date.getUTCHours() === 0 || i === valuations.length - 1) {
            months.push({ month: iso(begin.timestamp).slice(0, 7), startTime: begin.timestamp, endTime: v.timestamp, startEquity: begin.equity, endEquity: v.equity, pnl: v.equity - begin.equity, returnOnStartEquity: begin.equity > 0 ? v.equity / begin.equity - 1 : null, partial: new Date(begin.timestamp).getUTCDate() !== 1 || date.getUTCDate() !== 1 });
            begin = v;
          }
        }
        const missingEntryFundingCoverage = rejections.filter((r) => r.reason === "MISSING_ENTRY_FUNDING_COVERAGE").length;
        const missingEntryPrices = rejections.filter((r) => r.reason === "MISSING_ENTRY_PRICE").length;
        const missingEntryCoverage = missingEntryFundingCoverage + missingEntryPrices;
        return { variantId: variant.id, variant, exposure, costs: { feeBpsPerFill: feeRate * 1e4, slippageBpsPerFill: slippage * 1e4 }, startDay, endDay, entryEndDay, startTime: startDay * DAY, endTime: (endDay + 1) * DAY, startingEquity, finalEquity: final.equity, totalPnl: final.equity - startingEquity, totalReturn: final.equity / startingEquity - 1, final, valuations, months, trades, fills, fundingCashflows, rejections, blockers, valid: !invalid, complete: !invalid && missingEntryCoverage === 0, hasOpenPositions: open.length > 0, closedTrades: trades.filter((p) => p.exitTime !== null).length, openTrades: open.length, totalFees, totalFunding, totalSlippage, proxyFundingEvents, proxyFundingCash, fundingSensitivity: { lowerCashAdjustment: fundingLowerAdjustment, upperCashAdjustment: fundingUpperAdjustment, interpretation: "Fixed realized quantity path, replacing proxy event marks by hourly low/high; not a reoptimized portfolio or an intrahour probability model." }, quality: { executedCoverageComplete: !invalid, allCandidateEntryCoverageComplete: missingEntryCoverage === 0, criticalErrors: blockers, proxyFundingEvents, conditionalOnFundingMarkProxies: proxyFundingEvents > 0 }, observedRisk: { maxDrawdownFraction: maxDrawdown, minEquity, nonPositiveEquityObserved: minEquity <= 0, coverage: "daily_trade_price_close_snapshots_only", liquidationModeled: false, includesUnobservedIntradayExcursions: false }, dataQuality: { ...data.metadata, funding: funding.metadata, missingEntryCoverage, missingEntryFundingCoverage, missingEntryPrices, heldCoverageComplete: !invalid }, executionAssumptions: { entry: "first next-day daily open with adverse slippage; synthetic fill1second after finalized-bar availability at UTC00:00:01.000; actual executable quote/latency is unknown", exit: "next-day open after daily-close condition; no forced sample-end close", valuation: "daily last-price close labelled at following UTC midnight (observation 1ms earlier)", funding: "event contemporaneous mark price multiplied by fixed signed position quantity; midnight settlement precedes next-open fills", calendar: "complete status depends on externally supplied coverage intervals; event rows alone cannot prove expected settlements", liquidationModeled: false, partialFillsModeled: false } };
      }
      function exitZ(data, long, short, d, L = 180) {
        const A = data.bySymbol.get(long), B = data.bySymbol.get(short), i = d - data.day0;
        if (!A || !B || i < L) return NaN;
        let sum = 0, ss = 0;
        for (let j = i - L; j < i; j++) {
          if (!positive(A.close[j]) || !positive(B.close[j])) return NaN;
          const y = Math.log(A.close[j] / B.close[j]);
          sum += y;
          ss += y * y;
        }
        if (!positive(A.close[i]) || !positive(B.close[i])) return NaN;
        const sd = Math.sqrt(Math.max(0, (ss - sum * sum / L) / (L - 1)));
        return sd > 0 ? (Math.log(A.close[i] / B.close[i]) - sum / L) / sd : NaN;
      }
      module.exports = { DAY, WEEK0, EXCLUDED, prepareData, signals, qualifies, simulate, fundingIndex, covered, carryAt, exitZ, weekStart, _test: { prefix, windowStats, oscillator, weeklyUniverses, fundingBetween, causalSignalFields, validExitMode, validNetStop, validChannel, fixedEventTarget, freezeExitMetadata, positionExitReason, estimateNetLiquidation } };
    }
  });

  // research/refinement/round6_indicators/features.js
  var require_features = __commonJS({
    "research/refinement/round6_indicators/features.js"(exports, module) {
      "use strict";
      var fs = require_fs();
      var path = require_path();
      var crypto = require_crypto();
      var assert = require_strict();
      var E = require_engine2();
      var DAY = E.DAY;
      var FOUR = DAY / 6;
      var L = 180;
      var finite = Number.isFinite;
      var positive = (x) => finite(x) && x > 0;
      var BASELINE = Object.freeze({ id: "FIXED_45", theta: 3, bounceZ: 0.75, minFall: 0.5, minVS: 0, maxDrift: 0.7, minSw: 5, minThirds: 3, minCarry: -5e-3, exitZFraction: 0.5, maxHold: 45, pairStop: null, family: "event", rawRatioUp: false, exitMode: "frozen_half" });
      function complete(a, start, end) {
        if (!a || start < 0 || end >= a.length || end < start) return false;
        for (let i = start; i <= end; i++) if (!finite(a[i])) return false;
        return true;
      }
      function mean(a, start, end) {
        if (!complete(a, start, end)) return NaN;
        let sum = 0;
        for (let i = start; i <= end; i++) sum += a[i];
        return sum / (end - start + 1);
      }
      function sampleSD(a) {
        if (a.length < 2 || !a.every(finite)) return NaN;
        const m = a.reduce((s, x) => s + x, 0) / a.length;
        return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
      }
      function extrema(a, start, end, kind = "min") {
        if (!complete(a, start, end)) return NaN;
        let out = kind === "min" ? Infinity : -Infinity;
        for (let i = start; i <= end; i++) out = kind === "min" ? Math.min(out, a[i]) : Math.max(out, a[i]);
        return out;
      }
      function cutlerRSI(x, end, n = 14) {
        if (!complete(x, end - n, end)) return NaN;
        let up = 0, down = 0;
        for (let i = end - n + 1; i <= end; i++) {
          const d = x[i] - x[i - 1];
          up += Math.max(0, d);
          down += Math.max(0, -d);
        }
        return up + down > 0 ? 100 * up / (up + down) : 50;
      }
      function realizedVol(logPrices, end, n) {
        if (!complete(logPrices, end - n, end)) return NaN;
        const changes = [];
        for (let i = end - n + 1; i <= end; i++) changes.push(logPrices[i] - logPrices[i - 1]);
        return sampleSD(changes);
      }
      function percentile(values, p) {
        if (!values.length || !values.every(finite) || !(p >= 0 && p <= 1)) return NaN;
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.floor(p * (sorted.length - 1))];
      }
      function simpleReturn(prices, end, n) {
        if (!complete(prices, end - n, end) || !positive(prices[end - n]) || !positive(prices[end])) return NaN;
        return prices[end] / prices[end - n] - 1;
      }
      function logReturn(logPrices, end, n) {
        return complete(logPrices, end - n, end) ? logPrices[end] - logPrices[end - n] : NaN;
      }
      function volumeLog(volume, end) {
        const a = mean(volume, end - 2, end), b = mean(volume, end - 32, end - 3);
        return positive(a) && positive(b) ? Math.log(a / b) : NaN;
      }
      function orientedSeries(long, short, n) {
        const x = new Float64Array(n).fill(NaN), ll = new Float64Array(n).fill(NaN), ls = new Float64Array(n).fill(NaN);
        for (let i = 0; i < n; i++) {
          if (positive(long.close[i])) ll[i] = Math.log(long.close[i]);
          if (positive(short.close[i])) ls[i] = Math.log(short.close[i]);
          if (finite(ll[i]) && finite(ls[i])) x[i] = Math.log(long.close[i] / short.close[i]);
        }
        return { x, ll, ls };
      }
      function rollingDaily(x) {
        const n = x.length, p = E._test.prefix(x), mu = new Float64Array(n).fill(NaN), sd = new Float64Array(n).fill(NaN), z = new Float64Array(n).fill(NaN);
        for (let i = L; i < n; i++) if (finite(x[i]) && p.valid[i] - p.valid[i - L] === L) {
          const sum = p.x[i] - p.x[i - L], ss = p.xx[i] - p.xx[i - L];
          mu[i] = sum / L;
          sd[i] = Math.sqrt(Math.max(0, (ss - sum * sum / L) / (L - 1)));
          if (sd[i] > 0) z[i] = (x[i] - mu[i]) / sd[i];
        }
        return { mu, sd, z, p };
      }
      function episodeSnapshots(series, longVolume, shortVolume, requested) {
        const { x, ll, ls, z, sd } = series, snapshots = /* @__PURE__ */ new Map(), history = [];
        let ep = null;
        for (let i = L; i < x.length; i++) {
          if (!finite(z[i])) {
            ep = null;
            continue;
          }
          if (!ep && z[i] <= -2) {
            let pre = i;
            for (let j = i - 1; j >= Math.max(L, i - 120); j--) {
              if (!finite(z[j])) break;
              pre = j;
              if (z[j] > -1) break;
            }
            let high = -Infinity;
            for (let j = pre; j <= i; j++) high = Math.max(high, x[j]);
            const initStart = Math.max(0, i - 10);
            let volumeMax = -Infinity;
            for (let j = initStart; j <= i; j++) {
              const v = mean(shortVolume, j - 2, j);
              if (!positive(v)) {
                volumeMax = NaN;
                break;
              }
              volumeMax = Math.max(volumeMax, v);
            }
            ep = { start: i, pre, lastDeep: i, lastZ3: z[i] <= -3 ? i : null, high, rawLow: x[i], rawLowDay: i, zLow: z[i], zLowDay: i, rsiAtRawLow: cutlerRSI(x, i), peak: x[i], rb: x[i], bounced: false, retests: 0, lastRetest: null, rev: false, shortPeak: extrema(ls, initStart, i, "max"), longTrough: extrema(ll, initStart, i, "min"), shortVolumeMax: volumeMax };
          } else if (ep) {
            if (z[i] <= -2) ep.lastDeep = i;
            if (z[i] <= -3) ep.lastZ3 = i;
            if (z[i] < ep.zLow) {
              ep.zLow = z[i];
              ep.zLowDay = i;
            }
            if (z[i] >= 0) ep.rev = true;
            if (x[i] < ep.rawLow) {
              ep.rawLow = x[i];
              ep.rawLowDay = i;
              ep.peak = x[i];
              ep.rb = x[i];
              ep.bounced = false;
              ep.rsiAtRawLow = cutlerRSI(x, i);
            } else {
              ep.peak = Math.max(ep.peak, x[i]);
              ep.rb = Math.max(ep.rb, x[i]);
              if ((ep.rb - ep.rawLow) / sd[i] >= 1) ep.bounced = true;
              if (ep.bounced && (x[i] - ep.rawLow) / sd[i] <= 0.5) {
                ep.retests++;
                ep.lastRetest = i;
                ep.bounced = false;
                ep.rb = x[i];
              }
            }
            ep.shortPeak = finite(ep.shortPeak) && finite(ls[i]) ? Math.max(ep.shortPeak, ls[i]) : NaN;
            ep.longTrough = finite(ep.longTrough) && finite(ll[i]) ? Math.min(ep.longTrough, ll[i]) : NaN;
            const v = mean(shortVolume, i - 2, i);
            ep.shortVolumeMax = positive(ep.shortVolumeMax) && positive(v) ? Math.max(ep.shortVolumeMax, v) : NaN;
          }
          if (requested.has(i)) {
            const prior = history.filter((h) => h.end < i && h.start < i - 45);
            snapshots.set(i, { ep: ep ? { ...ep } : null, prior: prior.map((h) => ({ ...h })), prevN: prior.length, prevRev: prior.length ? prior.filter((h) => h.rev).length / prior.length : NaN });
          }
          if (ep && (z[i] >= 0 && i - ep.lastDeep > 20 || i - ep.lastDeep > 40 || i - ep.start > 120)) {
            history.push({ start: ep.start, end: i, rev: ep.rev });
            ep = null;
          }
        }
        return snapshots;
      }
      function weeklyMembers(data, week) {
        const i = week - data.day0, ranked = [];
        for (const s of data.tokens) {
          if (E.EXCLUDED.has(s.sym) || s.excludedByControl || s.listDay > week - 95 || i < 30 || i > data.n || s.validSum[i] - s.validSum[i - 30] !== 30) continue;
          ranked.push({ sym: s.sym, liq: (s.volumeSum[i] - s.volumeSum[i - 30]) / 30, listDay: s.listDay });
        }
        ranked.sort((a, b) => b.liq - a.liq || a.sym.localeCompare(b.sym));
        return ranked.slice(0, 150).map((s, j) => ({ ...s, rank: j + 1 }));
      }
      function altBasketReturn(data, members, day) {
        const usable = members.filter((s) => s.sym !== "BTCUSDT" && day - s.listDay >= 365), i = day - data.day0;
        if (!usable.length) return { value: NaN, count: 0, missingSymbols: [], symbols: [] };
        let sum = 0;
        const missing = [];
        for (const member of usable) {
          const value = simpleReturn(data.bySymbol.get(member.sym)?.close, i, 30);
          if (!finite(value)) missing.push(member.sym);
          else sum += value;
        }
        return { value: missing.length ? NaN : sum / usable.length, count: usable.length, missingSymbols: missing, symbols: usable.map((s) => s.sym) };
      }
      function prepare4h(raw, wanted) {
        if (!raw) return null;
        assert.equal(raw.intervalMs, FOUR, "Expected complete four-hour source");
        const result = /* @__PURE__ */ new Map();
        for (const s of raw.symbols) {
          if (!wanted.has(s.sym)) continue;
          const bars = /* @__PURE__ */ new Map();
          let previous = -Infinity;
          for (const b of s.bars) {
            const t = b[0];
            assert(Number.isSafeInteger(t) && t % FOUR === 0 && t > previous, "Invalid/duplicate4h clock");
            previous = t;
            assert(positive(b[4]), "Invalid four-hour close");
            if (s.deliveryTime > 0 && t + FOUR > s.deliveryTime) continue;
            bars.set(t, b[4]);
          }
          result.set(s.sym, bars);
        }
        return result;
      }
      function rsi4hAt(index, long, short, boundary) {
        const a = index?.get(long), b = index?.get(short), x = [];
        if (!a || !b) return { value: NaN, reason: "FOUR_HOUR_SYMBOL_UNAVAILABLE", lastCloseTime: null };
        for (let k = 15; k >= 1; k--) {
          const t = boundary - k * FOUR, aa = a.get(t), bb = b.get(t);
          if (!positive(aa) || !positive(bb)) return { value: NaN, reason: "FOUR_HOUR_MISSING_OR_UNCLOSED_BAR", lastCloseTime: null };
          x.push(Math.log(aa / bb));
        }
        return { value: cutlerRSI(x, 14), reason: null, lastCloseTime: boundary - 1 };
      }
      function buildFeatures(rawDaily, signalInput, rawFunding, raw4h = null, options = {}) {
        const data = E.prepareData(rawDaily), variant = options.variant || BASELINE;
        const signals = (Array.isArray(signalInput) ? signalInput : signalInput.signals || signalInput.rows).filter((s) => E.qualifies(s, variant));
        if (options.expectedCount != null) assert.equal(signals.length, options.expectedCount, "Strict original candidate count");
        assert.equal(new Set(signals.map((s) => s.id)).size, signals.length, "Duplicate candidate IDs");
        const funding = E.fundingIndex(rawFunding), wanted = new Set(signals.flatMap((s) => [s.long, s.short])), four = prepare4h(raw4h, wanted);
        const btc = data.bySymbol.get("BTCUSDT"), btcLog = btc ? Float64Array.from(btc.close, (c) => positive(c) ? Math.log(c) : NaN) : null;
        const btcRV = btcLog ? Float64Array.from(btcLog, (_, i) => realizedVol(btcLog, i, 20)) : null;
        const pairs = /* @__PURE__ */ new Map(), weekCache = /* @__PURE__ */ new Map(), altCache = /* @__PURE__ */ new Map(), rows = [], missingCounts = {};
        for (const s of signals) {
          const key = s.long + "/" + s.short;
          if (!pairs.has(key)) pairs.set(key, []);
          pairs.get(key).push(s);
        }
        const pairCache = /* @__PURE__ */ new Map();
        for (const [key, ss] of pairs) {
          const a = data.bySymbol.get(ss[0].long), b = data.bySymbol.get(ss[0].short);
          assert(a && b, "Unknown candidate symbol");
          const series = orientedSeries(a, b, data.n);
          Object.assign(series, rollingDaily(series.x));
          const snapshots = episodeSnapshots(series, a.volume, b.volume, new Set(ss.map((s) => s.day - data.day0)));
          pairCache.set(key, { a, b, series, snapshots });
        }
        for (const s of signals) {
          const i = s.day - data.day0, boundary = (s.day + 1) * DAY, signalTime = boundary - 1;
          assert.equal(s.signalTime, signalTime, "Candidate close timestamp");
          const { a, b, series, snapshots } = pairCache.get(s.long + "/" + s.short), { x, ll, ls, z, sd, p } = series;
          const snap = snapshots.get(i), ep = snap?.ep, features = {}, missingReasons = {};
          const put = (name, value, reason = "INCOMPLETE_OR_UNDEFINED_CAUSAL_LOOKBACK") => {
            if (finite(value)) {
              features[name] = value;
            } else {
              features[name] = null;
              missingReasons[name] = reason;
              missingCounts[name] = (missingCounts[name] || 0) + 1;
            }
          };
          const week = E.weekStart(s.day), wi = week - data.day0;
          if (!weekCache.has(week)) weekCache.set(week, weeklyMembers(data, week));
          if (!altCache.has(s.day)) altCache.set(s.day, altBasketReturn(data, weekCache.get(week), s.day));
          const alt = altCache.get(s.day), weekly = E._test.windowStats(x, p, wi - L, wi);
          const epMatches = ep && ep.start + data.day0 === s.episodeStartDay && ep.pre + data.day0 === s.preDipDay;
          assert(epMatches, "Canonical episode provenance mismatch for " + s.id);
          assert(finite(z[i]) && Math.abs(z[i] - s.entryZ) < 1e-7, "Recomputed z mismatch for " + s.id);
          const ratioSD = sd[i], rsi = cutlerRSI(x, i);
          put("zNow", z[i]);
          put("dz1", z[i] - z[i - 1]);
          put("zLow", ep.zLow);
          put("zExtreme20", s.zExtreme);
          put("daysSinceLow", s.daysSinceLow);
          put("bounceZ", z[i] - ep.zLow);
          put("bounceZ20", z[i] - s.zExtreme);
          put("fallDays", ep.zLowDay - ep.pre);
          put("fallSz", ep.high - ep.rawLow);
          put("df", weekly?.df);
          put("r2", weekly?.r2);
          put("sdW", weekly?.sd);
          put("liq", positive(s.minLiquidity) ? Math.log10(s.minLiquidity) : NaN);
          put("gap", s.gap);
          put("d3", ep.lastZ3 === null ? NaN : i - ep.lastZ3, "NO_Z_AT_OR_BELOW_MINUS_THREE_IN_ACTIVE_EPISODE");
          put("daysSinceEpisodeDeep", i - ep.lastDeep);
          put("oscDrift", s.osc?.drift);
          put("oscSw", s.osc?.sw);
          put("oscBoth", s.osc?.both);
          put("rsi14", rsi);
          put("rsiAtRawLow", ep.rsiAtRawLow);
          put("rsiGain", rsi - ep.rsiAtRawLow);
          for (const n of [5, 10, 20]) {
            put("ma" + n, (x[i] - mean(x, i - n + 1, i)) / ratioSD);
            put("brk" + n, (x[i] - extrema(x, i - n, i - 1, "max")) / ratioSD);
          }
          put("slope10", (mean(x, i - 9, i) - mean(x, i - 12, i - 3)) / ratioSD);
          put("retests", ep.retests);
          put("rawLowAge", i - ep.rawLowDay);
          put("episodeAge", i - ep.start);
          put("retestRecovered", ep.retests > 0 && ep.lastRetest >= ep.rawLowDay && ep.lastRetest < i && i - ep.rawLowDay >= 2 && x[i] > x[i - 1] ? 1 : 0);
          for (const n of [5, 20]) {
            put("rL" + n, logReturn(ll, i, n));
            put("rS" + n, logReturn(ls, i, n));
          }
          const dy = features.rL20 !== null && features.rS20 !== null ? features.rL20 - features.rS20 : NaN;
          put("drvS", dy < -0.01 ? Math.max(-3, Math.min(4, features.rS20 / -dy)) : NaN, "RATIO_20D_LOG_FALL_NOT_GREATER_THAN_0_01");
          put("shortOffPeak", ls[i] - ep.shortPeak);
          put("longOffTrough", ll[i] - ep.longTrough);
          put("vS", volumeLog(b.volume, i));
          put("vL", volumeLog(a.volume, i));
          put("vSminusVL", features.vS !== null && features.vL !== null ? features.vS - features.vL : NaN);
          const shortRecent = mean(b.volume, i - 2, i);
          put("shortVolumeFade", positive(shortRecent) && positive(ep.shortVolumeMax) ? Math.log(shortRecent / ep.shortVolumeMax) : NaN);
          const rv5 = realizedVol(x, i, 5), rv30 = realizedVol(x, i, 30);
          put("rvR", positive(rv5) && positive(rv30) ? Math.log(rv5 / rv30) : NaN, "INCOMPLETE_OR_ZERO_RATIO_REALIZED_VOLATILITY");
          const fundingStart = (s.day - 6) * DAY, fundingEnd = boundary - 1;
          const fundingOK = E.covered(funding, s.long, fundingStart, fundingEnd) && E.covered(funding, s.short, fundingStart, fundingEnd);
          for (const [field, symbol] of [["fL7", s.long], ["fS7", s.short]]) {
            const v = fundingOK ? E._test.fundingBetween(funding, symbol, fundingStart, fundingEnd).reduce((sum, e) => sum + e.rate, 0) / 7 : NaN;
            put(field, v, "INCOMPLETE_SEVEN_CALENDAR_DAY_FUNDING");
          }
          put("carry", fundingOK ? features.fS7 - features.fL7 : NaN, "INCOMPLETE_SEVEN_CALENDAR_DAY_FUNDING");
          put("btc20SimpleReturn", btc ? simpleReturn(btc.close, i, 20) : NaN, "BTC_MISSING_OR_INCOMPLETE_21_CLOSE_WINDOW");
          put("btc30SimpleReturn", btc ? simpleReturn(btc.close, i, 30) : NaN, "BTC_MISSING_OR_INCOMPLETE_31_CLOSE_WINDOW");
          put("absBTC30", features.btc30SimpleReturn === null ? NaN : Math.abs(features.btc30SimpleReturn));
          put("btcRV20", btcRV?.[i], "BTC_MISSING_OR_INCOMPLETE_20_RETURN_WINDOW");
          put("btcRVP80Prior365", btcRV && complete(btcRV, i - 365, i - 1) ? percentile(Array.from(btcRV.slice(i - 365, i)), 0.8) : NaN, "NEED_365_PRIOR_COMPLETE_20_RETURN_VOLATILITIES");
          const btcMA = btc ? mean(btc.close, i - 199, i) : NaN;
          put("btcAboveMA200", positive(btcMA) && positive(btc.close[i]) ? Number(btc.close[i] > btcMA) : NaN, "BTC_MISSING_OR_INCOMPLETE_200_CLOSE_WINDOW");
          const date = new Date(s.day * DAY), monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / DAY, anchor = monthStart - 1 - data.day0;
          const priorMA = btc ? mean(btc.close, anchor - 199, anchor) : NaN;
          put("btcAboveMA200MonthStart", positive(priorMA) && positive(btc.close[anchor]) ? Number(btc.close[anchor] > priorMA) : NaN, "BTC_MISSING_OR_INCOMPLETE_PREMONTH_200_CLOSE_WINDOW");
          put("altBasket30SimpleReturn", alt.value, "INCOMPLETE_CONTEMPORANEOUS_UNIVERSE_ALT_BASKET");
          put("prevN", snap.prevN);
          put("prevRev", snap.prevRev, "NO_FULLY_ENDED_PRIOR_EPISODE_WITH_START_OLDER_THAN_45_DAYS");
          const fourRSI = rsi4hAt(four, s.long, s.short, boundary);
          put("rsi4h14", fourRSI.value, fourRSI.reason || "FOUR_HOUR_RSI_UNAVAILABLE");
          rows.push({ id: s.id, day: s.day, long: s.long, short: s.short, signalTime, signalAvailableTime: boundary, featureAvailableTime: boundary, maxFeatureTimestamp: signalTime, features, missingReasons, context: { dailyZFormationStartDay: s.day - 180, dailyZFormationEndDay: s.day - 1, episodeStartDay: ep.start + data.day0, preDipDay: ep.pre + data.day0, rawLowDay: ep.rawLowDay + data.day0, episodeZLowDay: ep.zLowDay + data.day0, lastRetestDay: ep.lastRetest === null ? null : ep.lastRetest + data.day0, completedPriorEpisodes: snap.prior.map((h) => ({ startDay: h.start + data.day0, endDay: h.end + data.day0, crossedMean: h.rev })), weeklyDay: week, weeklyAvailableTime: week * DAY, altBasketMemberCount: alt.count, altBasketMembers: alt.symbols, altBasketMissingSymbols: alt.missingSymbols, btcMonthStartAnchorDay: monthStart - 1, rsi4hLastCloseTime: fourRSI.lastCloseTime, fundingStartTime: fundingStart, fundingEndTime: fundingEnd, fundingCoverageComplete: fundingOK } });
        }
        return { schemaVersion: "round6_features_v1", variant: { ...variant }, rows, summary: { strictCandidates: rows.length, orientedPairs: pairs.size, featureFields: rows[0] ? Object.keys(rows[0].features) : [], missingCounts, allTimestampsCausal: rows.every((r) => r.maxFeatureTimestamp < r.signalAvailableTime) }, method: "Closed daily observations; exact original strict signal IDs; no forward prices, outcomes, trade selection or optimization. All booleans encoded 1/0; nonfinite values become null with a field-specific reason." };
      }
      var hash = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
      if (__require.main === module) {
        const root = path.resolve("/project/research/refinement", "../../..");
        const sources = { daily: path.join(root, "research/refinement/round5_hybrid/data/daily_context_v5.json"), signals: path.join(root, "research/refinement/round3/data/event_signals.json"), funding: path.join(root, "research/refinement/round5_hybrid/funding/funding_v6.json"), fourHour: path.join(root, "research/refinement/round4_intraday/data/four_hour_universe_dataset_v2.json") };
        const output = path.join("/project/research/refinement", "data/features.json"), manifest = path.join("/project/research/refinement", "data/feature_build.json");
        assert(!fs.existsSync(output) && !fs.existsSync(manifest), "Refuse to overwrite feature artifacts");
        fs.mkdirSync(path.dirname(output), { recursive: true });
        const inputPaths = [...Object.values(sources), __filename, path.join("/project/research/refinement", "feature_tests.js"), path.join("/project/research/refinement", "coverage_inventory.json"), path.join("/project/research/refinement", "../round3/engine.js")];
        const inputs = inputPaths.map((p) => ({ path: path.relative(root, p), sha256: hash(p) }));
        const startedAt = (/* @__PURE__ */ new Date()).toISOString();
        fs.writeFileSync(manifest, JSON.stringify({ status: "INPUTS_FROZEN_BEFORE_FEATURE_GENERATION", startedAt, inputs }, null, 2) + "\n", { flag: "wx" });
        const values = Object.fromEntries(Object.entries(sources).map(([name, p]) => [name, JSON.parse(fs.readFileSync(p))]));
        const result = buildFeatures(values.daily, values.signals, values.funding, values.fourHour, { expectedCount: 176 });
        result.createdAt = (/* @__PURE__ */ new Date()).toISOString();
        result.inputs = inputs;
        for (const item of inputs) assert.equal(hash(path.join(root, item.path)), item.sha256, "Changed feature input");
        fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
        fs.writeFileSync(manifest, JSON.stringify({ status: "COMPLETE_DESCRIPTIVE_FEATURES_NO_PORTFOLIO_OUTCOMES", startedAt, completedAt: result.createdAt, inputs, output: { path: path.relative(root, output), sha256: hash(output) }, summary: result.summary }, null, 2) + "\n");
        console.log(JSON.stringify({ output, sha256: hash(output), ...result.summary }));
      }
      module.exports = { buildFeatures, BASELINE, DAY, FOUR, _test: { complete, mean, sampleSD, extrema, cutlerRSI, realizedVol, percentile, simpleReturn, logReturn, volumeLog, orientedSeries, rollingDaily, episodeSnapshots, weeklyMembers, altBasketReturn, prepare4h, rsi4hAt } };
    }
  });

  // research/scripts/scan34.js
  var require_scan34 = __commonJS({
    "research/scripts/scan34.js"(exports, module) {
      (function(root) {
        const E = root.PairCore || (typeof __require === "function" ? require_engine() : null);
        if (!E) throw Error("Frozen signal core unavailable");
        const positive = (x) => Number.isFinite(x) && x > 0;
        const strict = { family: "event", exitMode: "frozen_half", theta: 3, minFall: 0.5, minVS: 0, maxDrift: 0.7, minSw: 5, minThirds: 3, exitZFraction: 0.5, maxHold: 45 };
        function bounceFeature(data, s) {
          const A = data.bySymbol.get(s.long), B = data.bySymbol.get(s.short);
          if (!A || !B) return null;
          const x = new Float64Array(data.n).fill(NaN);
          for (let i = 0; i < data.n; i++) if (positive(A.close[i]) && positive(B.close[i])) x[i] = Math.log(A.close[i] / B.close[i]);
          const p = E._test.prefix(x), first = s.episodeStartDay - data.day0, last = s.day - data.day0;
          let low = Infinity, current = NaN;
          if (!Number.isInteger(first) || first < 180 || last < first || last >= data.n) return null;
          for (let i = first; i <= last; i++) {
            if (!Number.isFinite(x[i]) || p.valid[i] - p.valid[i - 180] !== 180) return null;
            const sum = p.x[i] - p.x[i - 180], ss = p.xx[i] - p.xx[i - 180], mu = sum / 180, sd = Math.sqrt(Math.max(0, (ss - sum * sum / 180) / 179));
            if (!(sd > 0)) return null;
            current = (x[i] - mu) / sd;
            low = Math.min(low, current);
          }
          return { bounceZ: current - low, episodeLowZ: low, currentZ: current };
        }
        function transform(data, rows, T) {
          const out = [], watch = [];
          for (const s of rows) {
            if (!E.qualifies(s, strict)) continue;
            const f = bounceFeature(data, s);
            if (!f) continue;
            const A = data.bySymbol.get(s.long), B = data.bySymbol.get(s.short), i = s.day - data.day0;
            const mapped = { ...s, a: s.long, b: s.short, dir: 1, daysAgo: T - s.day, zExt: s.zExtreme, extAgo: s.daysSinceLow, mu: s.mu, xEntry: Math.log(A.close[i] / B.close[i]), xNow: Math.log(A.close[T - data.day0] / B.close[T - data.day0]), zNow: s.entryZ, liqMin: s.minLiquidity, vS: s.volumeLogRatio, rankA: s.rankLong, rankB: s.rankShort, bounceZ: f.bounceZ, episodeLowZ: f.episodeLowZ, priorityGap: s.gap, fixedTargetLog: s.mu + 0.5 * s.entryZ * s.sd, hl: NaN, osc: s.osc ? { ...s.osc, d0: s.oscillatorStartDay, d1: s.preDipDay } : null };
            if (f.bounceZ >= 1) out.push(mapped);
            else if (s.day === T) watch.push({ ...mapped, zNow: s.entryZ, watchReason: "Original bounce edge occurred, but episode rebound is below1z. A new eligible daily edge is required; no delayed retry." });
          }
          return { signals: out, watch };
        }
        function scanDataset(raw, T, rule = {}) {
          if (!Number.isInteger(T) || T < raw.startDay + 365 || T > raw.endDay) throw Error("Invalid closed-day scan boundary");
          const data = E.prepareData(raw), r = E.signals(data, { startDay: rule.startDay ?? T, endDay: T, thetas: [3], onProgress: rule.onProgress });
          const mapped = transform(data, r.rows, T), w = E.weekStart(T), uni = r.universes.find((x) => x.day === w);
          return { ...mapped, W: w, universe: (uni?.members || []).filter((x) => T - x.listDay >= 365).map((x) => x.sym), pairsTested: r.diagnostics.pairWeeks, pairsGated: r.diagnostics.gatedPairWeeks, rawRows: r.rows.length, sourceStartDay: data.day0, sourceEndDay: T, diagnostics: r.diagnostics };
        }
        root.PairScan34 = { scanDataset, bounceFeature, transform, strict };
        if (typeof module !== "undefined" && module.exports) module.exports = root.PairScan34;
      })(typeof window !== "undefined" ? window : globalThis);
    }
  });

  // research/refinement/engine.js
  var require_engine3 = __commonJS({
    "research/refinement/engine.js"(exports, module) {
      "use strict";
      var DAY = 864e5;
      var WEEK0 = Math.round(Date.UTC(2022, 11, 13) / DAY);
      var EXCLUDED = new Set(["USDC", "FDUSD", "USDE", "USDP", "TUSD", "DAI", "PAXG", "XAUT", "BTCDOM", "DEFI", "FOOTBALL", "BLUEBIRD"].map((s) => s + "USDT"));
      var positive = (v) => Number.isFinite(v) && v > 0;
      var iso = (t) => new Date(t).toISOString();
      var weekStart = (d) => WEEK0 + 7 * Math.floor((d - WEEK0) / 7);
      var assert = (test, message) => {
        if (!test) throw new Error(message);
      };
      function prepareData(raw) {
        if (raw && raw.__prepared) return raw;
        assert(raw && Array.isArray(raw.symbols || raw.tokens), "Dataset requires symbols array");
        const rows = raw.symbols || raw.tokens;
        const day0 = raw.startDay ?? raw.day0;
        const day1 = raw.endDay ?? raw.day1;
        assert(Number.isInteger(day0) && Number.isInteger(day1) && day1 >= day0, "Dataset needs integer UTC startDay/endDay");
        const n = day1 - day0 + 1, tokens = [], bySymbol = /* @__PURE__ */ new Map();
        const omitted = [];
        for (const row of rows) {
          assert(typeof row.sym === "string" && !bySymbol.has(row.sym), "Missing/duplicate symbol");
          if (!Number.isInteger(row.listDay) && !(row.bars?.length || row.closes?.length)) {
            omitted.push({ symbol: row.sym, reason: "NO_LISTING_DATE_OR_PRICE_HISTORY" });
            continue;
          }
          assert(Number.isInteger(row.listDay), `Unknown listing day: ${row.sym}`);
          const k = { ...row, open: new Float64Array(n).fill(NaN), exitOnlyOpen: new Float64Array(n).fill(NaN), high: new Float64Array(n).fill(NaN), low: new Float64Array(n).fill(NaN), close: new Float64Array(n).fill(NaN), volume: new Float64Array(n).fill(NaN) };
          const bars = row.bars || (row.closes || []).map((c, i) => [row.day0 + i, row.open?.[i], row.high?.[i], row.low?.[i], c, row.qv?.[i]]);
          const seen = /* @__PURE__ */ new Set();
          for (const b of bars) {
            const d = b[0], i = d - day0;
            assert(Number.isInteger(d) && !seen.has(d), `Invalid/duplicate candle: ${row.sym}`);
            seen.add(d);
            if (i < 0 || i >= n) continue;
            assert(b.slice(1, 5).every(positive) && Number.isFinite(b[5]) && b[5] >= 0, `Invalid OHLC/volume: ${row.sym} ${d}`);
            assert(b[2] >= Math.max(b[1], b[4]) && b[3] <= Math.min(b[1], b[4]) && b[2] >= b[3], `Inconsistent OHLC: ${row.sym} ${d}`);
            k.open[i] = b[1];
            k.high[i] = b[2];
            k.low[i] = b[3];
            k.close[i] = b[4];
            k.volume[i] = b[5];
          }
          const terminalDays = /* @__PURE__ */ new Set();
          for (const terminal of row.terminalOpens || []) {
            const d = terminal.day, i = d - day0;
            assert(Number.isInteger(d) && !terminalDays.has(d), `Invalid/duplicate terminal day: ${row.sym}`);
            terminalDays.add(d);
            assert(terminal.openTimestamp === d * DAY && Number.isSafeInteger(terminal.deliveryTimestamp) && terminal.openTimestamp + 1e3 < terminal.deliveryTimestamp && positive(terminal.openPrice), `Invalid terminal open or pre-delivery fill ordering: ${row.sym}`);
            if (i < 0 || i >= n) continue;
            if (positive(k.open[i])) assert(Math.abs(k.open[i] - terminal.openPrice) < 1e-10 * Math.max(1, k.open[i]), `Conflicting terminal and full-candle open: ${row.sym}`);
            k.exitOnlyOpen[i] = terminal.openPrice;
          }
          k.volumeSum = new Float64Array(n + 1);
          k.validSum = new Int32Array(n + 1);
          for (let i = 0; i < n; i++) {
            k.volumeSum[i + 1] = k.volumeSum[i] + (Number.isFinite(k.volume[i]) ? k.volume[i] : 0);
            k.validSum[i + 1] = k.validSum[i] + (positive(k.close[i]) ? 1 : 0);
          }
          tokens.push(k);
          bySymbol.set(k.sym, k);
        }
        tokens.sort((a, b) => a.sym.localeCompare(b.sym));
        return { __prepared: true, day0, day1, n, tokens, bySymbol, metadata: { ...raw.metadata || raw.quality || {}, omittedSymbols: omitted }, source: { asOf: raw.asOf, universe: raw.universe, coverage: raw.coverage, provenance: raw.provenance } };
      }
      function prefix(x) {
        const n = x.length, p = { x: new Float64Array(n + 1), xx: new Float64Array(n + 1), tx: new Float64Array(n + 1), valid: new Int32Array(n + 1), dy2: new Float64Array(n + 1), zdy: new Float64Array(n + 1) };
        for (let i = 0; i < n; i++) {
          const valid = Number.isFinite(x[i]), v = valid ? x[i] : 0;
          p.x[i + 1] = p.x[i] + v;
          p.xx[i + 1] = p.xx[i] + v * v;
          p.tx[i + 1] = p.tx[i] + i * v;
          p.valid[i + 1] = p.valid[i] + Number(valid);
          const dy = i && valid && Number.isFinite(x[i - 1]) ? x[i] - x[i - 1] : 0;
          p.dy2[i + 1] = p.dy2[i] + dy * dy;
          p.zdy[i + 1] = p.zdy[i] + (i && Number.isFinite(x[i - 1]) ? x[i - 1] * dy : 0);
        }
        return p;
      }
      function windowStats(x, p, a, b) {
        const n = b - a;
        if (a < 0 || b > x.length || n < 4 || p.valid[b] - p.valid[a] !== n) return null;
        const sum = (k, l = a, r = b) => p[k][r] - p[k][l], sx = sum("x"), mu = sx / n;
        const ss = Math.max(0, sum("xx") - sx * sx / n), sd = Math.sqrt(ss / (n - 1));
        if (!(sd > 0)) return null;
        const m = n - 1, sz = sum("x", a, b - 1), sy = x[b - 1] - x[a];
        const szz = Math.max(0, sum("xx", a, b - 1) - sz * sz / m);
        const szy = sum("zdy", a + 1, b) - sz * sy / m, syy = Math.max(0, sum("dy2", a + 1, b) - sy * sy / m);
        const beta = szz > 0 ? szy / szz : NaN, rss = Math.max(1e-30, syy - beta * szy), se = Math.sqrt(rss / (m - 2) / szz);
        const cov = sum("tx") - (a + (n - 1) / 2) * sx, tt = n * (n * n - 1) / 12;
        return { mu, sd, df: beta / se, r2: cov * cov / (tt * ss), drift: Math.abs(cov / tt * (n - 1)) / sd };
      }
      function oscillator(x, p, a, b) {
        const st = windowStats(x, p, a, b);
        if (!st) return null;
        let state = 0, sw = 0, both = 0;
        for (let i = a; i < b; i++) {
          if (x[i] >= st.mu + st.sd) {
            if (state === -1) sw++;
            state = 1;
          } else if (x[i] <= st.mu - st.sd) {
            if (state === 1) sw++;
            state = -1;
          }
        }
        for (let k = 0; k < 3; k++) {
          let low = Infinity, high = -Infinity;
          for (let i = a + Math.floor(k * (b - a) / 3); i < a + Math.floor((k + 1) * (b - a) / 3); i++) {
            low = Math.min(low, x[i]);
            high = Math.max(high, x[i]);
          }
          if (high >= st.mu + 0.8 * st.sd && low <= st.mu - 0.8 * st.sd) both++;
        }
        return { drift: st.drift, sw, both, sd: st.sd };
      }
      function gate(st, c) {
        return !!st && st.sd >= c.minSD && st.sd <= c.maxSD && st.df <= c.maxDF && st.r2 < c.maxR2;
      }
      function weeklyUniverses(data, c) {
        const weeks = /* @__PURE__ */ new Map(), pairs = /* @__PURE__ */ new Map();
        for (let w = weekStart(c.startDay) - 7; w <= c.endDay; w += 7) {
          const wi = w - data.day0, ranked = [];
          for (const k of data.tokens) {
            if (EXCLUDED.has(k.sym) || k.excludedByControl || k.listDay > w - c.minHist || wi < 30 || wi > data.n || k.validSum[wi] - k.validSum[wi - 30] !== 30) continue;
            ranked.push({ sym: k.sym, liq: (k.volumeSum[wi] - k.volumeSum[wi - 30]) / 30, listDay: k.listDay });
          }
          ranked.sort((a, b) => b.liq - a.liq || a.sym.localeCompare(b.sym));
          const members = ranked.slice(0, c.topK).map((k, i) => ({ ...k, rank: i + 1 }));
          const ranks = new Map(members.map((k) => [k.sym, k]));
          weeks.set(w, { day: w, members, ranks, candidateCount: ranked.length });
          for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
            const a = members[i], b = members[j];
            if (Math.max(a.listDay, b.listDay) + c.minAge > w + 6) continue;
            const syms = [a.sym, b.sym].sort(), key = syms.join("|");
            if (!pairs.has(key)) pairs.set(key, { a: syms[0], b: syms[1], weeks: [] });
            pairs.get(key).weeks.push(w);
          }
        }
        return { weeks, pairs };
      }
      function signals(input, config = {}) {
        const data = prepareData(input);
        const c = { L: 180, minAge: 365, minHist: 95, topK: 150, minSD: 0.03, maxSD: 0.6, maxDF: -2.86, maxR2: 0.5, episodeStartZ: -2, thetas: [2, 3], bounceZ: 0.75, minDaysSinceLow: 2, maxEntryZ: -1, startDay: data.day0 + 365, endDay: data.day1, ...config };
        assert(c.L === 180, "This registered reconstruction requires L=180");
        const { weeks, pairs } = weeklyUniverses(data, c), rows = [];
        const diag = { pairs: pairs.size, pairWeeks: 0, gatedPairWeeks: 0, bounceRows: 0, missingOscillatorRows: 0 };
        for (const pair of pairs.values()) {
          const A = data.bySymbol.get(pair.a), B = data.bySymbol.get(pair.b), x = new Float64Array(data.n).fill(NaN);
          for (let i = 0; i < data.n; i++) if (positive(A.close[i]) && positive(B.close[i])) x[i] = Math.log(A.close[i] / B.close[i]);
          const p = prefix(x), z = new Float64Array(data.n).fill(NaN), sd = new Float64Array(data.n).fill(NaN), mu = new Float64Array(data.n).fill(NaN);
          for (let i = c.L; i < data.n; i++) if (Number.isFinite(x[i]) && p.valid[i] - p.valid[i - c.L] === c.L) {
            const sum = p.x[i] - p.x[i - c.L], ss = p.xx[i] - p.xx[i - c.L];
            mu[i] = sum / c.L;
            sd[i] = Math.sqrt(Math.max(0, (ss - sum * sum / c.L) / (c.L - 1)));
            if (sd[i] > 0) z[i] = (x[i] - mu[i]) / sd[i];
          }
          const gates = /* @__PURE__ */ new Map();
          for (const w of pair.weeks) {
            const st = windowStats(x, p, w - data.day0 - c.L, w - data.day0);
            diag.pairWeeks++;
            if (gate(st, c)) {
              gates.set(w, st);
              diag.gatedPairWeeks++;
            }
          }
          if (!gates.size) continue;
          for (const dir of [1, -1]) {
            let ep = null, previousEligible = false, lastFinite = -1;
            const deque = [];
            let head = 0, prevCond = c.thetas.map(() => false);
            for (let i = c.L; i < data.n; i++) {
              const d = data.day0 + i, zz = dir * z[i];
              if (!Number.isFinite(zz)) {
                ep = null;
                deque.length = 0;
                head = 0;
                previousEligible = false;
                prevCond.fill(false);
                lastFinite = -1;
                continue;
              }
              if (lastFinite < 0) lastFinite = i;
              if (!ep && zz <= c.episodeStartZ) {
                let f = i;
                for (let j = i - 1; j >= Math.max(c.L, i - 120); j--) {
                  if (!Number.isFinite(z[j])) break;
                  f = j;
                  if (dir * z[j] > -1) break;
                }
                let high = -Infinity;
                for (let j = f; j <= i; j++) high = Math.max(high, dir * x[j]);
                ep = { start: i, lastDeep: i, pre: f, high, low: dir * x[i], osc: void 0 };
              } else if (ep) {
                if (zz <= c.episodeStartZ) ep.lastDeep = i;
                ep.low = Math.min(ep.low, dir * x[i]);
              }
              while (head < deque.length && deque[head] < i - 19) head++;
              while (deque.length > head && dir * z[deque[deque.length - 1]] > zz) deque.pop();
              deque.push(i);
              const e = deque[head], min = dir * z[e], extreme = zz === min ? i : e;
              const base = i - lastFinite >= 20 && i - extreme >= c.minDaysSinceLow && zz >= min + c.bounceZ && zz <= c.maxEntryZ && zz > dir * z[i - 1];
              const cond = c.thetas.map((theta) => base && min <= -theta);
              const w = weekStart(d), st = gates.get(w), eligible = d - A.listDay >= c.minAge && d - B.listDay >= c.minAge && !!st;
              const triggers = c.thetas.filter((_, j) => d >= c.startDay && d <= c.endDay && eligible && cond[j] && !(previousEligible && prevCond[j]));
              if (triggers.length && ep) {
                if (ep.osc === void 0) ep.osc = oscillator(x, p, ep.pre - c.L, ep.pre);
                const S = dir === 1 ? B : A, L = dir === 1 ? A : B;
                let vs = NaN;
                if (i >= 32 && S.validSum[i + 1] - S.validSum[i - 32] === 33) {
                  const recent = (S.volumeSum[i + 1] - S.volumeSum[i - 2]) / 3, prior = (S.volumeSum[i - 2] - S.volumeSum[i - 32]) / 30;
                  if (recent > 0 && prior > 0) vs = Math.log(recent / prior);
                }
                const ranks = weeks.get(w).ranks;
                rows.push({ id: `${d}:${L.sym}/${S.sym}`, day: d, date: iso(d * DAY).slice(0, 10), signalTime: (d + 1) * DAY - 1, long: L.sym, short: S.sym, entryZ: zz, zEntry: zz, zExtreme: min, daysSinceLow: i - extreme, triggerByTheta: Object.fromEntries(c.thetas.map((t) => [t, triggers.includes(t)])), fall: ep.high - ep.low, volumeLogRatio: vs, minVS: vs, vS: vs, osc: ep.osc, gap: Math.expm1(-zz * sd[i]), mu: dir * mu[i], sd: sd[i], df: st.df, r2: st.r2, weeklyDay: w, rankLong: ranks.get(L.sym).rank, rankShort: ranks.get(S.sym).rank, minLiquidity: Math.min(ranks.get(L.sym).liq, ranks.get(S.sym).liq), episodeStartDay: data.day0 + ep.start, preDipDay: data.day0 + ep.pre, oscillatorStartDay: data.day0 + ep.pre - c.L, shortReturnFromPreDip: S.close[i] / S.close[ep.pre] - 1, longReturnFromPreDip: L.close[i] / L.close[ep.pre] - 1 });
                diag.bounceRows++;
                if (!ep.osc) diag.missingOscillatorRows++;
              }
              if (ep && (zz >= 0 && i - ep.lastDeep > 20 || i - ep.lastDeep > 40 || i - ep.start > 120)) ep = null;
              previousEligible = eligible;
              prevCond = cond;
            }
          }
          if (config.onProgress && diag.pairWeeks % 1e3 < 10) config.onProgress({ ...diag });
        }
        rows.sort((a, b) => a.day - b.day || b.gap - a.gap || a.id.localeCompare(b.id));
        return { rows, config: { ...c, onProgress: void 0 }, diagnostics: diag, universes: [...weeks.values()].map((w) => ({ day: w.day, candidateCount: w.candidateCount, members: w.members })), dataQuality: data.metadata };
      }
      function qualifies(s, v) {
        return !!s.triggerByTheta?.[v.theta ?? 3] && Number.isFinite(s.fall) && s.fall >= (v.minFall ?? 0.5) && s.osc && s.osc.drift <= (v.maxDrift ?? 0.7) && s.osc.sw >= (v.minSw ?? 5) && s.osc.both >= (v.minThirds ?? 3) && (v.minVS === null || Number.isFinite(s.volumeLogRatio) && s.volumeLogRatio >= (v.minVS ?? 0));
      }
      function fundingIndex(raw) {
        if (raw?.__indexedFunding) return raw;
        const source = raw?.symbols || raw || {}, bySymbol = /* @__PURE__ */ new Map();
        for (const [name, sourceRow] of Array.isArray(source) ? source.map((x) => [x.sym || x.symbol, x]) : Object.entries(source)) {
          if (!sourceRow || typeof sourceRow !== "object") continue;
          const row = Array.isArray(sourceRow) ? { events: sourceRow } : sourceRow;
          const events = (row.events || []).map((e) => ({ ...e, timestamp: Number(e.timestamp ?? e.fundingTime), rate: Number(e.rate ?? e.fundingRate), markPrice: Number(e.markPrice) })).sort((a, b) => a.timestamp - b.timestamp);
          let previous = -Infinity;
          for (const e of events) {
            assert(Number.isSafeInteger(e.timestamp) && Number.isFinite(e.rate), `Invalid funding event timestamp/rate ${name}`);
            assert(e.timestamp > previous, `Duplicate funding event ${name}`);
            previous = e.timestamp;
          }
          const intervals = row.intervals || row.coverageIntervals || row.coverage || [{ start: row.coverageStart, end: row.coverageEnd, complete: row.complete }];
          bySymbol.set(name, { ...row, events, intervals: intervals.map((r) => ({ start: Number(r.start ?? r.startTime ?? r.coverageStart), end: Number(r.end ?? r.endTime ?? r.coverageEnd), complete: r.complete ?? (r.status === "retrieved" ? true : row.complete) })), gaps: row.gaps || [] });
        }
        return { __indexedFunding: true, bySymbol, metadata: { source: raw?.source, counts: raw?.counts, coverageInterpretation: raw?.coverage_interpretation, ...raw?.metadata || {} } };
      }
      function covered(f, s, a, b) {
        const r = f.bySymbol.get(s);
        if (!r) return false;
        if (r.gaps.some((g) => Number(g.start ?? g.startTime ?? g[0]) <= b && Number(g.end ?? g.endTime ?? g[1]) >= a)) return false;
        let reached = a;
        for (const i of [...r.intervals].filter((i2) => i2.complete === true).sort((x, y) => x.start - y.start)) {
          if (i.end < reached) continue;
          if (i.start > reached) return false;
          reached = Math.max(reached, i.end + 1);
          if (reached > b) return true;
        }
        return false;
      }
      function lowerBound(events, t) {
        let lo = 0, hi = events.length;
        while (lo < hi) {
          const m = lo + hi >> 1;
          if (events[m].timestamp < t) lo = m + 1;
          else hi = m;
        }
        return lo;
      }
      function fundingBetween(f, s, a, b) {
        const events = f.bySymbol.get(s)?.events || [], out = [];
        for (let i = lowerBound(events, a); i < events.length && events[i].timestamp <= b; i++) out.push(events[i]);
        return out;
      }
      function carryAt(f, s) {
        const a = (s.day - 6) * DAY, b = (s.day + 1) * DAY - 1;
        if (!covered(f, s.long, a, b) || !covered(f, s.short, a, b)) return null;
        const sum = (sym) => fundingBetween(f, sym, a, b).reduce((n, e) => n + e.rate, 0);
        return (sum(s.short) - sum(s.long)) / 7;
      }
      function simulate(input, signalInput, variant, fundingRaw, costs = {}, options = {}) {
        const data = prepareData(input), funding = fundingIndex(fundingRaw), allSignals = Array.isArray(signalInput) ? signalInput : signalInput.rows || signalInput.signals;
        const startDay = options.startDay ?? data.day0 + 365, endDay = options.endDay ?? data.day1, entryEndDay = options.entryEndDay ?? endDay;
        assert(Number.isInteger(startDay) && Number.isInteger(endDay) && startDay >= data.day0 && endDay <= data.day1 && endDay >= startDay, "Invalid simulation range");
        const startingEquity = options.startingEquity ?? 1e4, slots = options.slots ?? 5, exposure = options.grossExposure ?? options.leverage ?? variant.grossExposure ?? variant.leverage ?? 1;
        const feeRate = (costs.feeBpsPerFill ?? 5) / 1e4, slippage = (costs.slippageBpsPerFill ?? 5) / 1e4;
        assert(startingEquity > 0 && slots > 0 && exposure >= 0 && feeRate >= 0 && slippage >= 0 && slippage < 1, "Invalid capital/exposure/cost assumption");
        const byDay = /* @__PURE__ */ new Map(), rejections = [], blockers = [], trades = [], valuations = [], fills = [], fundingCashflows = [], open = [];
        for (const s of allSignals) if (qualifies(s, variant) && s.day >= startDay - 1 && s.day + 1 <= Math.min(endDay, entryEndDay)) {
          if (!byDay.has(s.day + 1)) byDay.set(s.day + 1, []);
          byDay.get(s.day + 1).push(s);
        }
        for (const a of byDay.values()) a.sort((x, y) => y.gap - x.gap || x.id.localeCompare(y.id));
        let cash = startingEquity, totalFees = 0, totalFunding = 0, totalSlippage = 0, realizedPnl = 0, invalid = false, proxyFundingEvents = 0, proxyFundingCash = 0, fundingLowerAdjustment = 0, fundingUpperAdjustment = 0;
        const price = (sym, d, kind) => data.bySymbol.get(sym)?.[kind]?.[d - data.day0];
        const exitPrice = (sym, d) => positive(price(sym, d, "open")) ? price(sym, d, "open") : price(sym, d, "exitOnlyOpen");
        const pnlAt = (p, d, kind) => p.longQty * (price(p.long, d, kind) - p.longEntry) + p.shortQty * (p.shortEntry - price(p.short, d, kind));
        const grossAt = (p, d, kind) => p.longQty * price(p.long, d, kind) + p.shortQty * price(p.short, d, kind);
        const block = (code, day, extra = {}) => {
          blockers.push({ code, day, ...extra });
          invalid = true;
        };
        const currentEquity = (d, kind) => cash + open.reduce((n, p) => n + pnlAt(p, d, kind), 0);
        const fill = (p, sym, side, qty, reference, timestamp, stage, referenceSource = "complete_daily_trade_open") => {
          const actual = reference * (side === "buy" ? 1 + slippage : 1 - slippage), fee = qty * actual * feeRate, impact = qty * Math.abs(actual - reference);
          totalFees += fee;
          totalSlippage += impact;
          p.fees += fee;
          p.slippageCost += impact;
          cash -= fee;
          fills.push({ id: `${p.id}:${stage}:${sym}`, tradeId: p.id, timestamp, symbol: sym, side, quantity: qty, referencePrice: reference, referenceSource, price: actual, fee });
          return actual;
        };
        const settle = (p, a, b) => {
          for (const [sym, qty] of [[p.long, p.longQty], [p.short, -p.shortQty]]) for (const e of fundingBetween(funding, sym, a, b)) {
            const amount = -qty * e.markPrice * e.rate;
            cash += amount;
            p.funding += amount;
            totalFunding += amount;
            let lowAmount = amount, highAmount = amount;
            if (e.markPriceSource === "hour_open_proxy") {
              proxyFundingEvents++;
              proxyFundingCash += amount;
              if (positive(Number(e.markLow)) && positive(Number(e.markHigh))) {
                const a2 = -qty * Number(e.markLow) * e.rate, b2 = -qty * Number(e.markHigh) * e.rate;
                lowAmount = Math.min(a2, b2);
                highAmount = Math.max(a2, b2);
                fundingLowerAdjustment += lowAmount - amount;
                fundingUpperAdjustment += highAmount - amount;
              }
            }
            fundingCashflows.push({ tradeId: p.id, symbol: sym, ...e, quantity: qty, amount, lowAmount, highAmount });
          }
        };
        valuations.push({ timestamp: startDay * DAY, observationTimestamp: startDay * DAY, equity: startingEquity, cash, openCount: 0, grossNotional: 0, totalFees: 0, totalFunding: 0, unrealizedPnl: 0 });
        for (let d = startDay; d <= endDay; d++) {
          const t = d * DAY, fillTime = t + 1e3, closeTime = (d + 1) * DAY - 1;
          for (const p of open) {
            const heldEnd = p.pendingExit ? fillTime : closeTime;
            for (const sym of [p.long, p.short]) {
              if (!positive(p.pendingExit ? exitPrice(sym, d) : price(sym, d, "open")) || !p.pendingExit && !positive(price(sym, d, "close"))) block("MISSING_HELD_PRICE", d, { tradeId: p.id, symbol: sym });
              if (!covered(funding, sym, t, heldEnd)) block("MISSING_HELD_FUNDING_COVERAGE", d, { tradeId: p.id, symbol: sym });
              if (fundingBetween(funding, sym, fillTime, fillTime).length) block("AMBIGUOUS_FUNDING_FILL_TIMESTAMP", d, { tradeId: p.id, symbol: sym });
              for (const e of fundingBetween(funding, sym, t, heldEnd)) if (!positive(e.markPrice)) block("MISSING_HELD_FUNDING_MARK", d, { tradeId: p.id, symbol: sym, timestamp: e.timestamp });
            }
          }
          if (invalid) break;
          for (const p of open) settle(p, t, fillTime - 1);
          for (let i = open.length - 1; i >= 0; i--) {
            const p = open[i];
            if (!p.pendingExit) continue;
            p.longExit = fill(p, p.long, "sell", p.longQty, exitPrice(p.long, d), fillTime, "exit", positive(price(p.long, d, "open")) ? "complete_daily_trade_open" : "verified_partial_delivery_day_open");
            p.shortExit = fill(p, p.short, "buy", p.shortQty, exitPrice(p.short, d), fillTime, "exit", positive(price(p.short, d, "open")) ? "complete_daily_trade_open" : "verified_partial_delivery_day_open");
            p.grossPnl = p.longQty * (p.longExit - p.longEntry) + p.shortQty * (p.shortEntry - p.shortExit);
            cash += p.grossPnl;
            realizedPnl += p.grossPnl;
            p.exitTime = fillTime;
            p.exitDay = d;
            p.exitReason = p.pendingExit.reason;
            p.exitSignalDay = p.pendingExit.day;
            p.netPnl = p.grossPnl + p.funding - p.fees;
            p.returnOnEntryLeg = p.netPnl / p.entryLegNotional;
            p.returnOnEntryGross = p.netPnl / (2 * p.entryLegNotional);
            p.holdDays = (p.exitTime - p.entryTime) / DAY;
            p.pendingExit = null;
            p.status = "closed";
            open.splice(i, 1);
          }
          const occupied = new Set(open.flatMap((p) => [p.long, p.short]));
          for (const s of byDay.get(d) || []) {
            if (open.length >= slots) {
              rejections.push({ id: s.id, day: d, reason: "SLOTS_OCCUPIED" });
              continue;
            }
            if (occupied.has(s.long) || occupied.has(s.short)) {
              rejections.push({ id: s.id, day: d, reason: "TOKEN_OCCUPIED" });
              continue;
            }
            const carry = carryAt(funding, s);
            if (carry === null) {
              rejections.push({ id: s.id, day: d, reason: "MISSING_ENTRY_FUNDING_COVERAGE" });
              continue;
            }
            if (!(carry > (variant.minCarry ?? -5e-3))) {
              rejections.push({ id: s.id, day: d, reason: "CARRY_FILTER", carry });
              continue;
            }
            if (!positive(price(s.long, d, "open")) || !positive(price(s.short, d, "open"))) {
              rejections.push({ id: s.id, day: d, reason: "MISSING_ENTRY_PRICE" });
              continue;
            }
            const equity = currentEquity(d, "open");
            if (!(equity > 0)) {
              rejections.push({ id: s.id, day: d, reason: "NONPOSITIVE_EQUITY" });
              continue;
            }
            const notional = equity * exposure / (2 * slots);
            if (!(notional > 0)) continue;
            const existingGross = open.reduce((n, p2) => n + grossAt(p2, d, "open"), 0);
            if (existingGross + 2 * notional > equity * exposure + 1e-8) {
              rejections.push({ id: s.id, day: d, reason: "OVER_GROSS_BUDGET", existingGross, newGross: 2 * notional, budget: equity * exposure });
              continue;
            }
            const longEntry = price(s.long, d, "open") * (1 + slippage), shortEntry = price(s.short, d, "open") * (1 - slippage);
            const p = { id: `${variant.id || "variant"}:${s.id}`, signalId: s.id, signalDay: s.day, signalTime: (s.day + 1) * DAY, signalAvailableTime: (s.day + 1) * DAY, candleCloseTime: s.signalTime ?? (s.day + 1) * DAY - 1, long: s.long, short: s.short, entryDay: d, entryTime: fillTime, exitTime: null, status: "open", entryZ: s.entryZ ?? s.zEntry, entryLegNotional: notional, entryGrossNotional: 2 * notional, entryAccountEquity: equity, longQty: notional / longEntry, shortQty: notional / shortEntry, longEntry, shortEntry, fees: 0, funding: 0, slippageCost: 0, grossPnl: null, netPnl: null, carryAtEntry: carry, episodeStartDay: s.episodeStartDay, preDipDay: s.preDipDay, variantId: variant.id, pendingExit: null };
            p.longEntry = fill(p, p.long, "buy", p.longQty, price(p.long, d, "open"), fillTime, "entry");
            p.shortEntry = fill(p, p.short, "sell", p.shortQty, price(p.short, d, "open"), fillTime, "entry");
            open.push(p);
            trades.push(p);
            occupied.add(p.long);
            occupied.add(p.short);
          }
          for (const p of open) {
            for (const sym of [p.long, p.short]) {
              if (!positive(price(sym, d, "close"))) block("MISSING_HELD_CLOSE", d, { tradeId: p.id, symbol: sym });
              if (!covered(funding, sym, fillTime + 1, closeTime)) block("MISSING_HELD_FUNDING_COVERAGE", d, { tradeId: p.id, symbol: sym });
              if (fundingBetween(funding, sym, fillTime, fillTime).length) block("AMBIGUOUS_FUNDING_FILL_TIMESTAMP", d, { tradeId: p.id, symbol: sym });
              for (const e of fundingBetween(funding, sym, fillTime + 1, closeTime)) if (!positive(e.markPrice)) block("MISSING_HELD_FUNDING_MARK", d, { tradeId: p.id, symbol: sym, timestamp: e.timestamp });
            }
          }
          if (invalid) break;
          for (const p of open) {
            settle(p, fillTime + 1, closeTime);
            const profit = pnlAt(p, d, "close");
            const z = exitZ(data, p.long, p.short, d, 180), age = d - p.entryDay + 1;
            let reason = null;
            if (variant.pairStop != null && profit / p.entryLegNotional <= -variant.pairStop) reason = "pair_stop";
            else if (Number.isFinite(z) && z >= (variant.exitZFraction ?? 0.5) * p.entryZ) reason = "rolling_z";
            else if (age >= (variant.maxHold ?? 45)) reason = "time";
            if (reason) p.pendingExit = { day: d, reason };
            p.markedGrossPnl = profit;
            p.markedNetPnl = profit + p.funding - p.fees;
            p.lastMarkTime = closeTime;
          }
          const unrealizedPnl = open.reduce((n, p) => n + pnlAt(p, d, "close"), 0), grossNotional = open.reduce((n, p) => n + grossAt(p, d, "close"), 0);
          const positions = open.map((p) => ({ tradeId: p.id, long: p.long, short: p.short, longNotional: p.longQty * price(p.long, d, "close"), shortNotional: p.shortQty * price(p.short, d, "close"), unrealizedPnl: pnlAt(p, d, "close") }));
          const longNotional = positions.reduce((n, p) => n + p.longNotional, 0), shortNotional = positions.reduce((n, p) => n + p.shortNotional, 0);
          valuations.push({ timestamp: (d + 1) * DAY, observationTimestamp: closeTime, day: d, equity: cash + unrealizedPnl, cash, openCount: open.length, grossNotional, longNotional, shortNotional, netNotional: longNotional - shortNotional, positions, totalFees, totalFunding, totalSlippage, realizedPnl, unrealizedPnl, fundingLowerAdjustment, fundingUpperAdjustment });
        }
        const final = valuations[valuations.length - 1];
        for (const p of open) {
          p.status = "open_at_sample_end";
          p.netPnl = null;
          p.grossPnl = null;
        }
        let peak = startingEquity, maxDrawdown = 0, minEquity = startingEquity;
        for (const v of valuations) {
          peak = Math.max(peak, v.equity);
          minEquity = Math.min(minEquity, v.equity);
          maxDrawdown = Math.max(maxDrawdown, (peak - v.equity) / peak);
        }
        const months = [];
        let begin = valuations[0];
        for (let i = 1; i < valuations.length; i++) {
          const v = valuations[i], date = new Date(v.timestamp);
          if (date.getUTCDate() === 1 && date.getUTCHours() === 0 || i === valuations.length - 1) {
            months.push({ month: iso(begin.timestamp).slice(0, 7), startTime: begin.timestamp, endTime: v.timestamp, startEquity: begin.equity, endEquity: v.equity, pnl: v.equity - begin.equity, returnOnStartEquity: begin.equity > 0 ? v.equity / begin.equity - 1 : null, partial: new Date(begin.timestamp).getUTCDate() !== 1 || date.getUTCDate() !== 1 });
            begin = v;
          }
        }
        const missingEntryFundingCoverage = rejections.filter((r) => r.reason === "MISSING_ENTRY_FUNDING_COVERAGE").length;
        const missingEntryPrices = rejections.filter((r) => r.reason === "MISSING_ENTRY_PRICE").length;
        const missingEntryCoverage = missingEntryFundingCoverage + missingEntryPrices;
        return { variantId: variant.id, variant, exposure, costs: { feeBpsPerFill: feeRate * 1e4, slippageBpsPerFill: slippage * 1e4 }, startDay, endDay, entryEndDay, startTime: startDay * DAY, endTime: (endDay + 1) * DAY, startingEquity, finalEquity: final.equity, totalPnl: final.equity - startingEquity, totalReturn: final.equity / startingEquity - 1, final, valuations, months, trades, fills, fundingCashflows, rejections, blockers, valid: !invalid, complete: !invalid && missingEntryCoverage === 0, hasOpenPositions: open.length > 0, closedTrades: trades.filter((p) => p.exitTime !== null).length, openTrades: open.length, totalFees, totalFunding, totalSlippage, proxyFundingEvents, proxyFundingCash, fundingSensitivity: { lowerCashAdjustment: fundingLowerAdjustment, upperCashAdjustment: fundingUpperAdjustment, interpretation: "Fixed realized quantity path, replacing proxy event marks by hourly low/high; not a reoptimized portfolio or an intrahour probability model." }, quality: { executedCoverageComplete: !invalid, allCandidateEntryCoverageComplete: missingEntryCoverage === 0, criticalErrors: blockers, proxyFundingEvents, conditionalOnFundingMarkProxies: proxyFundingEvents > 0 }, observedRisk: { maxDrawdownFraction: maxDrawdown, minEquity, nonPositiveEquityObserved: minEquity <= 0, coverage: "daily_trade_price_close_snapshots_only", liquidationModeled: false, includesUnobservedIntradayExcursions: false }, dataQuality: { ...data.metadata, funding: funding.metadata, missingEntryCoverage, missingEntryFundingCoverage, missingEntryPrices, heldCoverageComplete: !invalid }, executionAssumptions: { entry: "first next-day daily open with adverse slippage; synthetic fill1second after finalized-bar availability at UTC00:00:01.000; actual executable quote/latency is unknown", exit: "next-day open after daily-close condition; no forced sample-end close", valuation: "daily last-price close labelled at following UTC midnight (observation 1ms earlier)", funding: "event contemporaneous mark price multiplied by fixed signed position quantity; midnight settlement precedes next-open fills", calendar: "complete status depends on externally supplied coverage intervals; event rows alone cannot prove expected settlements", liquidationModeled: false, partialFillsModeled: false } };
      }
      function exitZ(data, long, short, d, L = 180) {
        const A = data.bySymbol.get(long), B = data.bySymbol.get(short), i = d - data.day0;
        if (!A || !B || i < L) return NaN;
        let sum = 0, ss = 0;
        for (let j = i - L; j < i; j++) {
          if (!positive(A.close[j]) || !positive(B.close[j])) return NaN;
          const y = Math.log(A.close[j] / B.close[j]);
          sum += y;
          ss += y * y;
        }
        if (!positive(A.close[i]) || !positive(B.close[i])) return NaN;
        const sd = Math.sqrt(Math.max(0, (ss - sum * sum / L) / (L - 1)));
        return sd > 0 ? (Math.log(A.close[i] / B.close[i]) - sum / L) / sd : NaN;
      }
      module.exports = { DAY, WEEK0, EXCLUDED, prepareData, signals, qualifies, simulate, fundingIndex, covered, carryAt, exitZ, weekStart, _test: { prefix, windowStats, oscillator, weeklyUniverses, fundingBetween } };
    }
  });

  // research/refinement/channel_review_2026-10-13/channel_analyze.js
  var require_channel_analyze = __commonJS({
    "research/refinement/channel_review_2026-10-13/channel_analyze.js"(exports, module) {
      "use strict";
      var fs = require_fs();
      var path = require_path();
      var crypto = require_crypto();
      var assert = require_strict();
      var OUT = "/project/research/refinement";
      var ROOT = path.resolve(OUT, "..");
      var E = require_engine3();
      var hash = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
      var read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
      var write = (name, x) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(x, null, 2) + "\n");
      var mean = (a) => a.length ? a.reduce((n, x) => n + x, 0) / a.length : null;
      var quantile = (a, q) => {
        if (!a.length) return null;
        const b = [...a].sort((x, y) => x - y), i = (b.length - 1) * q, l = Math.floor(i);
        return b[l] + (b[Math.ceil(i)] - b[l]) * (i - l);
      };
      var median = (a) => quantile(a, 0.5);
      var distribution = (a) => ({ n: a.length, min: quantile(a, 0), p10: quantile(a, 0.1), p25: quantile(a, 0.25), median: quantile(a, 0.5), mean: mean(a), p75: quantile(a, 0.75), p90: quantile(a, 0.9), max: quantile(a, 1) });
      var date = (d) => new Date(d * E.DAY).toISOString().slice(0, 10);
      function excursions(x, mu, sd, startDay = 0) {
        let state = 0, start = null, extreme = null, extremeDay = null, sw = 0, first = null;
        const retained = [];
        for (let i = 0; i < x.length; i++) {
          const day = startDay + i, y = x[i], band = y >= mu + sd ? 1 : y <= mu - sd ? -1 : 0;
          if (state === 0) {
            if (band) {
              state = band;
              start = day;
              extreme = y;
              extremeDay = day;
            }
            continue;
          }
          if (band === -state) {
            const item = { side: state === 1 ? "high" : "low", startDay: start, extremeDay, extremeLogRatio: extreme, extremeFixedZ: (extreme - mu) / sd, confirmationDay: day, crossingDurationDays: day - start };
            sw++;
            if (first === null) first = item;
            else retained.push(item);
            state = band;
            start = day;
            extreme = y;
            extremeDay = day;
          } else if (state === 1 && y > extreme || state === -1 && y < extreme) {
            extreme = y;
            extremeDay = day;
          }
        }
        return { retained, switchCount: sw, excludedInitialConfirmedExcursion: first, excludedUnfinishedTerminalExcursion: state ? { side: state === 1 ? "high" : "low", startDay: start, extremeDay, extremeLogRatio: extreme } : null };
      }
      function level(events, mu, sd) {
        const logs = events.map((e) => e.extremeLogRatio), avg = mean(logs), med = median(logs);
        return { count: events.length, meanLogRatio: avg, medianLogRatio: med, meanFixedZ: avg === null ? null : (avg - mu) / sd, medianFixedZ: med === null ? null : (med - mu) / sd, geometricMeanRatio: avg === null ? null : Math.exp(avg), logMedianRatio: med === null ? null : Math.exp(med) };
      }
      function position(logRatio, lo, hi, mu, sd, extra = {}) {
        if (!Number.isFinite(logRatio) || !(hi.meanLogRatio > lo.meanLogRatio)) return null;
        const ratio = Math.exp(logRatio);
        return { ...extra, logRatio, ratio, fixedZ: (logRatio - mu) / sd, logChannelPosition: (logRatio - lo.meanLogRatio) / (hi.meanLogRatio - lo.meanLogRatio), ratioChannelPosition: (ratio - lo.geometricMeanRatio) / (hi.geometricMeanRatio - lo.geometricMeanRatio), belowAverageTrough: logRatio < lo.meanLogRatio, aboveAverageTop: logRatio > hi.meanLogRatio };
      }
      function tests() {
        let r = excursions([2, 3, -2, -3, 2, 4, -2, -4, 0], 0, 1);
        assert.equal(r.switchCount, 3);
        assert.deepEqual(r.retained.map((x) => [x.side, x.extremeDay, x.extremeLogRatio, x.confirmationDay]), [["low", 3, -3, 4], ["high", 5, 4, 6]]);
        assert.equal(r.excludedInitialConfirmedExcursion.extremeDay, 1);
        assert.equal(r.excludedUnfinishedTerminalExcursion.extremeDay, 7);
        r = excursions([0, 1, 2, -1, -2, -2, 1], 0, 1, 10);
        assert.equal(r.retained[0].extremeDay, 14);
        assert.equal(r.retained[0].confirmationDay, 16);
        assert.equal(r.retained[0].crossingDurationDays, 3);
        r = excursions([0, 0.5, 1, 2], 0, 1);
        assert.equal(r.retained.length, 0);
        assert.equal(r.switchCount, 0);
        r = excursions([-2, -3, 2, 3, -2, -4, 2], 0, 1);
        assert.deepEqual(r.retained.map((x) => x.side), ["high", "low"]);
        const a = level([{ extremeLogRatio: Math.log(2) }, { extremeLogRatio: Math.log(8) }], 0, 1);
        assert.ok(Math.abs(a.geometricMeanRatio - 4) < 1e-12);
        const p = position(0, { meanLogRatio: 0, geometricMeanRatio: 1 }, { meanLogRatio: 1, geometricMeanRatio: Math.E }, 0, 1);
        assert.equal(p.logChannelPosition, 0);
        assert.equal(p.belowAverageTrough, false);
        return { passed: 6, description: "Censoring, opposite-band confirmation, inclusive bands, earliest equal extrema, alternating direction, geometric level, and boundary-position checks." };
      }
      function dependence(rows) {
        const parent = rows.map((_, i) => i), find = (i) => {
          while (parent[i] !== i) {
            parent[i] = parent[parent[i]];
            i = parent[i];
          }
          return i;
        }, join = (i, j) => {
          i = find(i);
          j = find(j);
          if (i !== j) parent[j] = i;
        };
        const channel = /* @__PURE__ */ new Map(), pairs = /* @__PURE__ */ new Map(), shorts = /* @__PURE__ */ new Map();
        let overlappingPairWindowRowPairs = 0, samePairRowPairs = 0;
        rows.forEach((r, i) => {
          let key = r.long + "/" + r.short, window2 = key + ":" + r.preDipDay;
          if (!channel.has(window2)) channel.set(window2, []);
          channel.get(window2).push(r.candidateId);
          if (!pairs.has(key)) pairs.set(key, []);
          pairs.get(key).push(i);
          shorts.set(r.short, (shorts.get(r.short) || 0) + 1);
        });
        for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
          const a = rows[i], b = rows[j];
          if (Math.abs(a.signalDay - b.signalDay) <= 45 && [a.long, a.short].some((x) => x === b.long || x === b.short)) join(i, j);
          if (a.long === b.long && a.short === b.short) {
            samePairRowPairs++;
            if (a.oscillatorStartDay < b.preDipDay && b.oscillatorStartDay < a.preDipDay) overlappingPairWindowRowPairs++;
          }
        }
        const groups = /* @__PURE__ */ new Map();
        rows.forEach((r, i) => {
          let k = find(i);
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k).push(r);
        });
        const events = [...groups.values()].map((g) => ({ candidateIds: g.map((r) => r.candidateId), rows: g.length, firstSignalDate: date(Math.min(...g.map((r) => r.signalDay))), lastSignalDate: date(Math.max(...g.map((r) => r.signalDay))), symbols: [...new Set(g.flatMap((r) => [r.long, r.short]))].sort() })).sort((a, b) => b.rows - a.rows || a.firstSignalDate.localeCompare(b.firstSignalDate));
        return { rows: rows.length, uniqueDirectionalPairs: pairs.size, uniquePairPreDipWindows: channel.size, repeatedChannelWindows: [...channel.entries()].filter(([, ids]) => ids.length > 1).map(([key, ids]) => ({ key, candidateIds: ids })), samePairRowPairs, overlappingPairWindowRowPairs, shortTokenCounts: [...shorts.entries()].map(([symbol, count]) => ({ symbol, count })).sort((a, b) => b.count - a.count || a.symbol.localeCompare(b.symbol)), eventGroupDefinition: "Transitive connected rows sharing either token within45calendar signal days. Descriptive groups, not independent sample sizes.", eventGroupCount: events.length, largestEventGroup: events[0]?.rows || 0, eventGroups: events };
      }
      function summary(rows) {
        const metrics = {};
        for (const [name, get] of Object.entries({ troughMeanFixedZ: (r) => r.averageTrough.meanFixedZ, topMeanFixedZ: (r) => r.averageTop.meanFixedZ, channelWidthSD: (r) => (r.averageTop.meanLogRatio - r.averageTrough.meanLogRatio) / r.fixedSD, confirmedLows: (r) => r.averageTrough.count, confirmedHighs: (r) => r.averageTop.count, medianBandCrossingDays: (r) => r.crossingIntervals.medianAllDays, medianExtremeSpacingDays: (r) => r.crossingIntervals.medianAdjacentExtremeDays })) metrics[name] = distribution(rows.map(get).filter(Number.isFinite));
        const observations = {};
        for (const field of ["signalClose", "nextOpenReference", "executedEntry"]) {
          const used = rows.map((r) => r[field]).filter(Boolean);
          observations[field] = { usable: used.length, unavailable: rows.length - used.length, belowAverageTroughCount: used.filter((x) => x.belowAverageTrough).length, aboveAverageTopCount: used.filter((x) => x.aboveAverageTop).length, belowAverageTroughFraction: used.length ? used.filter((x) => x.belowAverageTrough).length / used.length : null, logChannelPosition: distribution(used.map((x) => x.logChannelPosition)), ratioChannelPosition: distribution(used.map((x) => x.ratioChannelPosition)), fixedZ: distribution(used.map((x) => x.fixedZ)) };
        }
        return { rows: rows.length, metrics, observations, dependence: dependence(rows) };
      }
      function main() {
        const inputFiles = { method: path.join(OUT, "channel_method.json"), dataset: path.join(ROOT, "data/dataset_v3.json"), signals: path.join(ROOT, "signals_v3.json"), registry: path.join(ROOT, "experiment_registry.json"), portfolio: path.join(ROOT, "runs/2026-10-13-round1-final/portfolios/full__CONTROL__gross_1__base.json"), engine: path.join(ROOT, "engine.js") };
        const inputs = Object.fromEntries(Object.entries(inputFiles).map(([k, p]) => [k, { path: path.relative(ROOT, p), sha256: hash(p) }]));
        const unitChecks = tests();
        const data = read(inputFiles.dataset), signals = read(inputFiles.signals), registry = read(inputFiles.registry), portfolio = read(inputFiles.portfolio), control = registry.variants.find((v) => v.id === "CONTROL");
        const candidates = signals.signals.filter((s) => E.qualifies(s, control)), trades = new Map(portfolio.trades.map((t) => [t.signalId, t]));
        assert.equal(candidates.length, 176);
        assert.equal(portfolio.trades.length, 59);
        assert.equal(trades.size, 59);
        assert.equal(portfolio.trades.filter((t) => t.exitTime !== null).length, 57);
        assert.equal(portfolio.trades.filter((t) => t.exitTime === null).length, 2);
        const bars = new Map(data.symbols.map((s) => [s.sym, new Map(s.bars.map((b) => [b[0], b]))]));
        const rows = [], nativeChecks = [];
        for (const s of candidates) {
          const start = s.oscillatorStartDay, end = s.preDipDay;
          assert.equal(end - start, 180);
          assert.ok(end <= s.day);
          const l = bars.get(s.long), sh = bars.get(s.short), x = [];
          for (let d = start; d < end; d++) {
            assert.ok(l.has(d) && sh.has(d), `Missing pre-dip price ${s.id} ${d}`);
            x.push(Math.log(l.get(d)[4] / sh.get(d)[4]));
          }
          const mu = mean(x), sd = Math.sqrt(x.reduce((n, y) => n + (y - mu) ** 2, 0) / 179);
          assert.ok(sd > 0);
          const exc = excursions(x, mu, sd, start), low = exc.retained.filter((x2) => x2.side === "low"), high = exc.retained.filter((x2) => x2.side === "high");
          assert.ok(low.length && high.length);
          assert.equal(exc.retained.length, exc.switchCount - 1);
          for (const z of exc.retained) {
            assert.ok(z.startDay >= start && z.extremeDay >= z.startDay && z.extremeDay < z.confirmationDay && z.confirmationDay < end);
          }
          const native = E._test.oscillator(x, E._test.prefix(x), 0, 180);
          assert.equal(native.sw, exc.switchCount);
          assert.equal(s.osc.sw, exc.switchCount);
          assert.equal(s.osc.both, native.both);
          const sdErr = Math.abs(sd - s.osc.sd), nativeSdErr = Math.abs(sd - native.sd), driftErr = Math.abs(native.drift - s.osc.drift);
          assert.ok(sdErr <= 1e-8 && nativeSdErr <= 1e-8 && driftErr <= 1e-7, `native tolerance ${s.id}`);
          nativeChecks.push({ candidateId: s.id, storedSDDifference: sdErr, nativeSDDifference: nativeSdErr, storedDriftDifference: driftErr, swingCount: exc.switchCount, retainedExtrema: exc.retained.length });
          const trough = level(low, mu, sd), top = level(high, mu, sd), t = trades.get(s.id), lb = l.get(s.day), sb = sh.get(s.day), nextL = l.get(s.day + 1), nextS = sh.get(s.day + 1);
          assert.ok(lb && sb);
          const adjacent = exc.retained.slice(1).map((z, i) => z.extremeDay - exc.retained[i].extremeDay), sameType = (es) => es.slice(1).map((z, i) => z.extremeDay - es[i].extremeDay);
          rows.push({ candidateId: s.id, long: s.long, short: s.short, signalDay: s.day, signalDate: s.date, signalAvailableTimestamp: (s.day + 1) * E.DAY, oscillatorStartDay: start, oscillatorStartDate: date(start), preDipDay: end, preDipDate: date(end), channelAvailableTimestamp: end * E.DAY, fixedMeanLogRatio: mu, fixedSD: sd, nativeStoredOscillator: s.osc, averageTrough: trough, averageTop: top, confirmedExtrema: exc.retained, excludedInitialConfirmedExcursion: exc.excludedInitialConfirmedExcursion, excludedUnfinishedTerminalExcursion: exc.excludedUnfinishedTerminalExcursion, crossingIntervals: { medianAllDays: median(exc.retained.map((z) => z.crossingDurationDays)), medianHighToLowDays: median(high.map((z) => z.crossingDurationDays)), medianLowToHighDays: median(low.map((z) => z.crossingDurationDays)), medianAdjacentExtremeDays: median(adjacent), medianLowToLowExtremeDays: median(sameType(low)), medianHighToHighExtremeDays: median(sameType(high)) }, signalClose: position(Math.log(lb[4] / sb[4]), trough, top, mu, sd, { observationTimestamp: (s.day + 1) * E.DAY - 1 }), nextOpenReference: nextL && nextS ? position(Math.log(nextL[1] / nextS[1]), trough, top, mu, sd, { observationTimestamp: (s.day + 1) * E.DAY, usage: "post-signal descriptive execution reference, not a signal-time feature" }) : null, executedEntry: t ? position(Math.log(t.longEntry / t.shortEntry), trough, top, mu, sd, { tradeId: t.id, entryTimestamp: t.entryTime, entryStatus: t.status, usage: "recorded adverse-slippage entry fills; no future extrema" }) : null, executedInControlGross1: !!t });
        }
        assert.equal(rows.filter((r) => r.executedInControlGross1).length, 59);
        const run = { createdAt: (/* @__PURE__ */ new Date()).toISOString(), status: "descriptive_pre_dip_channels_not_a_tested_new_strategy", inputs, rows };
        write("channel_rows.json", run);
        const sum = { createdAt: run.createdAt, inputs, allCandidates: summary(rows), executedControlGross1: summary(rows.filter((r) => r.executedInControlGross1)), notExecuted: summary(rows.filter((r) => !r.executedInControlGross1)), tradePopulation: { total: 59, closed: 57, open: 2 }, verification: { unitChecks, candidateCount: 176, matchedTradeCount: 59, allWindows180Days: true, allExtremaAndConfirmationsBeforePreDip: true, allChannelsAvailableBeforeSignal: true, nativeSwingAndThirdsMatches: nativeChecks.length, maxStoredSDDifference: Math.max(...nativeChecks.map((x) => x.storedSDDifference)), maxNativeSDDifference: Math.max(...nativeChecks.map((x) => x.nativeSDDifference)), maxStoredDriftDifference: Math.max(...nativeChecks.map((x) => x.storedDriftDifference)), floatingTolerances: { sdAbsolute: 1e-8, driftAbsolute: 1e-7 } }, limitations: ["Channel extrema are confirmed historical pre-dip observations, not future bounds or support guarantees.", "The initial and terminal excursions are excluded, which reduces extreme counts relative to raw switches.", "Full-window fixed bands are available at preDipDay; retrospective historical confirmation timestamps do not imply earlier access to final mean/sd.", "Signal and execution positions refer to different timestamps. Next-open and recorded execution values are descriptive after signal availability, not entry features.", "176 candidates and59executions are dependent: repeated windows, shared tokens and event clusters are reported explicitly.", "This is no performance optimization, parameter search, new entry gate, or untouched validation."] };
        write("channel_summary.json", sum);
        write("channel_native_checks.json", { inputs, checks: nativeChecks });
        for (const [k, p] of Object.entries(inputFiles)) assert.equal(hash(p), inputs[k].sha256, `Frozen input changed: ${p}`);
        const outputs = ["channel_method.json", "channel_rows.json", "channel_summary.json", "channel_native_checks.json", "channel_analyze.js"].map((n) => ({ path: path.relative(ROOT, path.join(OUT, n)), sha256: hash(path.join(OUT, n)), bytes: fs.statSync(path.join(OUT, n)).size }));
        write("channel_manifest.json", { createdAt: run.createdAt, inputs, outputs, allInputHashesUnchanged: true });
        console.log(JSON.stringify({ outputs, allCandidates: sum.allCandidates.observations, executed: sum.executedControlGross1.observations, channelMetrics: sum.allCandidates.metrics, dependence: { candidateWindows: sum.allCandidates.dependence.uniquePairPreDipWindows, candidateGroups: sum.allCandidates.dependence.eventGroupCount, largestCandidateGroup: sum.allCandidates.dependence.largestEventGroup, executedWindows: sum.executedControlGross1.dependence.uniquePairPreDipWindows, executedGroups: sum.executedControlGross1.dependence.eventGroupCount }, verification: sum.verification }, null, 2));
      }
      if (__require.main === module) main();
      module.exports = { excursions, level, position };
    }
  });

  // research/refinement/round2/channel_signals.js
  var require_channel_signals = __commonJS({
    "research/refinement/round2/channel_signals.js"(exports, module) {
      "use strict";
      var fs = require_fs();
      var path = require_path();
      var crypto = require_crypto();
      var assert = require_strict();
      var E = require_engine3();
      var P = require_channel_analyze();
      var DAY = E.DAY;
      var ROOT = path.resolve("/project/research/refinement", "..");
      var DEFAULTS = Object.freeze({ L: 180, topK: 150, minHist: 95, minAge: 365, minSD: 0.03, maxSD: 0.6, maxDF: -2.86, maxR2: 0.5, maxDrift: 0.7, minSw: 5, minThirds: 3, minExtremaEach: 2, intactCloses: 20, breakBufferSD: 0.5 });
      var mean = (a) => a.reduce((n, x) => n + x, 0) / a.length;
      var quantile = (a, q) => {
        const b = [...a].sort((x, y) => x - y), i = (b.length - 1) * q, l = Math.floor(i);
        return b[l] + (b[Math.ceil(i)] - b[l]) * (i - l);
      };
      var iso = (d) => new Date(d * DAY).toISOString().slice(0, 10);
      var hash = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
      function spread(values, mu, sd) {
        const avg = mean(values);
        return { count: values.length, meanLog: avg, medianLog: quantile(values, 0.5), minLog: Math.min(...values), maxLog: Math.max(...values), sampleSDLog: Math.sqrt(values.reduce((n, x) => n + (x - avg) ** 2, 0) / (values.length - 1)), IQRLog: quantile(values, 0.75) - quantile(values, 0.25), meanFixedZ: (avg - mu) / sd };
      }
      function qualityPass(st, osc) {
        return !!st && !!osc && st.sd >= DEFAULTS.minSD && st.sd <= DEFAULTS.maxSD && st.df <= DEFAULTS.maxDF && st.r2 < DEFAULTS.maxR2 && osc.drift <= DEFAULTS.maxDrift && osc.sw >= DEFAULTS.minSw && osc.both >= DEFAULTS.minThirds;
      }
      function buildChannel(values, formationStartDay, stats = null, osc = null) {
        if (values.length !== 180 || !values.every(Number.isFinite)) return null;
        const p = E._test.prefix(values), st = stats || E._test.windowStats(values, p, 0, 180), os = osc || E._test.oscillator(values, p, 0, 180);
        if (!qualityPass(st, os)) return null;
        const phases = P.excursions(values, st.mu, st.sd, formationStartDay), low = phases.retained.filter((x) => x.side === "low"), high = phases.retained.filter((x) => x.side === "high");
        assert.equal(phases.switchCount, os.sw, "Frozen channel band switches disagree with native oscillator");
        if (low.length < 2 || high.length < 2) return null;
        const bottom = spread(low.map((x) => x.extremeLogRatio), st.mu, st.sd), top = spread(high.map((x) => x.extremeLogRatio), st.mu, st.sd), formationEndDay = formationStartDay + 179;
        assert.ok(phases.retained.every((x) => x.confirmationDay <= formationEndDay && x.extremeDay < x.confirmationDay));
        return { mu: st.mu, sd: st.sd, averageBottomLog: bottom.meanLog, averageTopLog: top.meanLog, breakLog: bottom.minLog - 0.5 * st.sd, formationStartDay, formationEndDay, availableTimestamp: (formationEndDay + 1) * DAY, completedTroughs: bottom.count, completedPeaks: top.count, troughDispersion: bottom, peakDispersion: top, confirmedExtrema: phases.retained, excludedInitialConfirmedExcursion: phases.excludedInitialConfirmedExcursion, excludedUnfinishedTerminalExcursion: phases.excludedUnfinishedTerminalExcursion, quality: { df: st.df, r2: st.r2, drift: os.drift, sw: os.sw, both: os.both }, levelPolicy: "Weekly formation frozen before signal; copied unchanged to trade at entry." };
      }
      function entryDecision(values, index, channel) {
        if (!channel || index < 19) return { pass: false, reason: "INSUFFICIENT_HISTORY" };
        const previous = values[index - 1], current = values[index];
        if (!Number.isFinite(previous) || !Number.isFinite(current)) return { pass: false, reason: "MISSING_CURRENT_OR_PREVIOUS" };
        if (!(previous <= channel.averageBottomLog && current > channel.averageBottomLog)) return { pass: false, reason: "NO_SAME_CHANNEL_BOTTOM_RECROSS" };
        if (!(current <= channel.mu - channel.sd)) return { pass: false, reason: "ABOVE_LOWER_SD_BAND" };
        for (let i = index - 19; i <= index; i++) if (!Number.isFinite(values[i])) return { pass: false, reason: "MISSING_INTACT_WINDOW" };
        else if (values[i] < channel.breakLog || values[i] > channel.averageTopLog) return { pass: false, reason: "BROKEN_20_CLOSE_CHANNEL" };
        assert.ok(current > previous);
        return { pass: true, currentLogRatio: current, previousLogRatio: previous, rawRatioChange: current - previous, intactWindowStartIndex: index - 19 };
      }
      function generateChannelSignals(raw, config = {}) {
        const data = E.prepareData(raw), startDay = config.startDay ?? Math.floor(Date.parse("2023-09-10") / DAY), endDay = config.endDay ?? Math.floor(Date.parse("2026-10-12") / DAY), firstSignalDay = startDay - 1;
        assert.ok(Number.isInteger(startDay) && Number.isInteger(endDay) && firstSignalDay >= data.day0 + 180 && endDay <= data.day1 && endDay >= startDay);
        const c = { ...DEFAULTS, startDay: firstSignalDay, endDay }, universe = E._test.weeklyUniverses(data, c), signals = [], diagnostics = { pairs: universe.pairs.size, pairWeeks: 0, qualityPassPairWeeks: 0, channels: 0, signalDaysConsidered: 0, candidates: 0, missingOrBrokenWindowRejections: 0 };
        for (const pair of universe.pairs.values()) {
          const A = data.bySymbol.get(pair.a), B = data.bySymbol.get(pair.b), x = new Float64Array(data.n).fill(NaN);
          for (let i = 0; i < data.n; i++) if (A.close[i] > 0 && B.close[i] > 0) x[i] = Math.log(A.close[i] / B.close[i]);
          const prefix = E._test.prefix(x);
          for (const w of pair.weeks) {
            if (w + 6 < firstSignalDay || w > endDay) continue;
            diagnostics.pairWeeks++;
            const wi = w - data.day0, st = E._test.windowStats(x, prefix, wi - 180, wi);
            if (!st || st.sd < 0.03 || st.sd > 0.6 || st.df > -2.86 || st.r2 >= 0.5) continue;
            const osc = E._test.oscillator(x, prefix, wi - 180, wi);
            if (!qualityPass(st, osc)) continue;
            diagnostics.qualityPassPairWeeks++;
            for (const dir of [1, -1]) {
              const formation = Array.from(x.slice(wi - 180, wi), (v) => dir * v), channel = buildChannel(formation, w - 180, { ...st, mu: dir * st.mu }, osc);
              if (!channel) continue;
              diagnostics.channels++;
              const long = dir === 1 ? A : B, short = dir === 1 ? B : A, ranks = universe.weeks.get(w).ranks;
              for (let day = Math.max(w, firstSignalDay); day <= Math.min(w + 6, endDay); day++) {
                if (day - long.listDay < 365 || day - short.listDay < 365) continue;
                diagnostics.signalDaysConsidered++;
                const i = day - data.day0, window2 = Array.from(x.slice(i - 19, i + 1), (v) => dir * v), test = entryDecision(window2, 19, channel);
                if (!test.pass) {
                  if (test.reason === "MISSING_INTACT_WINDOW" || test.reason === "BROKEN_20_CLOSE_CHANNEL") diagnostics.missingOrBrokenWindowRejections++;
                  continue;
                }
                assert.ok(channel.formationEndDay < day && channel.availableTimestamp <= day * DAY);
                const z = (test.currentLogRatio - channel.mu) / channel.sd;
                signals.push({ id: `${day}:${long.sym}/${short.sym}`, family: "channel", day, date: iso(day), signalTime: (day + 1) * DAY - 1, signalAvailableTime: (day + 1) * DAY, long: long.sym, short: short.sym, entryZ: z, zEntry: z, gap: Math.expm1(channel.mu - test.currentLogRatio), mu: channel.mu, sd: channel.sd, rawRatioChange: test.rawRatioChange, currentLogRatio: test.currentLogRatio, previousLogRatio: test.previousLogRatio, intactWindowStartDay: day - 19, intactWindowEndDay: day, weeklyDay: w, rankLong: ranks.get(long.sym).rank, rankShort: ranks.get(short.sym).rank, minLiquidity: Math.min(ranks.get(long.sym).liq, ranks.get(short.sym).liq), channel });
              }
            }
          }
          if (config.onProgress && diagnostics.pairWeeks % 1e4 < 10) config.onProgress({ ...diagnostics, candidates: signals.length });
        }
        signals.sort((a, b) => a.day - b.day || b.gap - a.gap || a.id.localeCompare(b.id));
        assert.equal(new Set(signals.map((s) => s.id)).size, signals.length);
        diagnostics.candidates = signals.length;
        return { signals, config: { ...DEFAULTS, startDay, endDay, firstSignalDay }, diagnostics, universes: [...universe.weeks.values()].map((w) => ({ day: w.day, candidateCount: w.candidateCount, members: w.members })), dataQuality: data.metadata };
      }
      function mergeIntervals(rows) {
        const out = [];
        for (const [a, b] of [...rows].sort((a2, b2) => a2[0] - b2[0])) {
          if (out.length && a <= out[out.length - 1][1] + 1) out[out.length - 1][1] = Math.max(b, out[out.length - 1][1]);
          else out.push([a, b]);
        }
        return out;
      }
      function subtract(a, b, intervals) {
        let out = [], cursor = a;
        for (const [lo, hi] of mergeIntervals(intervals)) {
          if (hi < cursor) continue;
          if (lo > b) break;
          if (lo > cursor) out.push([cursor, Math.min(b, lo - 1)]);
          cursor = Math.max(cursor, hi + 1);
          if (cursor > b) break;
        }
        if (cursor <= b) out.push([cursor, b]);
        return out;
      }
      function assessFundingCoverage(signalData, fundingRaw, dataEndDay) {
        const f = E.fundingIndex(fundingRaw), required = /* @__PURE__ */ new Map(), candidateCoverage = [], sampleEnd = (dataEndDay + 1) * DAY - 1;
        let outsideEntry = 0;
        for (const s of signalData.signals) {
          if (s.day + 1 > dataEndDay) {
            outsideEntry++;
            continue;
          }
          const start = (s.day - 6) * DAY, fullEnd = (s.day + 46) * DAY + 1e3, end = Math.min(sampleEnd, fullEnd), entryEnd = (s.day + 1) * DAY - 1;
          const legs = [s.long, s.short].map((sym) => {
            if (!required.has(sym)) required.set(sym, []);
            required.get(sym).push([start, end]);
            return { symbol: sym, historicalCarryCovered: E.covered(f, sym, start, entryEnd), potentialHoldCovered: E.covered(f, sym, entryEnd + 1, end) };
          });
          candidateCoverage.push({ id: s.id, signalDay: s.day, requiredStart: start, requiredEndWithinSample: end, full45DayHoldExitEnd: fullEnd, rightCensoredBySampleEnd: fullEnd > sampleEnd, legs });
        }
        const symbols = [];
        for (const [symbol, ranges] of required) {
          const row = f.bySymbol.get(symbol), merged = mergeIntervals(ranges), known = row?.intervals.filter((x) => x.complete === true).map((x) => [x.start, x.end]) || [], uncovered = [], gaps = [], missingMarks = [];
          for (const [a, b] of merged) {
            uncovered.push(...subtract(a, b, known));
            for (const g of row?.gaps || []) {
              const lo = Number(g.start ?? g.startTime ?? g[0]), hi = Number(g.end ?? g.endTime ?? g[1]);
              if (lo <= b && hi >= a) gaps.push({ ...g, overlapStart: Math.max(a, lo), overlapEnd: Math.min(b, hi) });
            }
            for (const e of row?.events || []) if (e.timestamp >= a && e.timestamp <= b && !(Number.isFinite(e.markPrice) && e.markPrice > 0)) missingMarks.push(e.timestamp);
          }
          symbols.push({ symbol, requestedIntervals: merged, missingDeclaredIntervals: mergeIntervals(uncovered), retainedKnownGaps: gaps, missingEventMarks: missingMarks, allPotentialCoverageComplete: merged.every(([a, b]) => E.covered(f, symbol, a, b)) && missingMarks.length === 0 });
        }
        return { status: "coverage_assessment_not_zero_filled_funding", signalCount: signalData.signals.length, candidatesWithEntryWithinSample: candidateCoverage.length, outsideSampleEntryCandidates: outsideEntry, requiredSymbols: symbols.length, fullyCoveredSymbols: symbols.filter((s) => s.allPotentialCoverageComplete).length, symbolsNeedingAdditionalIntervals: symbols.filter((s) => s.missingDeclaredIntervals.length).length, totalMissingDeclaredIntervals: symbols.reduce((n, s) => n + s.missingDeclaredIntervals.length, 0), candidateEntryCoverageIncomplete: candidateCoverage.filter((s) => s.legs.some((l) => !l.historicalCarryCovered)).length, candidatePotentialHoldingCoverageIncomplete: candidateCoverage.filter((s) => s.legs.some((l) => !l.potentialHoldCovered)).length, originalKnownGapCount: [...f.bySymbol.values()].reduce((n, s) => n + s.gaps.length, 0), requestDefinition: "Per eligible candidate and both legs: signalDay-6 UTC00 through min(sample final close, signalDay+46 UTC00:00:01), covering seven historical days plus45holding closes and following open exit. Later potential holds are explicitly right-censored by sample end.", symbols, candidates: candidateCoverage };
      }
      function cli() {
        const args = process.argv.slice(2), get = (flag, fallback) => {
          let i = args.indexOf(flag);
          return i < 0 ? fallback : args[i + 1];
        }, registryPath = get("--registry", path.join("/project/research/refinement", "registry.json")), datasetPath = get("--dataset", path.join(ROOT, "data/dataset_v3.json")), outputPath = get("--output", path.join("/project/research/refinement", "channel_signals.json")), coveragePath = get("--coverage", path.join("/project/research/refinement", "funding_coverage_assessment.json")), fundingPath = get("--funding", path.join(ROOT, "funding/funding_verified.json"));
        const registry = JSON.parse(fs.readFileSync(registryPath));
        assert.ok(registry.frozen_at_utc && registry.status.startsWith("frozen_before_round2"), "Registry must be frozen before observed generation");
        assert.ok(!fs.existsSync(outputPath) && !fs.existsSync(coveragePath), "Refuse to overwrite frozen signals or prior coverage assessment");
        const data = JSON.parse(fs.readFileSync(datasetPath)), sourceFiles = { dataset: datasetPath, registry: registryPath, engine: path.join(ROOT, "engine.js"), channelPivots: path.join(ROOT, "channel_review_2026-10-13/channel_analyze.js"), generator: __filename, funding: fundingPath }, sourceHashes = Object.fromEntries(Object.entries(sourceFiles).map(([k, p]) => [k, hash(p)]));
        const result = generateChannelSignals(data, { startDay: Date.parse(registry.periods[0].start) / DAY, endDay: Date.parse(registry.periods[0].end) / DAY });
        const output = { createdAt: (/* @__PURE__ */ new Date()).toISOString(), status: "frozen_round2_price_candidates_before_funding_and_portfolio_constraints", ...result, sourceHashes, sourceFiles };
        fs.writeFileSync(outputPath, JSON.stringify(output));
        const coverage = assessFundingCoverage(result, JSON.parse(fs.readFileSync(fundingPath)), data.endDay);
        fs.writeFileSync(coveragePath, JSON.stringify({ createdAt: (/* @__PURE__ */ new Date()).toISOString(), sourceHashes, signalSha256: hash(outputPath), ...coverage }, null, 2));
        for (const [k, p] of Object.entries(sourceFiles)) assert.equal(hash(p), sourceHashes[k]);
        console.log(JSON.stringify({ outputPath, signalSha256: hash(outputPath), diagnostics: result.diagnostics, coveragePath, coverage: (({ symbols, candidates, ...rest }) => rest)(coverage) }, null, 2));
      }
      if (__require.main === module) cli();
      module.exports = { DEFAULTS, buildChannel, entryDecision, generateChannelSignals, assessFundingCoverage, _test: { spread, mergeIntervals, subtract, qualityPass } };
    }
  });

  // research/refinement/round8_stoch_range/stoch_v2.js
  var require_stoch_v2 = __commonJS({
    "research/refinement/round8_stoch_range/stoch_v2.js"(exports, module) {
      "use strict";
      var EPS = 1e-9;
      function stoch(close) {
        const n = close.length, rsi = new Float64Array(n).fill(NaN), raw = new Float64Array(n).fill(NaN), k = new Float64Array(n).fill(NaN), d = new Float64Array(n).fill(NaN);
        let count = 0, gain = 0, loss = 0, avgG = NaN, avgL = NaN;
        for (let i = 1; i < n; i++) {
          if (!Number.isFinite(close[i]) || !Number.isFinite(close[i - 1])) {
            count = 0;
            gain = loss = 0;
            avgG = avgL = NaN;
            continue;
          }
          const delta = close[i] - close[i - 1], up = Math.max(0, delta), down = Math.max(0, -delta);
          if (count < 14) {
            gain += up;
            loss += down;
            count++;
            if (count === 14) {
              avgG = gain / 14;
              avgL = loss / 14;
            }
          } else {
            avgG = (13 * avgG + up) / 14;
            avgL = (13 * avgL + down) / 14;
          }
          if (count >= 14 && avgG + avgL > 0) rsi[i] = 100 * avgG / (avgG + avgL);
        }
        const sma = (x, i) => i >= 2 && [x[i - 2], x[i - 1], x[i]].every(Number.isFinite) ? (x[i - 2] + x[i - 1] + x[i]) / 3 : NaN;
        for (let i = 13; i < n; i++) {
          let lo = Infinity, hi = -Infinity, ok = true;
          for (let j = i - 13; j <= i; j++) {
            if (!Number.isFinite(rsi[j])) {
              ok = false;
              break;
            }
            lo = Math.min(lo, rsi[j]);
            hi = Math.max(hi, rsi[j]);
          }
          if (ok && hi > lo) raw[i] = Math.max(0, Math.min(100, 100 * (rsi[i] - lo) / (hi - lo)));
          k[i] = sma(raw, i);
          d[i] = sma(k, i);
        }
        return { rsi, raw, k, d };
      }
      function pivots(k) {
        const events = /* @__PURE__ */ new Map();
        let low = null, high = null;
        for (let i = 2; i < k.length; i++) {
          if (![k[i], k[i - 1], k[i - 2]].every(Number.isFinite)) {
            low = high = null;
            continue;
          }
          const j = i - 1;
          let start = j;
          while (start > 0 && Math.abs(k[start - 1] - k[j]) <= EPS) start--;
          if (start === 0 || !Number.isFinite(k[start - 1])) continue;
          let side = null;
          if (k[i] > k[j] + EPS && k[start - 1] > k[j] + EPS) side = "bottom";
          else if (k[i] < k[j] - EPS && k[start - 1] < k[j] - EPS) side = "top";
          if (!side) continue;
          const prior = side === "bottom" ? low : high, current = { index: j, plateauStart: start, value: k[j], confirmedIndex: i };
          const match = prior && j - prior.index <= 20 && (side === "bottom" ? prior.value < 20 - EPS && current.value < 20 - EPS && current.value > prior.value + EPS : prior.value > 80 + EPS && current.value > 80 + EPS && current.value < prior.value - EPS);
          events.set(i, { side, current, previous: prior ? { ...prior } : null, match: !!match, confirmK: k[i], strictZone: side === "bottom" ? k[i] < 20 - EPS : k[i] > 80 + EPS });
          if (side === "bottom") low = current;
          else high = current;
        }
        return events;
      }
      module.exports = { stoch, pivots };
    }
  });

  // research/refinement/round8_stoch_range/generate_v2.js
  var require_generate_v2 = __commonJS({
    "research/refinement/round8_stoch_range/generate_v2.js"(exports, module) {
      "use strict";
      var fs = require_fs();
      var path = require_path();
      var crypto = require_crypto();
      var assert = require_strict();
      var E = require_engine2();
      var C = require_channel_signals();
      var S = require_stoch_v2();
      var HERE = "/project/research/refinement";
      var read = (p) => JSON.parse(fs.readFileSync(p));
      var hash = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
      function generate(raw, registry) {
        const data = E.prepareData(raw), first = Date.parse(registry.periods[0].start) / E.DAY - 1, last = data.day1;
        const universe = E._test.weeklyUniverses(data, { ...C.DEFAULTS, startDay: first, endDay: last }), signals = [], diag = { pairs: universe.pairs.size, pairWeeks: 0, channels: 0, candidates: 0, rangeControls: 0, stochTurns: 0, strictTurns: 0, bottomTurns: 0, topTurns: 0, lifecycleExclusions: 0 };
        for (const pair of universe.pairs.values()) {
          const A = data.bySymbol.get(pair.a), B = data.bySymbol.get(pair.b), x = new Float64Array(data.n).fill(NaN), ratio = new Float64Array(data.n).fill(NaN);
          for (let i = 0; i < data.n; i++) if (A.close[i] > 0 && B.close[i] > 0) {
            ratio[i] = A.close[i] / B.close[i];
            x[i] = Math.log(ratio[i]);
          }
          const prefix = E._test.prefix(x);
          let indicator = null, turns = null;
          for (const w of pair.weeks) {
            if (w + 6 < first || w > last) continue;
            diag.pairWeeks++;
            const wi = w - data.day0, st = E._test.windowStats(x, prefix, wi - 180, wi);
            if (!st || st.sd < 0.03 || st.sd > 0.6 || st.df > -2.86 || st.r2 >= 0.5) continue;
            const osc = E._test.oscillator(x, prefix, wi - 180, wi);
            if (!C._test.qualityPass(st, osc)) continue;
            if (!indicator) {
              indicator = S.stoch(ratio);
              turns = S.pivots(indicator.k);
            }
            for (const dir of [1, -1]) {
              const channel = C.buildChannel(Array.from(x.slice(wi - 180, wi), (v) => dir * v), w - 180, { ...st, mu: dir * st.mu }, osc);
              if (!channel) continue;
              diag.channels++;
              channel.upperBreakLog = channel.peakDispersion.maxLog + 0.5 * channel.sd;
              const long = dir === 1 ? A : B, short = dir === 1 ? B : A, side = dir === 1 ? "bottom" : "top";
              for (let day = Math.max(w, first); day <= Math.min(w + 6, last); day++) {
                const i = day - data.day0, y = dir * x[i], previous = dir * x[i - 1];
                if (day - long.listDay < 365 || day - short.listDay < 365 || !Number.isFinite(y) || i < 19) continue;
                const near = (v) => v >= channel.breakLog && v <= channel.averageBottomLog + 0.5 * channel.sd;
                if (!near(y) || y > channel.mu - channel.sd) continue;
                let intact = true;
                for (let j = i - 19; j <= i; j++) if (!Number.isFinite(x[j]) || dir * x[j] < channel.breakLog || dir * x[j] > channel.upperBreakLog) {
                  intact = false;
                  break;
                }
                if (!intact) continue;
                const control = previous <= channel.averageBottomLog && y > channel.averageBottomLog;
                const event = turns.get(i), pattern = !!(event?.match && event.side === side && near(dir * x[event.current.index]));
                if (!control && !pattern) continue;
                const boundary = (day + 1) * E.DAY;
                if ([long, short].some((t) => t.deliveryTime > 0 && boundary + 1e3 >= t.deliveryTime)) {
                  diag.lifecycleExclusions++;
                  continue;
                }
                const ranks = universe.weeks.get(w).ranks;
                signals.push({ id: `${day}:${long.sym}/${short.sym}`, family: "channel", day, date: new Date(day * E.DAY).toISOString().slice(0, 10), signalTime: boundary - 1, signalAvailableTime: boundary, entryBoundary: boundary, long: long.sym, short: short.sym, entryZ: (y - channel.mu) / channel.sd, gap: Math.expm1(channel.mu - y), mu: channel.mu, sd: channel.sd, currentLogRatio: y, rawRatioChange: y - previous, weeklyDay: w, rankLong: ranks.get(long.sym).rank, rankShort: ranks.get(short.sym).rank, minLiquidity: Math.min(ranks.get(long.sym).liq, ranks.get(short.sym).liq), chartA: pair.a, chartB: pair.b, chartSide: side, rangeControl: control, stochTurn: pattern, stochStrict: pattern && event.strictZone, stoch: pattern ? { rsi: indicator.rsi[i], K: indicator.k[i], D: Number.isFinite(indicator.d[i]) ? indicator.d[i] : null, pivot1Day: data.day0 + event.previous.index, pivot1K: event.previous.value, pivot2Day: data.day0 + event.current.index, pivot2K: event.current.value, plateauStartDay: data.day0 + event.current.plateauStart, confirmationDay: day, pivot2ChartRatio: ratio[event.current.index], chartRatio: ratio[i] } : null, channel });
                diag.rangeControls += Number(control);
                diag.stochTurns += Number(pattern);
                diag.strictTurns += Number(pattern && event.strictZone);
                diag.bottomTurns += Number(pattern && side === "bottom");
                diag.topTurns += Number(pattern && side === "top");
              }
            }
          }
        }
        signals.sort((a, b) => a.day - b.day || b.gap - a.gap || a.id.localeCompare(b.id));
        assert.equal(new Set(signals.map((s) => s.id)).size, signals.length);
        diag.candidates = signals.length;
        return { signals, diagnostics: diag, universes: [...universe.weeks.values()].map((w) => ({ day: w.day, candidateCount: w.candidateCount, members: w.members })) };
      }
      if (__require.main === module) {
        const registry = read(path.join(HERE, "registry_v2.json")), out = path.join(HERE, "data/channel_signals_v2.json");
        assert(!fs.existsSync(out));
        const paths = [path.join(HERE, "registry_v2.json"), __filename, path.join(HERE, "stoch_v2.js"), path.resolve(HERE, registry.sources.daily), path.join(HERE, "../round3/engine.js"), path.join(HERE, "../round2/channel_signals.js"), path.join(HERE, "../channel_review_2026-10-13/channel_analyze.js")], inputs = paths.map((p) => ({ path: p, sha256: hash(p) }));
        fs.writeFileSync(path.join(HERE, "data/signal_input_manifest_v2.json"), JSON.stringify({ frozenBeforeSignalGenerationAt: (/* @__PURE__ */ new Date()).toISOString(), inputs }) + "\n", { flag: "wx" });
        const result = generate(read(path.resolve(HERE, registry.sources.daily)), registry);
        result.inputs = inputs;
        result.createdAt = (/* @__PURE__ */ new Date()).toISOString();
        for (const i of inputs) assert.equal(hash(i.path), i.sha256);
        fs.writeFileSync(out, JSON.stringify(result) + "\n", { flag: "wx" });
        console.log(JSON.stringify({ status: "COMPLETE_PRICE_CANDIDATES_NO_OUTCOMES", sha256: hash(out), diagnostics: result.diagnostics }));
      }
      module.exports = { generate };
    }
  });

  // research/refinement/round10_sequence_strategy/generate.js
  var require_generate = __commonJS({
    "research/refinement/round10_sequence_strategy/generate.js"(exports, module) {
      "use strict";
      var fs = require_fs();
      var path = require_path();
      var crypto = require_crypto();
      var assert = require_strict();
      var E = require_engine2();
      var C = require_channel_signals();
      var S = require_stoch_v2();
      var HERE = "/project/research/refinement";
      var read = (p) => JSON.parse(fs.readFileSync(p));
      var hash = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
      function bb20(ratio) {
        const out = new Float64Array(ratio.length).fill(NaN);
        for (let i = 19; i < ratio.length; i++) {
          let sum = 0, ok = true;
          for (let j = i - 19; j <= i; j++) {
            if (!Number.isFinite(ratio[j])) {
              ok = false;
              break;
            }
            sum += ratio[j];
          }
          if (!ok) continue;
          const mean = sum / 20;
          let ss = 0;
          for (let j = i - 19; j <= i; j++) ss += (ratio[j] - mean) ** 2;
          const sd = Math.sqrt(ss / 20);
          if (sd > 0) out[i] = (ratio[i] - mean) / sd;
        }
        return out;
      }
      function sequence(x, indicator, bb, channel, dir, start, end) {
        let pending = null, lastStretch = false;
        const arms = [], signals = [];
        const eps = 1e-9, known = (i) => [x[i], indicator.rsi[i], indicator.k[i], indicator.d[i], bb[i]].every(Number.isFinite);
        for (let i = start; i <= end; i++) {
          const y = dir * x[i];
          let intact = i >= 19;
          for (let j = i - 19; intact && j <= i; j++) if (!Number.isFinite(x[j]) || dir * x[j] < channel.breakLog || dir * x[j] > channel.upperBreakLog) intact = false;
          const valid = known(i) && intact, near = valid && y >= channel.breakLog && y <= channel.averageBottomLog + 0.5 * channel.sd && y <= channel.mu - channel.sd;
          const rsi = dir === 1 ? indicator.rsi[i] : 100 - indicator.rsi[i], k = dir === 1 ? indicator.k[i] : 100 - indicator.k[i];
          const stretch = near && rsi <= 40 + eps && k <= 20 + eps && dir * bb[i] <= -1.5 + eps;
          if (pending && (!valid || y < channel.breakLog || y > channel.mu - 0.5 * channel.sd || i - pending.index > 3)) {
            pending.cancelledAt = i;
            pending.cancelReason = !valid ? "UNKNOWN_OR_CHANNEL_BREAK" : y > channel.mu - 0.5 * channel.sd ? "RECOVERY_TOO_LATE" : "EXPIRED";
            pending = null;
          }
          if (stretch && !lastStretch && !pending) {
            pending = { index: i, armLogRatio: y, armRsi: indicator.rsi[i], armK: indicator.k[i], armBBz: bb[i], simpleDone: false, crossDone: false };
            arms.push(pending);
          }
          if (pending && i > pending.index && known(i - 1) && y >= channel.breakLog && y <= channel.mu - 0.5 * channel.sd) {
            const rises = y > dir * x[i - 1] + 1e-12 && dir * (indicator.k[i] - indicator.k[i - 1]) > eps;
            const cross = rises && dir * (indicator.k[i] - indicator.d[i]) > eps && dir * (indicator.k[i - 1] - indicator.d[i - 1]) <= eps;
            const simpleHit = rises && !pending.simpleDone, crossHit = cross && !pending.crossDone;
            if (simpleHit || crossHit) {
              signals.push({ index: i, arm: { index: pending.index, armLogRatio: pending.armLogRatio, armRsi: pending.armRsi, armK: pending.armK, armBBz: pending.armBBz }, simple: simpleHit, cross: crossHit });
              if (simpleHit) {
                pending.simpleDone = true;
                pending.simpleConfirmation = i;
              }
              if (crossHit) {
                pending.crossDone = true;
                pending.crossConfirmation = i;
              }
              if (pending.simpleDone && pending.crossDone) pending = null;
            }
          }
          lastStretch = stretch;
        }
        return { arms, signals };
      }
      function generate(raw, registry) {
        const data = E.prepareData(raw), first = Date.parse(registry.periods[0].start) / E.DAY - 1, last = data.day1;
        const universe = E._test.weeklyUniverses(data, { ...C.DEFAULTS, startDay: first, endDay: last }), signals = [], arms = [], diag = { pairs: universe.pairs.size, pairWeeks: 0, channels: 0, arms: 0, candidates: 0, simple: 0, cross: 0, bottom: 0, top: 0, lifecycleExclusions: 0 };
        for (const pair of universe.pairs.values()) {
          const A = data.bySymbol.get(pair.a), B = data.bySymbol.get(pair.b), x = new Float64Array(data.n).fill(NaN), ratio = new Float64Array(data.n).fill(NaN);
          for (let i = 0; i < data.n; i++) if (A.close[i] > 0 && B.close[i] > 0) {
            ratio[i] = A.close[i] / B.close[i];
            x[i] = Math.log(ratio[i]);
          }
          const prefix = E._test.prefix(x);
          let indicator = null, bb = null;
          for (const w of pair.weeks) {
            if (w + 6 < first || w > last) continue;
            diag.pairWeeks++;
            const wi = w - data.day0, st = E._test.windowStats(x, prefix, wi - 180, wi);
            if (!st || st.sd < 0.03 || st.sd > 0.6 || st.df > -2.86 || st.r2 >= 0.5) continue;
            const osc = E._test.oscillator(x, prefix, wi - 180, wi);
            if (!C._test.qualityPass(st, osc)) continue;
            if (!indicator) {
              indicator = S.stoch(ratio);
              bb = bb20(ratio);
            }
            for (const dir of [1, -1]) {
              const channel = C.buildChannel(Array.from(x.slice(wi - 180, wi), (v) => dir * v), w - 180, { ...st, mu: dir * st.mu }, osc);
              if (!channel) continue;
              diag.channels++;
              channel.upperBreakLog = channel.peakDispersion.maxLog + 0.5 * channel.sd;
              const long = dir === 1 ? A : B, short = dir === 1 ? B : A, side = dir === 1 ? "bottom" : "top";
              const result = sequence(x, indicator, bb, channel, dir, wi, Math.min(wi + 6, data.n - 1));
              for (const arm of result.arms) {
                const day = data.day0 + arm.index;
                if (day - Math.max(long.listDay, short.listDay) < 365) continue;
                arms.push({ pair: pair.a + "/" + pair.b, side, weeklyDay: w, day, ...arm });
                diag.arms++;
              }
              for (const event of result.signals) {
                const day = data.day0 + event.index, i = event.index, y = dir * x[i];
                if (day < first || day - long.listDay < 365 || day - short.listDay < 365 || data.day0 + event.arm.index - Math.max(long.listDay, short.listDay) < 365) continue;
                const boundary = (day + 1) * E.DAY;
                if ([long, short].some((t) => t.deliveryTime > 0 && boundary + 1e3 >= t.deliveryTime)) {
                  diag.lifecycleExclusions++;
                  continue;
                }
                const ranks = universe.weeks.get(w).ranks;
                signals.push({ id: `${day}:${long.sym}/${short.sym}`, family: "channel", day, date: new Date(day * E.DAY).toISOString().slice(0, 10), signalTime: boundary - 1, signalAvailableTime: boundary, entryBoundary: boundary, long: long.sym, short: short.sym, entryZ: (y - channel.mu) / channel.sd, gap: Math.expm1(channel.mu - y), mu: channel.mu, sd: channel.sd, currentLogRatio: y, rawRatioChange: y - dir * x[i - 1], weeklyDay: w, rankLong: ranks.get(long.sym).rank, rankShort: ranks.get(short.sym).rank, minLiquidity: Math.min(ranks.get(long.sym).liq, ranks.get(short.sym).liq), chartA: pair.a, chartB: pair.b, chartSide: side, sequenceModes: { simple: event.simple, cross: event.cross }, sequence: { armDay: data.day0 + event.arm.index, armLogRatio: event.arm.armLogRatio, armRsi: event.arm.armRsi, armK: event.arm.armK, armBBz: event.arm.armBBz, confirmationRsi: indicator.rsi[i], confirmationK: indicator.k[i], confirmationD: indicator.d[i], confirmationBBz: bb[i] }, channel });
                diag.simple += Number(event.simple);
                diag.cross += Number(event.cross);
                diag.bottom += Number(side === "bottom");
                diag.top += Number(side === "top");
              }
            }
          }
        }
        signals.sort((a, b) => a.day - b.day || b.gap - a.gap || a.id.localeCompare(b.id));
        assert.equal(new Set(signals.map((s) => s.id)).size, signals.length);
        diag.candidates = signals.length;
        return { signals, arms, diagnostics: diag, universes: [...universe.weeks.values()].map((w) => ({ day: w.day, candidateCount: w.candidateCount, members: w.members })) };
      }
      if (__require.main === module) {
        const r = read(path.join(HERE, "registry.json")), out = path.join(HERE, r.signalSource);
        assert(!fs.existsSync(out));
        for (const i of r.inputs) assert.equal(hash(i.path), i.sha256);
        const paths = [path.join(HERE, "registry.json"), __filename, path.join(HERE, "../round8_stoch_range/stoch_v2.js"), path.resolve(HERE, r.sources.daily), path.join(HERE, "../round3/engine.js"), path.join(HERE, "../round2/channel_signals.js")], inputs = paths.map((p) => ({ path: p, sha256: hash(p) }));
        fs.writeFileSync(path.join(HERE, "data/signal_input_manifest.json"), JSON.stringify({ frozenBeforeGenerationAt: (/* @__PURE__ */ new Date()).toISOString(), inputs }) + "\n", { flag: "wx" });
        const result = generate(read(path.resolve(HERE, r.sources.daily)), r);
        result.inputs = inputs;
        result.createdAt = (/* @__PURE__ */ new Date()).toISOString();
        for (const i of inputs) assert.equal(hash(i.path), i.sha256);
        fs.writeFileSync(out, JSON.stringify(result) + "\n", { flag: "wx" });
        console.log(JSON.stringify(result.diagnostics));
      }
      module.exports = { generate, sequence, bb20 };
    }
  });

  // sites/pair-search-github/tools/core-browser-entry.cjs
  var require_core_browser_entry = __commonJS({
    "sites/pair-search-github/tools/core-browser-entry.cjs"(exports, module) {
      var fs = require_fs();
      var path = require_path();
      var PROJECT = "/project";
      var read = (p) => JSON.parse(fs.readFileSync(p));
      var E = require_engine();
      var F = require_features();
      var Scan = require_scan34();
      module.exports = function(snap, frame, kind, out) {
        const DAY = 864e5, Q = read(path.join(snap, "public.json")), D = read(path.join(snap, frame + ".json")), step = D.step, meta = new Map(Q.data.info.symbols.map((x) => [x.symbol, x]));
        let raw, warnings = [];
        if (frame === "daily") {
          const seed = read(path.join(PROJECT, "research/refinement/round5_hybrid/data/daily_context_v5.json"));
          raw = { ...seed, endDay: D.cutoffExclusive / DAY - 1, day1: D.cutoffExclusive / DAY - 1, symbols: seed.symbols.map((s) => ({ ...s, bars: [...s.bars] })) };
          const by = new Map(raw.symbols.map((s) => [s.sym, s]));
          for (const r of D.rows) {
            if (!r.complete) continue;
            const m = meta.get(r.symbol);
            if (!m) continue;
            let row = by.get(r.symbol);
            if (!row) {
              row = { sym: r.symbol, listDay: Math.floor(m.onboardDate / DAY), onboardTime: m.onboardDate, excludedByControl: E.EXCLUDED.has(r.symbol), status: m.status, deliveryTime: m.deliveryDate, bars: [] };
              raw.symbols.push(row);
              by.set(r.symbol, row);
            }
            const old = new Map(row.bars.map((b) => [b[0], b]));
            for (const b of r.bars) {
              const d = b[0] / DAY;
              if (d <= seed.endDay) continue;
              if (old.has(d)) throw Error("Duplicate immutable append");
              row.bars.push([d, ...b.slice(1, 6)]);
            }
          }
        } else {
          const end = D.cutoffExclusive / step - 1, start = end - Math.max(...D.rows.filter((r) => r.complete).map((r) => r.bars.length)) + 1;
          raw = { startDay: start, endDay: end, symbols: D.rows.filter((r) => r.complete && meta.has(r.symbol)).map((r) => ({ sym: r.symbol, listDay: Math.floor(meta.get(r.symbol).onboardDate / step), excludedByControl: E.EXCLUDED.has(r.symbol), bars: r.bars.map((b) => [b[0] / step, ...b.slice(1, 6)]) })) };
          warnings.push("New bar-clock research adaptation:180 selected-frame bars; episode/volume/indicator lookbacks measured in selected bars; universe ranking refresh every7bars.365-calendar-day listing age retained. Daily performance evidence does not transfer.");
        }
        const T = raw.endDay, config = { startDay: T, endDay: T, thetas: [3], minAge: frame === "daily" ? 365 : 365 * DAY / step };
        let output = { raw: [], channel: [], counts: {}, warnings };
        if (kind === "core") {
          const data = E.prepareData(raw), r = E.signals(data, config), strict = { ...F.BASELINE };
          output.counts = r.diagnostics;
          const sig = r.rows.filter((s) => E.qualifies(s, strict));
          let four = null;
          if (frame === "daily" && fs.existsSync(path.join(snap, "four.json"))) {
            const v = read(path.join(snap, "four.json"));
            four = { intervalMs: 144e5, symbols: v.rows.filter((r2) => r2.complete).map((r2) => ({ sym: r2.symbol, bars: r2.bars })) };
          }
          const built = F.buildFeatures(raw, sig, {}, four);
          const fm = new Map(built.rows.map((r2) => [r2.id, r2]));
          for (const s of r.rows) {
            let bounce = Scan.bounceFeature(data, s);
            output.raw.push({ ...s, strict: E.qualifies(s, strict), features: { ...fm.get(s.id)?.features || {}, bounceZ: bounce?.bounceZ ?? null }, missingReasons: fm.get(s.id)?.missingReasons || {} });
          }
          output.counts.strictPriceCandidates = sig.length;
          output.counts.unknownFundingCandidates = sig.length;
        } else {
          const reg = { periods: [{ start: new Date(T * DAY).toISOString().slice(0, 10) }] };
          const a = require_generate_v2().generate(raw, reg), b = require_generate().generate(raw, reg);
          const all = [...a.signals, ...b.signals].filter((s) => s.day === T);
          output.channel = all.filter((s) => [s.long, s.short].every((t) => T - Math.floor(meta.get(t)?.onboardDate / step) >= 365 * DAY / step));
          output.counts = { stoch: a.diagnostics, sequence: b.diagnostics, currentSignals: output.channel.length };
        }
        if (frame !== "daily") for (const s of [...output.raw, ...output.channel]) {
          s.barClockSignalTime = s.signalTime;
          s.signalTime = D.cutoffExclusive - 1;
        }
        fs.writeFileSync(out, JSON.stringify(output, null, 2));
      };
    }
  });
  return require_core_browser_entry();
})();
globalThis.pairCoreRun=PairNativeCore;
