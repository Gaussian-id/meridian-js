// The contract guard: a contract run talks to the real local engine and must never spend money.
// Everything here reports names only. No value of an environment variable or env file ever reaches a message.

import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { isIPv6 } from "node:net";
import { basename, dirname, join, resolve, sep } from "node:path";

export const PAID_KEYS = ["GAUSSMERIDIAN_GEMINI_API_KEY", "GAUSSMERIDIAN_OPENROUTER_API_KEY"];
export const KEY_FILES = ["local-api-key.txt", "local-integrator-key.txt"];
export const ENV_FILE = "meridian-engine.env";
export const DEFAULT_URLS = {
  MERIDIAN_PUBLIC_URL: "http://127.0.0.1:8180",
  MERIDIAN_ADMIN_URL: "http://127.0.0.1:8181",
};
const PROXY_SCHEMES = ["http", "https", "all"];

// What a line may hold. Anything else is skipped, folded or split at differently by one of the readers (compose
// takes NBSP and NEL as blank and matches a dotted capital I to I; the culture-sensitive StartsWith of
// local-common.ps1 skips controls, marks and some letters; a lone CR ends a line for pwsh but not for compose or
// bash), so it is refused.
const PRINTABLE = /^[\t\x20-\x7e]*$/;
const LOWER = PAID_KEYS.map((name) => name.toLowerCase());

// The only line with a paid name that leaves it unset: `[export |set ]NAME =` (or `:`), then nothing or `""`.
// Two single quotes are a value: both local-up readers strip double quotes only.
const EMPTY = new RegExp(`^(?:(?:export|set)[ \\t]+)?(?:${LOWER.join("|")})[ \\t]*[=:](?:"")?$`);

/**
 * Names of the paid provider keys an env file's text may set. Never returns values. Not a parser but an allowlist:
 * a text with any character outside printable ASCII and tab (after one leading byte order mark; a lone CR included)
 * cannot be checked and reports both names. Otherwise a line that names a paid key, in any letter case, sets it
 * unless the line is exactly an empty assignment, so a whitespace-only value and `''` are set. A comment line is
 * skipped unless it holds a quote, which may close a quoted value.
 */
export function paidKeysIn(text) {
  const lines = (text.startsWith("﻿") ? text.slice(1) : text).split(/\r\n|\n/);

  if (!lines.every((line) => PRINTABLE.test(line))) return [...PAID_KEYS];
  const names = [];

  for (const line of lines) {
    const lowered = line.toLowerCase();
    const comment = lowered.replace(/^[ \t]+/, "").startsWith("#") && !/["'`]/.test(line);

    if (comment || EMPTY.test(lowered)) continue;
    PAID_KEYS.forEach((name, at) => {
      if (lowered.includes(LOWER[at]) && !names.includes(name)) names.push(name);
    });
  }

  return names;
}

/** Names of the paid provider keys that are non-empty in a process environment, in any letter case. */
export function paidKeysInEnviron(environ) {
  const names = [];

  for (const [name, value] of Object.entries(environ)) {
    const upper = name.toUpperCase();

    if (
      PAID_KEYS.includes(upper) &&
      value !== "" &&
      value !== undefined &&
      !names.includes(upper)
    ) {
      names.push(upper);
    }
  }

  return names;
}

function isLoopbackIpv4(host) {
  const parts = host.split(".");

  // Strict dotted quad: every decimal, hex, octal and short spelling is refused
  if (parts.length !== 4 || !parts.every((part) => /^(?:0|[1-9]\d{0,2})$/.test(part))) return false;

  return parts.every((part) => Number(part) <= 255) && parts[0] === "127";
}

function isLoopbackIpv6(host) {
  if (!isIPv6(host)) return false;
  const canonical = new URL(`http://[${host}]`).hostname;
  const mapped = /^\[::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}\]$/.exec(canonical);

  // IPv4-mapped IPv6 is judged by its IPv4 part
  return canonical === "[::1]" || (mapped !== null && parseInt(mapped[1], 16) >> 8 === 127);
}

/**
 * An http(s) URL whose host, as written, is localhost, an address in 127.0.0.0/8 or ::1. No userinfo, no
 * whitespace, control or non-ASCII characters, no `%` or `\`, no alternative IP spellings. `localhost` is accepted
 * because the engine's own docs use it, but it is resolved by the system resolver, which the guard does not
 * control; literal 127.0.0.1 or ::1 is preferred.
 */
