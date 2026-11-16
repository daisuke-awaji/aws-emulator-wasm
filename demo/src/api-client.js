// The page's only way to the REST API. In the emulator build the path is relative to the
// page (MSW answers it); in the AWS build it goes to VITE_API_URL with the user's token.
import { has, t } from './i18n.js';
import { API_URL, TARGET } from './target.js';

let accessToken = async () => undefined;
let onUnauthorized = () => {};

/** Set by the AWS runtime: where the bearer token comes from, and what a 401 does. */
export function configureAuth({ token, unauthorized }) {
  accessToken = token;
  onUnauthorized = unauthorized;
}

const base = () => (API_URL ? new URL(API_URL.endsWith('/') ? API_URL : `${API_URL}/`) : new URL(document.baseURI));

/** Calls `api/<path>`; throws an Error with a message in the page's language. */
export async function call(path, { method = 'GET', json, text } = {}) {
  const init = { method, headers: {} };
  if (json !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(json);
  } else if (text !== undefined) {
    init.headers['content-type'] = 'text/plain; charset=utf-8';
    init.body = text;
  }
  const token = await accessToken();
  if (token) init.headers.authorization = `Bearer ${token}`;
  const res = await fetch(new URL(`api/${path}`, base()), init);
  if (!res.ok) {
    if (res.status === 401) onUnauthorized();
    // The API answers { code, message, ...params }; show the code's message in the page's language.
    const body = await res.json().catch(() => ({}));
    // The AWS build has its own wording where the emulator's would be wrong (aws.api.*).
    const key = [`${TARGET}.api.${body.code}`, `api.${body.code}`].find((k) => body.code && has(k));
    if (key) throw new Error(t(key, body));
    throw new Error(body.message ?? `${method} api/${path}: ${res.status}`);
  }
  if (res.status === 204) return null;
  return (res.headers.get('content-type') ?? '').includes('json') ? res.json() : res.text();
}
