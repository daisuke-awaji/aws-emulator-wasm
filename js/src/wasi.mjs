// A small WASI preview1 implementation: the imports the emulator build uses (16 before
// wasm-opt, 15 after). Any other preview1 function answers ENOSYS instead of failing to link.
// It has no Node or DOM dependencies, so the same code runs in a browser Worker and in Node.
//
// - No files: there are no preopened directories, so every file open fails.
// - stdout / stderr are line-buffered into `options.log`.
// - Clocks: in "virtual" mode (the default), a sleep (poll_oneoff on a clock) does not
//   block; it moves the emulator's clock forward instead. A browser Worker without
//   cross-origin isolation has no way to block (no SharedArrayBuffer for Atomics.wait),
//   and the emulator sleeps on purpose in places (DescribeTable waits out a 3-second
//   CREATING span). "real" mode blocks instead: with Atomics.wait where it is available
//   (Node), otherwise by spinning.
// - The monotonic clock counts from the UNIX epoch, not from page load, and never goes
//   back. A restored snapshot of the emulator's memory holds Instants from the earlier
//   page; with `options.resume` the clock carries on from where that page stopped.

const ERRNO_SUCCESS = 0;
const ERRNO_BADF = 8;
const ERRNO_INVAL = 28;
const ERRNO_NOSYS = 52;
const ERRNO_SPIPE = 70;
const ERRNO_NOTCAPABLE = 76;

const CLOCK_REALTIME = 0;
const CLOCK_MONOTONIC = 1;
const CLOCK_PROCESS_CPUTIME = 2;
const CLOCK_THREAD_CPUTIME = 3;

const EVENTTYPE_CLOCK = 0;
const SUBCLOCKFLAG_ABSTIME = 1;
const FILETYPE_CHARACTER_DEVICE = 2;

const NS_PER_MS = 1_000_000n;

export class WasiExit extends Error {
  constructor(code) {
    super(`wasm called proc_exit(${code})`);
    this.code = code;
  }
}

function msToNs(ms) {
  const whole = Math.floor(ms);
  return BigInt(whole) * NS_PER_MS + BigInt(Math.round((ms - whole) * 1e6));
}

function blockFor(ns) {
  const ms = Number(ns / NS_PER_MS);
  if (ms <= 0) return;
  if (typeof SharedArrayBuffer === 'function' && typeof Atomics?.wait === 'function') {
    try {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
      return;
    } catch {
      // Atomics.wait is not allowed on this thread (a browser main thread); spin instead.
    }
  }
  const until = performance.now() + ms;
  while (performance.now() < until) {
    // spin
  }
}

/**
 * @param {{
 *   env?: Record<string, string>,
 *   clock?: 'virtual' | 'real',
 *   log?: (stream: 'stdout' | 'stderr', line: string) => void,
 *   resume?: { skippedNs: bigint, monotonicNs: bigint },
 * }} [options]
 *   resume: the `clockState` of the instance whose memory is being restored.
 */