export function isLoopbackUrl(value) {
  if (typeof value !== "string" || !/^[\x21-\x7e]*$/.test(value) || /[%\\]/.test(value))
    return false;
  const match = /^https?:\/\/([^/?#]*)(?:[/?#].*)?$/i.exec(value);

  if (!match || match[1].includes("@")) return false;
  const netloc = match[1];
  const bracketed = /^\[([^\]]*)\](?::(.*))?$/.exec(netloc);

  if (bracketed) return isPort(bracketed[2]) && isLoopbackIpv6(bracketed[1]);
  const colon = netloc.indexOf(":");
  const host = colon < 0 ? netloc : netloc.slice(0, colon);
  const port = colon < 0 ? undefined : netloc.slice(colon + 1);

  return isPort(port) && (host.toLowerCase() === "localhost" || isLoopbackIpv4(host));
}

function isPort(port) {
  return port === undefined || (/^\d*$/.test(port) && Number(port) <= 65535);
}

const normcase = (path) =>
  process.platform === "win32" ? path.replaceAll("/", "\\").toLowerCase() : path;

/** A path after `..`, symlinks and junctions, as far as it exists; the rest is kept as spelled. */
function real(path) {
  let head = resolve(path);
  const tail = [];

  for (let links = 0; ;) {
    try {
      return normcase(join(realpathSync.native(head), ...tail));
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
    }

    // A dangling link is followed to where it points
    let link = null;

    try {
      if (lstatSync(head).isSymbolicLink()) link = readlinkSync(head);
    } catch {
      link = null;
    }

    if (link !== null) {
      if (++links > 40) throw new Error("too many links");
      head = resolve(dirname(head), link);
      continue;
    }

    const parent = dirname(head);

    if (parent === head) return normcase(join(head, ...tail));
    tail.unshift(basename(head));
    head = parent;
  }
}

/** Whether child, after symlinks, junctions and `..`, is strictly below parent. Anything unresolvable is not. */
export function isInside(parent, child) {
  try {
    if (String(parent).includes("\0") || String(child).includes("\0")) return false;
    const p = real(parent);
    const c = real(child);

    return c !== p && c.startsWith(p.endsWith(sep) ? p : p + sep);
  } catch {
    return false;
  }
}

/** The folder the engine's local scripts keep their secrets in, found the way local-common does. */
export function runtimeDir(environ) {
  if (environ.LOCALAPPDATA) return join(environ.LOCALAPPDATA, "Gaussian", "MeridianEngine");
  if (environ.XDG_STATE_HOME) return join(environ.XDG_STATE_HOME, "gaussian", "meridian-engine");
  if (environ.HOME) return join(environ.HOME, ".local", "state", "gaussian", "meridian-engine");

  return null;
}

const INTERNET_SETTINGS = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";

/**
 * The proxy entries of the Windows registry (Internet Settings), as `{scheme: server}`, read the way Python's
 * getproxies_registry does: nothing unless ProxyEnable is on; a bare server serves http, https and ftp. An entry
 * without a scheme is kept under `registry`. Throws when the registry cannot be asked. Not on Windows: none.
 */
export function readRegistryProxies(run = spawnSync, platform = process.platform) {
  if (platform !== "win32") return {};

  const query = (name) => {
    const done = run("reg", ["query", INTERNET_SETTINGS, "/v", name], { encoding: "utf8" });

    if (done.error) throw new Error("the registry cannot be read");
    if (done.status !== 0) return null; // the value is not there

    const found = new RegExp(`^\\s+${name}\\s+REG_\\w+\\s+(.*?)\\s*$`, "im").exec(
      done.stdout ?? "",
    );

    return found ? found[1] : null;
  };

  const enable = query("ProxyEnable");

  if (enable === null || !Number(enable)) return {};
  const server = query("ProxyServer") ?? "";
  const entries = {};

  if (!server.includes("=") && !server.includes(";")) {
    return server ? { http: server, https: server, ftp: server } : {};
  }

  for (const item of server.split(";").filter(Boolean)) {
    const at = item.indexOf("=");

    if (at < 0) entries.registry = item;
    else entries[item.slice(0, at).toLowerCase()] = item.slice(at + 1);
  }

  return entries;
}

/**
 * Schemes (http, https, all) for which a proxy is configured in the environment (any letter case) or the registry
 * entries, plus `registry` for any other proxy server entry there (socks, ftp, ...). Names only; a proxy would carry
 * the suite's traffic and local keys off-machine.
 */
export function proxySchemes(environ, entries) {
  const schemes = PROXY_SCHEMES.filter(
    (scheme) =>
      Boolean(entries[scheme]) ||
      Object.entries(environ).some(
        ([name, value]) => value && name.toLowerCase() === `${scheme}_proxy`,
      ),
  );

  if (Object.entries(entries).some(([name, value]) => value && !PROXY_SCHEMES.includes(name))) {
    schemes.push("registry");
  }

  return schemes;
}

function exists(path) {
  try {
    lstatSync(path);

    return true;
  } catch {
    return false;
  }
}

/** Names in an env file, or null when it cannot be read as UTF-8 text (so it cannot be checked). */
function paidKeysInFile(path) {
  try {
    const data = readFileSync(path);

    // UTF-16 and binary files hide names from a text scan
    if (data.includes(0)) return null;

    // paidKeysIn drops one byte order mark and refuses a second
    return paidKeysIn(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data));
  } catch {
    return null;
  }
}

