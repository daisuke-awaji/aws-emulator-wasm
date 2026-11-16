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
// Every route needs a user: `authenticate` turns the request into a user id or throws a
// 401. Errors are JSON: { code, message, ...params } (see errors.js).
import { Hono } from 'hono';
import { ApiError } from './errors.js';
import { createTodos } from './todos.js';

/**
 * @param {Parameters<typeof createTodos>[0] & {
 *   authenticate: (c: import('hono').Context) => string | Promise<string>,
 *   middleware?: import('hono').MiddlewareHandler[],
 *   exposeErrors?: boolean,
 *   log?: (error: unknown, c?: import('hono').Context) => void,
 * }} deps
 *   authenticate: the user id for the request, or throw ApiError(401). There is no default,
 *     so an app is never built without deciding who its callers are.
 *   middleware: runs before authentication, e.g. CORS (which must answer preflights).
 *   exposeErrors: put the message of an unexpected error in the 500 response (fine for the
 *     in-browser demo; keep it off in production).
 */
export function createApp({ authenticate, middleware = [], exposeErrors = false, log = console.error, ...deps }) {
  if (typeof authenticate !== 'function') throw new TypeError('createApp needs authenticate');
  const todosFor = createTodos(deps);
  const app = new Hono();

  for (const m of middleware) app.use('*', m);
  app.use('/api/*', async (c, next) => {
    c.set('todos', todosFor(await authenticate(c)));
    await next();
  });

  const json = async (c) => {
    try {
      return await c.req.json();
    } catch {
      throw new ApiError(400, 'BAD_JSON');
    }
  };
  const todos = (c) => c.get('todos');

  app.get('/api/todos', async (c) => c.json(await todos(c).list()));
  app.post('/api/todos', async (c) => c.json(await todos(c).create(await json(c)), 201));
  app.patch('/api/todos/:id', async (c) => c.json(await todos(c).update(c.req.param('id'), await json(c))));
  app.delete('/api/todos/:id', async (c) => {
    await todos(c).remove(c.req.param('id'));
    return c.body(null, 204);
  });
  app.get('/api/todos/:id/note', async (c) => c.text(await todos(c).getNote(c.req.param('id'))));
  app.put('/api/todos/:id/note', async (c) => c.json(await todos(c).putNote(c.req.param('id'), await c.req.text())));
  app.get('/api/activity', async (c) => c.json(await todos(c).drainActivity()));

  app.notFound((c) => c.json({ code: 'NO_ROUTE', message: `No route for ${c.req.method} ${c.req.path}` }, 404));
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      if (error.status === 401) c.header('WWW-Authenticate', 'Bearer');
      return c.json(error.toJSON(), error.status);
    }
    log(error, c);
    const message = exposeErrors ? `${error.name}: ${error.message}` : 'Internal error';
    return c.json({ code: 'INTERNAL', message }, 500);
  });

  return app;
}
