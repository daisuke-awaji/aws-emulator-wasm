import { useCallback, useEffect, useRef, useState } from 'react';
import { Architecture } from './Architecture.jsx';

const REPO = 'https://github.com/daisuke-awaji/aws-emulator-wasm';

const EVENT_LABELS = {
  created: '追加',
  completed: '完了',
  reopened: '未完了に戻す',
  renamed: '名前を変更',
  noted: 'メモを更新',
  deleted: '削除',
};

/** Calls the mocked REST API (relative to the page, so it works under any base path). */
async function call(path, { method = 'GET', json, text } = {}) {
  const init = { method, headers: {} };
  if (json !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(json);
  } else if (text !== undefined) {
    init.headers['content-type'] = 'text/plain; charset=utf-8';
    init.body = text;
  }
  const res = await fetch(`api/${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `${method} api/${path}: ${res.status}`);
  }
  if (res.status === 204) return null;
  return (res.headers.get('content-type') ?? '').includes('json') ? res.json() : res.text();
}

function useElapsed(running) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    const started = performance.now();
    const timer = setInterval(() => setSeconds((performance.now() - started) / 1000), 100);
    return () => clearInterval(timer);
  }, [running]);
  return seconds;
}

export function App({ mocking, readyIn }) {
  const [boot, setBoot] = useState({ state: 'loading' });
  const elapsed = useElapsed(boot.state === 'loading');

  useEffect(() => {
    Promise.all([mocking, readyIn]).then(
      ([, ms]) => setBoot({ state: 'ready', ms }),
      (error) => setBoot({ state: 'failed', message: String(error?.message ?? error) }),
    );
  }, [mocking, readyIn]);

  return (
    <div className="page">
      <header>
        <h1>Todo</h1>
        <p className="lead">
          サーバーなしで動く Todo です。画面の通信は MSW が受け取り、ハンドラが AWS SDK v3 で
          <strong>ブラウザ内の AWS Emulator（wasm）</strong>を呼びます。Todo は DynamoDB、メモは S3、変更の記録は SQS に入ります。
        </p>
        <Architecture state={boot.state} />
      </header>

      {boot.state === 'loading' && (
        <section className="boot" role="status" aria-live="polite">
          <div className="spinner" aria-hidden="true" />
          <p>エミュレーターを読み込んでいます… {elapsed.toFixed(1)} 秒</p>
          <p className="muted">初回は wasm（約 9 MB、圧縮後）をダウンロードします。</p>
        </section>
      )}
      {boot.state === 'failed' && (
        <section className="error" role="alert">
          <h2>エミュレーターを起動できませんでした</h2>
          <pre>{boot.message}</pre>
        </section>
      )}
      {boot.state === 'ready' && <Todos bootMs={boot.ms} />}

      <footer>
        <p>
          <a href="sdk.html">SDK の往復テスト（DynamoDB・S3・SQS）</a>
          <span aria-hidden="true"> ・ </span>
          <a href={REPO}>GitHub</a>
        </p>
        <p>状態はページを再読み込みすると消えます（保存は今後の Phase で対応します）。</p>
      </footer>
    </div>
  );
}

function Todos({ bootMs }) {
  const [todos, setTodos] = useState(null);
  const [error, setError] = useState('');
  const [activity, setActivity] = useState([]);
  const [stats, setStats] = useState(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef(null);

  const refresh = useCallback(async () => {
    const [list, events, emu] = await Promise.all([call('todos'), call('activity'), call('emulator')]);
    setTodos(list);
    if (events.length) setActivity((old) => [...events.reverse(), ...old].slice(0, 30));
    setStats(emu);
  }, []);

  /** Runs one change, then reloads the list, the activity and the stats. */
  const run = useCallback(
    async (fn) => {
      setBusy(true);
      setError('');
      try {
        await fn();
        await refresh();
        return true;
      } catch (e) {
        setError(e.message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  useEffect(() => {
    run(async () => {});
  }, [run]);

  const add = async (event) => {
    event.preventDefault();
    if (await run(() => call('todos', { method: 'POST', json: { title } }))) {
      setTitle('');
      input.current?.focus();
    }
  };

  const remaining = todos?.filter((t) => !t.done).length ?? 0;

  return (
    <main>
      <form className="add" onSubmit={add}>
        <label htmlFor="new-title" className="visually-hidden">
          新しい Todo
        </label>
        <input
          id="new-title"
          ref={input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="新しい Todo を入力"
          maxLength={200}
          autoComplete="off"
        />
        <button type="submit" disabled={busy}>
          追加
        </button>
      </form>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {todos === null ? (
        <p className="muted">読み込み中…</p>
      ) : (
        <>
          <p className="count" aria-live="polite">
            残り {remaining} 件 / 全 {todos.length} 件
          </p>
          <ul className="todos" aria-label="Todo の一覧">
            {todos.map((todo) => (
              <TodoItem key={todo.id} todo={todo} run={run} busy={busy} />
            ))}
          </ul>
          {todos.length === 0 && <p className="muted">Todo はありません。</p>}
        </>
      )}

      <section className="activity" aria-labelledby="activity-title">
        <h2 id="activity-title">変更の記録（SQS から受信）</h2>
        {activity.length === 0 ? (
          <p className="muted">まだありません。</p>
        ) : (
          <ol aria-label="変更の記録">
            {activity.map((e, i) => (
              <li key={`${e.at}-${e.id}-${i}`}>
                <time dateTime={e.at}>{new Date(e.at).toLocaleTimeString('ja-JP')}</time>
                <span className={`tag tag-${e.type}`}>{EVENT_LABELS[e.type] ?? e.type}</span>
                <span className="event-title">{e.title}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {stats && (
        <dl className="stats" aria-label="エミュレーター">
          <div>
            <dt>起動</dt>
            <dd>{(bootMs / 1000).toFixed(1)} 秒</dd>
          </div>
          <div>
            <dt>SDK の呼び出し</dt>
            <dd data-testid="requests">{stats.requests} 回</dd>
          </div>
          <div>
            <dt>仮想時計で進めた時間</dt>
            <dd>{(stats.skippedMs / 1000).toFixed(1)} 秒</dd>
          </div>
        </dl>
      )}
    </main>
  );
}

function TodoItem({ todo, run, busy }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(todo.title);
  const [note, setNote] = useState(null); // null: closed; string: open
  // The checkbox follows a click at once; the list reload then confirms (or reverts) it.
  const [done, setDone] = useState(todo.done);
  useEffect(() => setDone(todo.done), [todo.done]);

  const toggle = async () => {
    const next = !done;
    setDone(next);
    if (!(await run(() => call(`todos/${todo.id}`, { method: 'PATCH', json: { done: next } })))) setDone(todo.done);
  };

  const save = async (event) => {
    event.preventDefault();
    if (await run(() => call(`todos/${todo.id}`, { method: 'PATCH', json: { title: draft } }))) setEditing(false);
  };

  const openNote = () =>
    run(async () => {
      setNote(await call(`todos/${todo.id}/note`));
    });

  const saveNote = async () => {
    if (await run(() => call(`todos/${todo.id}/note`, { method: 'PUT', text: note }))) setNote(null);
  };

  return (
    <li className={done ? 'todo done' : 'todo'}>
      <div className="row">
        <input
          type="checkbox"
          checked={done}
          disabled={busy}
          aria-label={`「${todo.title}」を${done ? '未完了に戻す' : '完了にする'}`}
          onChange={toggle}
        />
        {editing ? (
          <form className="edit" onSubmit={save}>
            <label className="visually-hidden" htmlFor={`edit-${todo.id}`}>
              タイトル
            </label>
            <input id={`edit-${todo.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={200} autoFocus />
            <button type="submit" disabled={busy}>
              保存
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setDraft(todo.title);
                setEditing(false);
              }}
            >
              やめる
            </button>
          </form>
        ) : (
          <span className="title">{todo.title}</span>
        )}
        {!editing && (
          <div className="actions">
            <button type="button" className="ghost" onClick={() => {
                setDraft(todo.title);
                setEditing(true);
              }}
              aria-label={`「${todo.title}」を編集`}>
              編集
            </button>
            <button
              type="button"
              className={todo.hasNote ? 'ghost has-note' : 'ghost'}
              onClick={note === null ? openNote : () => setNote(null)}
              aria-expanded={note !== null}
              aria-label={`「${todo.title}」のメモ`}
            >
              {todo.hasNote ? 'メモあり' : 'メモ'}
            </button>
            <button
              type="button"
              className="ghost danger"
              disabled={busy}
              onClick={() => run(() => call(`todos/${todo.id}`, { method: 'DELETE' }))}
              aria-label={`「${todo.title}」を削除`}
            >
              削除
            </button>
          </div>
        )}
      </div>
      {note !== null && (
        <div className="note">
          <label htmlFor={`note-${todo.id}`}>メモ（S3 に保存）</label>
          <textarea id={`note-${todo.id}`} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={10000} />
          <div className="note-actions">
            <button type="button" onClick={saveNote} disabled={busy}>
              メモを保存
            </button>
            <button type="button" className="ghost" onClick={() => setNote(null)}>
              閉じる
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
