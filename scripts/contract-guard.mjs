import { isAbsolute, relative, resolve } from "node:path";

const PAID_KEY_LINE =
  /^\s*(?:export\s+)?(GAUSSMERIDIAN_(?:GEMINI|OPENROUTER)_API_KEY)\s*[=:]\s*(.*)$/i;

const EMPTY_VALUE = /^(?:""|'')?\s*(?:#.*)?$/;

/** Names of the paid provider keys that have a non-empty value in an env file's text. Never returns values. */
export function paidKeysIn(text) {
  const names = new Set();

  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const match = line.match(PAID_KEY_LINE);

    if (match && !EMPTY_VALUE.test(match[2].trim())) names.add(match[1].toUpperCase());
  }

  return [...names];
}

export function isLoopbackUrl(value) {
  try {
    const host = new URL(value).hostname.replace(/^\[|\]$/g, "");

    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

export function isInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));

  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}