/**
 * Why a contract run must not start, or null when it may. Names only; never a value, path or URL.
 * `registry` returns the Windows registry's proxy entries (injectable; tests never read this machine's).
 */
export function refusal(environ, { registry = readRegistryProxies } = {}) {
  // [1] The runtime folder the engine's scripts use is the only place the guard trusts
  const runtime = runtimeDir(environ);

  if (runtime === null) {
    return "the local runtime folder cannot be located (set LOCALAPPDATA, XDG_STATE_HOME or HOME).";
  }

  // [2] Every path the run reads from must resolve inside it
  const folder = environ.MERIDIAN_RUNTIME_DIR || runtime;
  let same;

  try {
    same = real(folder) === real(runtime);
  } catch {
    same = false;
  }

  if (!same && !isInside(runtime, folder))
    return "MERIDIAN_RUNTIME_DIR resolves outside the local runtime folder.";
  const canonical = join(runtime, ENV_FILE);
  const engineEnv = environ.GAUSSMERIDIAN_ENV_FILE || canonical;

  if (!isInside(runtime, engineEnv))
    return "GAUSSMERIDIAN_ENV_FILE resolves outside the local runtime folder.";

  for (const name of KEY_FILES) {
    const keyFile = join(folder, name);

    if (exists(keyFile) && !isInside(runtime, keyFile))
      return `${name} resolves outside the local runtime folder.`;
  }

  // [3] No paid provider key may be set: not in the process, and not in any env file the engine or the suite could
  //     read: the canonical one, the runtime dir's own, and the override (a clean decoy must not hide the others).
  //     Only the file the engine would read has to exist.
  const names = paidKeysInEnviron(environ);
  const checked = new Set();

  try {
    const required = real(engineEnv);

    for (const envFile of [engineEnv, canonical, join(folder, ENV_FILE)]) {
      const key = real(envFile);

      if (checked.has(key)) continue;
      checked.add(key);

      if (!exists(envFile)) {
        if (key === required)
          return "the engine env file is missing, so it cannot be checked for provider keys.";
        continue;
      }

      const found = paidKeysInFile(envFile);

      if (found === null) {
        return "the engine env file cannot be read as UTF-8 text, so it cannot be checked for provider keys.";
      }

      names.push(...found.filter((name) => !names.includes(name)));
    }
  } catch {
    return "the engine env file cannot be read as UTF-8 text, so it cannot be checked for provider keys.";
  }

  if (names.length > 0)
    return `${names.join(", ")} is set, so the engine would call a paid provider.`;

  // [4] Only a loopback engine
  for (const name of ["MERIDIAN_PUBLIC_URL", "MERIDIAN_ADMIN_URL", "MERIDIAN_URL"]) {
    const value = environ[name] ?? DEFAULT_URLS[name];

    if (value !== undefined && !isLoopbackUrl(value)) {
      return `${name} is not a loopback URL (localhost, 127.0.0.0/8 or ::1).`;
    }
  }

  // [5] No proxy between the suite and the engine; a registry that cannot be read counts as one
  let entries;

  try {
    entries = registry();
  } catch {
    entries = { unreadable: "1" };
  }

  const proxies = proxySchemes(environ, entries);

  if (proxies.length > 0) {
    return `a proxy is configured (${proxies.join(", ")}), so traffic and the local keys could leave this machine.`;
  }

  return null;
}
