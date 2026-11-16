// The REST API the Todo app calls, mocked with MSW. Each handler is a thin layer over
// backend.js, which talks to the in-browser AWS Emulator through the AWS SDK.
import { http, HttpResponse } from 'msw/http';
import * as backend from '../backend.js';
import { emulator } from '../emulator.js';

/** Absolute URL of an API path under this page's base, e.g. api('todos/:id'). */
export const api = (path) => new URL(`api/${path}`, document.baseURI).href;

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new backend.HttpError(400, 'リクエストの本文が JSON ではありません');
  }
}

/** Runs a handler after setup and turns errors into JSON error responses. */
const route = (fn) => async (info) => {
  try {
    await backend.ensureSetup();
    return await fn(info);
  } catch (error) {
    if (error instanceof backend.HttpError) {
      return HttpResponse.json({ message: error.message }, { status: error.status });
    }
    console.error(error);
    return HttpResponse.json({ message: `エミュレーターでエラーが起きました: ${error.name}: ${error.message}` }, { status: 500 });
  }
};

export const handlers = [
  http.get(api('todos'), route(async () => HttpResponse.json(await backend.list()))),
  http.post(api('todos'), route(async ({ request }) => HttpResponse.json(await backend.create(await readJson(request)), { status: 201 }))),
  http.patch(api('todos/:id'), route(async ({ params, request }) => HttpResponse.json(await backend.update(params.id, await readJson(request))))),
  http.delete(api('todos/:id'), route(async ({ params }) => {
    await backend.remove(params.id);
    return new HttpResponse(null, { status: 204 });
  })),
  http.get(api('todos/:id/note'), route(async ({ params }) => HttpResponse.text(await backend.getNote(params.id)))),
  http.put(api('todos/:id/note'), route(async ({ params, request }) => HttpResponse.json(await backend.putNote(params.id, await request.text())))),
  http.get(api('activity'), route(async () => HttpResponse.json(await backend.drainActivity()))),
  http.get(api('emulator'), () => HttpResponse.json({ ...emulator.stats })),
];
