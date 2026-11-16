// MSW hands every /api request to the Hono app in ../../api: the same app a Lambda Web
// Function serves in production (api/index.js). Only /api/emulator, which reports on the emulator for the
// SDK call log, is answered here.
import { http, HttpResponse } from 'msw/http';
import { getApp } from '../backend.js';
import { callsSince, inRoute } from '../calls.js';
import { emulator } from '../emulator.js';

/** Absolute URL of an API path under this page's base, e.g. api('todos/:id'). */
export const api = (path) => new URL(`api/${path}`, document.baseURI).href;

const UUID = /[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/g;

export const handlers = [
  // ?since=N adds the SDK calls answered after call N (see calls.js).
  http.get(api('emulator'), ({ request }) => {
    const since = new URL(request.url).searchParams.get('since');
    const body = { ...emulator.stats };
    if (since !== null) body.calls = callsSince(Number(since) || 0).slice(-200);
    return HttpResponse.json(body);
  }),

  http.all(api('*'), async ({ request }) => {
    // The app's routes start at /api, as in production; the page may live under a sub-path.
    const url = new URL(request.url);
    const path = `/${url.pathname.slice(new URL(document.baseURI).pathname.length)}`;
    try {
      // Tags the SDK calls this request makes, e.g. "PATCH /api/todos/:id".
      return await inRoute(`${request.method} ${path.replace(UUID, ':id')}`, async () => {
        const app = await getApp();
        return app.fetch(new Request(new URL(path + url.search, url.origin), request));
      });
    } catch (error) {
      // Setup failed: the emulator could not create the table, bucket or queue.
      console.error(error);
      return HttpResponse.json({ code: 'INTERNAL', message: `${error.name}: ${error.message}` }, { status: 500 });
    }
  }),
];
