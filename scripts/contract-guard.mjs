// The contract guard: a contract run talks to the real local engine and must never spend money.
// Everything here reports names only. No value of an environment variable or env file ever reaches a message.

import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { isIPv6 } from "node:net";
import { basename, dirname, join, resolve, sep } from "node:path";

export const PAID_KEYS = [
  "GAUSSMERIDIAN_GEMINI_API_KEY",
  "GAUSSMERIDIAN_OPENROUTER_API_KEY",
  "GAUSSMERIDIAN_OPENAI_API_KEY",
  "GAUSSMERIDIAN_ANTHROPIC_API_KEY",
  "GAUSSMERIDIAN_XAI_API_KEY",
  "GAUSSMERIDIAN_DEEPSEEK_API_KEY",
  "GAUSSMERIDIAN_MISTRAL_API_KEY",
  "GAUSSMERIDIAN_QWEN_API_KEY",
];
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

const DEFAULT_PROJECT = "meridian-engine";
const PROJECT_NAME = /^[a-z0-9][a-z0-9_-]*$/;
const CONTAINER_ID = /^[0-9a-f]{12,64}$/;
const LABEL = (name) => `{{index .Config.Labels "${name}"}}`;

// The only environment entries the proof may compare, each by exact equality inside the docker template, so the
// output is a token and never a value. Every paid key is compared with the public dummy of
// deploy/compose.simulator.yaml (which sets all eight) and nothing else.
const SIM_ENV = [
  ["gemini_base", "GAUSSMERIDIAN_GEMINI_BASE_URL=http://provider-sim:8184/v1beta"],
  ["openrouter_base", "GAUSSMERIDIAN_OPENROUTER_BASE_URL=http://provider-sim:8184/api/v1"],
  ["sim_flag", "GAUSSMERIDIAN_PROVIDER_SIMULATOR=true"],
  ["gemini_dummy", "GAUSSMERIDIAN_GEMINI_API_KEY=sim-local-key"],
  ["openrouter_dummy", "GAUSSMERIDIAN_OPENROUTER_API_KEY=sim-local-key"],
  ["openai_dummy", "GAUSSMERIDIAN_OPENAI_API_KEY=sim-local-key"],
  ["anthropic_dummy", "GAUSSMERIDIAN_ANTHROPIC_API_KEY=sim-local-key"],
  ["xai_dummy", "GAUSSMERIDIAN_XAI_API_KEY=sim-local-key"],
  ["deepseek_dummy", "GAUSSMERIDIAN_DEEPSEEK_API_KEY=sim-local-key"],
  ["mistral_dummy", "GAUSSMERIDIAN_MISTRAL_API_KEY=sim-local-key"],
  ["qwen_dummy", "GAUSSMERIDIAN_QWEN_API_KEY=sim-local-key"],
];

export const SIM_TEMPLATE = `{{range .Config.Env}}${SIM_ENV.map(([token, entry]) => `{{if eq . "${entry}"}}${token} {{end}}`).join("")}{{end}}`;
const ENV_FILE_TEMPLATE = LABEL("com.docker.compose.project.environment_file");

/** docker, with a fixed argv and no shell; its output is read here and never printed. */
function runDocker(args) {
  return spawnSync("docker", args, { encoding: "utf8", timeout: 20_000, windowsHide: true });
}

function ask(docker, args) {
  try {
    const done = docker(args);

    if (!done || done.error || done.status !== 0 || typeof done.stdout !== "string") return null;

    return done.stdout;
  } catch {
    return null;
  }
}

const lines = (text) => text.split(/\r?\n/).filter((line) => line.trim() !== "");

function urlPort(value, fallback) {
  const url = new URL(value ?? fallback);

  return url.port || (url.protocol === "https:" ? "443" : "80");
}

/**
 * Why the engine on this machine is not proven to be in simulator mode and started from this runtime's env file, or
 * null when it is. S1 provider-sim runs; S2 exactly one engine owns the public and admin ports on 127.0.0.1;
 * S3 its provider settings are the simulator's (exact comparisons inside the docker template, tokens out);
 * S4 it was started from the env file of this runtime (the compose label, or a marker of the runbook when the label
 * is absent). Any error counts as a refusal. Names only. `docker` takes an argv and returns a spawnSync result.
 */
