// The REST API, as a Hono app. It is the whole backend: in the browser MSW hands it each
// request (src/mocks/handlers.js); in production it is the HTTP server a Lambda Web
// Function runs (index.js, server.js).
//
//   GET    /api/todos             list
//   POST   /api/todos             { title }            -> 201 todo
//   PATCH  /api/todos/:id         { title?, done? }    -> todo
//   DELETE /api/todos/:id                              -> 204
//   GET    /api/todos/:id/note                         -> text/plain
//   PUT    /api/todos/:id/note    text/plain           -> todo
//   GET    /api/activity          change events since the last call (drained from SQS)
//
// Errors are JSON: { code, message, ...params } (see errors.js).
import { Hono } from 'hono';
import { ApiError } from './errors.js';
import { createTodos } from './todos.js';

/**
 * @param {Parameters<typeof createTodos>[0] & { exposeErrors?: boolean, log?: (error: unknown, c?: import('hono').Context) => void }} deps
 *   exposeErrors: put the message of an unexpected error in the 500 response (fine for the
 *   in-browser demo; keep it off in production).
 */
export function createApp({ exposeErrors = false, log = console.error, ...deps }) {
  const todos = createTodos(deps);
  const app = new Hono();

  const json = async (c) => {
    try {
      return await c.req.json();
    } catch {
      throw new ApiError(400, 'BAD_JSON');
    }
  };

  app.get('/api/todos', async (c) => c.json(await todos.list()));
  app.post('/api/todos', async (c) => c.json(await todos.create(await json(c)), 201));
  app.patch('/api/todos/:id', async (c) => c.json(await todos.update(c.req.param('id'), await json(c))));
  app.delete('/api/todos/:id', async (c) => {
    await todos.remove(c.req.param('id'));
    return c.body(null, 204);
  });
  app.get('/api/todos/:id/note', async (c) => c.text(await todos.getNote(c.req.param('id'))));
  app.put('/api/todos/:id/note', async (c) => c.json(await todos.putNote(c.req.param('id'), await c.req.text())));
  app.get('/api/activity', async (c) => c.json(await todos.drainActivity()));

  app.notFound((c) => c.json({ code: 'NO_ROUTE', message: `No route for ${c.req.method} ${c.req.path}` }, 404));
  app.onError((error, c) => {
    if (error instanceof ApiError) return c.json(error.toJSON(), error.status);
    log(error, c);
    const message = exposeErrors ? `${error.name}: ${error.message}` : 'Internal error';
    return c.json({ code: 'INTERNAL', message }, 500);
  });

  return Object.assign(app, { todos });
}