export function createWasi(options = {}) {
  const clockMode = options.clock ?? 'virtual';
  const log = options.log ?? ((stream, line) => (stream === 'stderr' ? console.warn : console.log)(line));
  const env = Object.entries(options.env ?? {}).map(([k, v]) => new TextEncoder().encode(`${k}=${v}\0`));
  const decoders = { 1: new TextDecoder(), 2: new TextDecoder() };
  const pending = { 1: '', 2: '' };

  /** @type {WebAssembly.Memory | undefined} */
  let memory;
  // Nanoseconds the clocks have been moved forward by virtual sleeps.
  let skippedNs = options.resume?.skippedNs ?? 0n;
  const epochNs = () => msToNs(performance.timeOrigin + performance.now());
  // Added to the monotonic clock if the system clock is now behind where the restored
  // instance stopped (the clock was set back between the two pages).
  const behindNs = options.resume ? options.resume.monotonicNs - (epochNs() + skippedNs) : 0n;
  const monotonicOffsetNs = behindNs > 0n ? behindNs : 0n;
  let lastMonotonicNs = options.resume?.monotonicNs ?? 0n;
  const monotonic = () => {
    const t = epochNs() + skippedNs + monotonicOffsetNs;
    if (t > lastMonotonicNs) lastMonotonicNs = t;
    return lastMonotonicNs;
  };

  const view = () => new DataView(memory.buffer);
  const bytes = () => new Uint8Array(memory.buffer);

  const now = (id) => {
    switch (id) {
      case CLOCK_REALTIME:
        return epochNs() + skippedNs;
      case CLOCK_MONOTONIC:
      case CLOCK_PROCESS_CPUTIME:
      case CLOCK_THREAD_CPUTIME:
        return monotonic();
      default:
        return undefined;
    }
  };

  const iovs = (ptr, len) => {
    const v = view();
    const out = [];
    for (let i = 0; i < len; i++) {
      out.push([v.getUint32(ptr + i * 8, true), v.getUint32(ptr + i * 8 + 4, true)]);
    }
    return out;
  };

  const writeLines = (fd, chunk) => {
    pending[fd] += decoders[fd].decode(chunk, { stream: true });
    const lines = pending[fd].split('\n');
    pending[fd] = lines.pop();
    for (const line of lines) log(fd === 1 ? 'stdout' : 'stderr', line);
  };

  const imports = {
    args_get: () => ERRNO_SUCCESS,
    args_sizes_get(argcPtr, bufSizePtr) {
      view().setUint32(argcPtr, 0, true);
      view().setUint32(bufSizePtr, 0, true);
      return ERRNO_SUCCESS;
    },
    environ_sizes_get(countPtr, sizePtr) {
      view().setUint32(countPtr, env.length, true);
      view().setUint32(sizePtr, env.reduce((n, e) => n + e.length, 0), true);
      return ERRNO_SUCCESS;
    },
    environ_get(environPtr, bufPtr) {
      for (const [i, entry] of env.entries()) {
        view().setUint32(environPtr + i * 4, bufPtr, true);
        bytes().set(entry, bufPtr);
        bufPtr += entry.length;
      }
      return ERRNO_SUCCESS;
    },
    clock_res_get(id, resPtr) {
      if (now(id) === undefined) return ERRNO_INVAL;
      view().setBigUint64(resPtr, 1000n, true);
      return ERRNO_SUCCESS;
    },
    clock_time_get(id, _precision, timePtr) {
      const t = now(id);
      if (t === undefined) return ERRNO_INVAL;
      view().setBigUint64(timePtr, t, true);
      return ERRNO_SUCCESS;
    },
    random_get(ptr, len) {
      // getRandomValues fills at most 65536 bytes per call.
      for (let off = 0; off < len; off += 65536) {
        crypto.getRandomValues(new Uint8Array(memory.buffer, ptr + off, Math.min(65536, len - off)));
      }
      return ERRNO_SUCCESS;
    },
    fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) {
      if (fd !== 1 && fd !== 2) return ERRNO_BADF;
      let n = 0;
      for (const [ptr, len] of iovs(iovsPtr, iovsLen)) {
        writeLines(fd, bytes().slice(ptr, ptr + len));
        n += len;
      }
      view().setUint32(nwrittenPtr, n, true);
      return ERRNO_SUCCESS;
    },
    fd_read(fd, _iovsPtr, _iovsLen, nreadPtr) {
      if (fd !== 0) return ERRNO_BADF;
      view().setUint32(nreadPtr, 0, true); // stdin is always at EOF
      return ERRNO_SUCCESS;
    },
    fd_close: (fd) => (fd <= 2 ? ERRNO_SUCCESS : ERRNO_BADF),
    fd_seek: (fd) => (fd <= 2 ? ERRNO_SPIPE : ERRNO_BADF),
    fd_fdstat_get(fd, statPtr) {
      if (fd > 2) return ERRNO_BADF;
      const v = view();
      v.setUint8(statPtr, FILETYPE_CHARACTER_DEVICE);
      v.setUint16(statPtr + 2, 0, true);
      v.setBigUint64(statPtr + 8, 0xffff_ffffn, true);
      v.setBigUint64(statPtr + 16, 0n, true);
      return ERRNO_SUCCESS;
    },
    fd_filestat_get(fd, statPtr) {
      if (fd > 2) return ERRNO_BADF;
      bytes().fill(0, statPtr, statPtr + 64);
      view().setUint8(statPtr + 16, FILETYPE_CHARACTER_DEVICE);
      return ERRNO_SUCCESS;
    },
    fd_prestat_get: () => ERRNO_BADF, // no preopened directories
    fd_prestat_dir_name: () => ERRNO_BADF,
    path_open: () => ERRNO_NOTCAPABLE,
    sched_yield: () => ERRNO_SUCCESS,
    proc_exit(code) {
      throw new WasiExit(code);
    },
    poll_oneoff(inPtr, outPtr, nsubs, neventsPtr) {
      if (nsubs === 0) return ERRNO_INVAL;
      const v = view();
      const subs = [];
      for (let i = 0; i < nsubs; i++) {
        const base = inPtr + i * 48;
        const userdata = v.getBigUint64(base, true);
        const tag = v.getUint8(base + 8);
        if (tag === EVENTTYPE_CLOCK) {
          const id = v.getUint32(base + 16, true);
          const timeout = v.getBigUint64(base + 24, true);
          const abs = (v.getUint16(base + 40, true) & SUBCLOCKFLAG_ABSTIME) !== 0;
          const start = now(id);
          if (start === undefined) {
            subs.push({ userdata, tag, error: ERRNO_INVAL });
          } else {
            subs.push({ userdata, tag, id, deadline: abs ? timeout : start + timeout });
          }
        } else {
          // fd_read / fd_write: there are no pollable files, so report them at once.
          subs.push({ userdata, tag, error: ERRNO_BADF });
        }
      }

      const immediate = subs.filter((s) => s.error !== undefined);
      let fired = immediate;
      if (immediate.length === 0) {
        const wait = subs.reduce((min, s) => {
          const left = s.deadline - now(s.id);
          return left < min ? left : min;
        }, subs[0].deadline - now(subs[0].id));
        if (wait > 0n) {
          if (clockMode === 'virtual') skippedNs += wait;
          else blockFor(wait);
        }
        fired = subs.filter((s) => now(s.id) >= s.deadline);
        if (fired.length === 0) fired = subs.slice(0, 1); // rounding: report the nearest one
      }

      for (const [i, s] of fired.entries()) {
        const base = outPtr + i * 32;
        bytes().fill(0, base, base + 32);
        v.setBigUint64(base, s.userdata, true);
        v.setUint16(base + 8, s.error ?? ERRNO_SUCCESS, true);
        v.setUint8(base + 10, s.tag);
      }
      v.setUint32(neventsPtr, fired.length, true);
      return ERRNO_SUCCESS;
    },
  };

  const nosys = new Map();
  const preview1 = new Proxy(imports, {
    get(target, name) {
      if (name in target || typeof name !== 'string') return target[name];
      if (!nosys.has(name)) nosys.set(name, () => ERRNO_NOSYS);
      return nosys.get(name);
    },
  });

  return {
    imports: { wasi_snapshot_preview1: preview1 },
    /** Points the imports at the instance's memory and runs its initializer. */
    initialize(instance) {
      memory = instance.exports.memory;
      instance.exports._initialize?.();
    },
    /** How far virtual sleeps have moved the clocks, in milliseconds. */
    get skippedMs() {
      return Number(skippedNs / NS_PER_MS);
    },
    /** What `options.resume` needs to carry the clocks over to a restored copy of this instance. */
    get clockState() {
      return { skippedNs, monotonicNs: monotonic() };
    },
  };
}