export function simulatorProof(environ, runtime, { docker = runDocker } = {}) {
  const project = environ.GAUSSMERIDIAN_LOCAL_PROJECT || DEFAULT_PROJECT;

  if (!PROJECT_NAME.test(project))
    return "GAUSSMERIDIAN_LOCAL_PROJECT is not a plain project name.";
  const unasked = "the simulator cannot be proven: docker cannot be asked.";

  const running = (service) =>
    ask(docker, [
      "ps",
      "-q",
      "--filter",
      `label=com.docker.compose.project=${project}`,
      "--filter",
      `label=com.docker.compose.service=${service}`,
      "--filter",
      "status=running",
    ]);

  // [S1]
  const provider = running("provider-sim");

  if (provider === null) return unasked;
  const providers = lines(provider);

  if (providers.length !== 1 || !CONTAINER_ID.test(providers[0].trim()))
    return "provider-sim is not running exactly once, so this is not the simulator.";

  // [S2]
  const engines = running("engine");

  if (engines === null) return unasked;
  const found = lines(engines);

  if (found.length !== 1 || !CONTAINER_ID.test(found[0].trim()))
    return "there is not exactly one engine container running.";
  const id = found[0].trim();
  let wanted;

  try {
    wanted = {
      "8180/tcp": urlPort(environ.MERIDIAN_PUBLIC_URL, DEFAULT_URLS.MERIDIAN_PUBLIC_URL),
      "8181/tcp": urlPort(environ.MERIDIAN_ADMIN_URL, DEFAULT_URLS.MERIDIAN_ADMIN_URL),
    };
  } catch {
    return "MERIDIAN_PUBLIC_URL or MERIDIAN_ADMIN_URL cannot be read, so the engine ports cannot be compared.";
  }

  for (const [port, host] of Object.entries(wanted)) {
    const bound = ask(docker, ["port", id, port]);

    if (bound === null) return unasked;
    const bindings = lines(bound).map((line) => line.trim());

    if (bindings.length !== 1 || bindings[0] !== `127.0.0.1:${host}`)
      return "the engine does not own the public and admin ports on 127.0.0.1 (ports differ from the URLs).";
  }

  // [S3]
  const printed = ask(docker, ["inspect", id, "--format", SIM_TEMPLATE]);

  if (printed === null) return unasked;
  const tokens = printed.split(/\s+/).filter(Boolean);
  const missing = SIM_ENV.map(([token]) => token).filter((token) => !tokens.includes(token));

  if (missing.length > 0)
    return `the engine is not set up for the simulator (missing: ${missing.join(", ")}).`;
  if (tokens.length !== SIM_ENV.length) return "the engine is not set up for the simulator.";

  // [S4]
  const label = ask(docker, ["inspect", id, "--format", ENV_FILE_TEMPLATE]);

  if (label === null) return unasked;
  const mine = environ.GAUSSMERIDIAN_ENV_FILE || join(runtime, ENV_FILE);
  const stated = label.trim();
  const refused = "the engine was not started from the env file of this runtime.";

  try {
    if (stated !== "") return real(stated) === real(mine) ? null : refused;

    // No label: the runbook's marker, written in the runtime folder after local-up, holds this engine's id
    const marker = readFileSync(join(runtime, `.sim-started-${id}`), "utf8").trim();

    return CONTAINER_ID.test(marker) && (marker.startsWith(id) || id.startsWith(marker))
      ? null
      : refused;
  } catch {
    return refused;
  }
}

/**
 * Why a contract run must not start, or null when it may. Names only; never a value, path or URL.
 * `registry` returns the Windows registry's proxy entries and `docker` runs docker (both injectable; tests never
 * read this machine's registry or call docker).
 */
export function refusal(environ, { registry = readRegistryProxies, docker = runDocker } = {}) {
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

  // [4.5] The engine must be proven to be the simulator, started from this runtime's env file. After the URLs, so
  //       the ports it compares are loopback ones.
  const unproven = simulatorProof(environ, runtime, { docker });

  if (unproven !== null) return unproven;

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
