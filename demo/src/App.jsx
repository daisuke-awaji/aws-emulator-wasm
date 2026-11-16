import { ArrowUpRight, Boxes, Check, CornerDownLeft, FileText, Pencil, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Architecture } from './Architecture.jsx';
import { CallLog, OpTrace } from './CallLog.jsx';

const REPO = 'https://github.com/daisuke-awaji/aws-emulator-wasm';

const EVENT_LABELS = {
  created: '追加',
  completed: '完了',
  reopened: '未完了に戻す',
  renamed: '名前を変更',
  noted: 'メモを更新',
  deleted: '削除',
};

const BOOT_STATUS = { loading: '読み込み中', ready: '動作中', failed: '停止' };

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

function GitHubMark() {
  // Octicons mark-github (MIT).
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
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
    <>
      <nav className="nav" aria-label="サイト">
        <div className="nav-inner">
          <a className="brand" href="./" aria-label="aws-emulator-wasm のデモ">
            <span className="brand-mark" aria-hidden="true">
              <Boxes size={15} strokeWidth={2.25} />
            </span>
            <span className="brand-name">aws-emulator-wasm</span>
            <span className="brand-sep" aria-hidden="true">
              /
            </span>
            <span className="brand-page">todo</span>
          </a>
          <div className="nav-right">
            <span className={`pill status-${boot.state}`}>
              <span className="dot" aria-hidden="true" />
              {BOOT_STATUS[boot.state]}
            </span>
            <a className="nav-link" href="sdk.html">
              SDK テスト
            </a>
            <a className="icon-link" href={REPO} aria-label="GitHub のリポジトリ">
              <GitHubMark />
            </a>
          </div>
        </div>
      </nav>

      <div className="page">
        <header className="hero">
          <p className="eyebrow">
            <span className="eyebrow-tag">Phase 1</span>
            すべてブラウザの中で動きます
          </p>
          <h1>Todo</h1>
          <p className="lead">
            サーバーなしで動く Todo です。画面の通信は MSW が受け取り、ハンドラが AWS SDK v3 で
            <strong>ブラウザ内の AWS Emulator（wasm）</strong>を呼びます。Todo は DynamoDB、メモは S3、変更の記録は SQS に入ります。
          </p>
        </header>

        <Architecture state={boot.state} />

        {boot.state === 'loading' && (
          <section className="card boot" role="status" aria-live="polite">
            <div className="spinner" aria-hidden="true" />
            <div>
              <p>
                エミュレーターを読み込んでいます… <span className="mono">{elapsed.toFixed(1)} 秒</span>
              </p>
              <p className="muted">初回は wasm（約 9 MB、圧縮後）をダウンロードします。</p>
            </div>
          </section>
        )}
        {boot.state === 'failed' && (
          <section className="card error-box" role="alert">
            <h2>エミュレーターを起動できませんでした</h2>
            <pre>{boot.message}</pre>
          </section>
        )}
        {boot.state === 'ready' && <Todos bootMs={boot.ms} />}

        <footer className="footer">
          <p>状態はページを再読み込みすると消えます（保存は今後の Phase で対応します）。</p>
          <p className="footer-links">
            <a href="sdk.html">SDK の往復テスト（DynamoDB・S3・SQS）</a>
            <a href={REPO}>
              GitHub
              <ArrowUpRight size={13} aria-hidden="true" />
            </a>
          </p>
        </footer>
      </div>
    </>
  );
}

function Todos({ bootMs }) {
  const [todos, setTodos] = useState(null);
  const [error, setError] = useState('');
  const [activity, setActivity] = useState([]);
  const [stats, setStats] = useState(null);
  const [groups, setGroups] = useState([]);
  const [traceId, setTraceId] = useState(null); // the action whose SDK calls show next to its Todo
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const seen = useRef(0); // the last SDK call already in the log
  const groupId = useRef(0);

  /**
   * Runs one change, then reloads the list and the activity one request after another.
   * The emulator's counter is read last, so it includes every call above.
   * `target` is where the SDK calls show afterwards: a Todo's id, or 'list' (add and delete).
   */
  const run = useCallback(async (label, fn, target = null) => {
    setBusy(true);
    setError('');
    let ok = false;
    try {
      await fn();
      setTodos(await call('todos'));
      const events = await call('activity');
      if (events.length) setActivity((old) => [...events.reverse(), ...old].slice(0, 30));
      ok = true;
    } catch (e) {
      setError(e.message);
    }
    try {
      const emu = await call(`emulator?since=${seen.current}`);
      const calls = emu.calls ?? [];
      if (calls.length) seen.current = calls[calls.length - 1].seq;
      setStats(emu);
      const id = ++groupId.current;
      setGroups((old) => [{ id, label, ok, target, at: new Date().toISOString(), calls }, ...old].slice(0, 8));
      setTraceId(target ? id : null);
    } catch {
      // The counter is informational; a failure here must not hide the change itself.
    }
    setBusy(false);
    return ok;
  }, []);

  useEffect(() => {
    run('起動（テーブル・バケット・キューの作成と初期データ）', async () => {});
  }, [run]);

  const add = async (event) => {
    event.preventDefault();
    const label = title.trim() ? `「${title.trim()}」を追加` : 'Todo を追加';
    if (await run(label, () => call('todos', { method: 'POST', json: { title } }), 'list')) {
      setTitle('');
      input.current?.focus();
    }
  };

  const remaining = todos?.filter((t) => !t.done).length ?? 0;
  const last = groups[0];
  const trace = traceId === null ? null : groups.find((g) => g.id === traceId);
  const closeTrace = () => setTraceId(null);

  return (
    <div className="workspace">
      <main className="card todos-card" aria-labelledby="todos-title">
        <div className="card-head">
          <h2 id="todos-title">Todos</h2>
          {todos && (
            <p className="count" aria-live="polite">
              残り {remaining} 件 / 全 {todos.length} 件
            </p>
          )}
        </div>
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
          <button type="submit" className="btn btn-primary" disabled={busy}>
            追加
            <kbd aria-hidden="true">
              <CornerDownLeft size={12} />
            </kbd>
          </button>
        </form>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {trace?.target === 'list' && <OpTrace group={trace} onClose={closeTrace} />}

        {todos === null ? (
          <p className="muted pad">読み込み中…</p>
        ) : (
          <>
            <ul className="todos" aria-label="Todo の一覧">
              {todos.map((todo) => (
                <TodoItem
                  key={todo.id}
                  todo={todo}
                  run={run}
                  busy={busy}
                  trace={trace?.target === todo.id ? trace : null}
                  onCloseTrace={closeTrace}
                />
              ))}
            </ul>
            {todos.length === 0 && <p className="muted pad">Todo はありません。</p>}
          </>
        )}
      </main>

      <aside className="side">
        {stats && (
          <section className="card" aria-labelledby="emu-title">
            <div className="card-head">
              <h2 id="emu-title">エミュレーター</h2>
              <span className="badge">Web Worker</span>
            </div>
            <dl className="stats" aria-label="エミュレーター">
              <div>
                <dt>起動</dt>
                <dd>
                  {(bootMs / 1000).toFixed(1)}
                  <small> 秒</small>
                </dd>
              </div>
              <div>
                <dt>SDK の呼び出し（累計）</dt>
                <dd data-testid="requests">
                  {stats.requests}
                  <small> 回</small>
                </dd>
              </div>
              <div>
                <dt>直前の操作</dt>
                <dd data-testid="last-calls">
                  {last ? last.calls.length : 0}
                  <small> 回</small>
                </dd>
              </div>
              <div>
                <dt>仮想時計で進めた時間</dt>
                <dd>
                  {(stats.skippedMs / 1000).toFixed(1)}
                  <small> 秒</small>
                </dd>
              </div>
            </dl>
          </section>
        )}

        <section className="card activity" aria-labelledby="activity-title">
          <div className="card-head">
            <h2 id="activity-title">変更の記録</h2>
            <span className="badge">SQS から受信</span>
          </div>
          {activity.length === 0 ? (
            <p className="muted pad">まだありません。</p>
          ) : (
            <ol aria-label="変更の記録">
              {activity.map((e, i) => (
                <li key={`${e.at}-${e.id}-${i}`}>
                  <span className={`tag tag-${e.type}`}>{EVENT_LABELS[e.type] ?? e.type}</span>
                  <span className="event-title">{e.title}</span>
                  <time dateTime={e.at}>{new Date(e.at).toLocaleTimeString('ja-JP')}</time>
                </li>
              ))}
            </ol>
          )}
        </section>
      </aside>

      <CallLog groups={groups} />
    </div>
  );
}

function TodoItem({ todo, run, busy, trace, onCloseTrace }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(todo.title);
  const [note, setNote] = useState(null); // null: closed; string: open
  // The checkbox follows a click at once; the list reload then confirms (or reverts) it.
  const [done, setDone] = useState(todo.done);
  useEffect(() => setDone(todo.done), [todo.done]);

  const toggle = async () => {
    const next = !done;
    setDone(next);
    const label = `「${todo.title}」を${next ? '完了にする' : '未完了に戻す'}`;
    if (!(await run(label, () => call(`todos/${todo.id}`, { method: 'PATCH', json: { done: next } }), todo.id))) setDone(todo.done);
  };

  const save = async (event) => {
    event.preventDefault();
    const label = `「${todo.title}」の名前を変更`;
    if (await run(label, () => call(`todos/${todo.id}`, { method: 'PATCH', json: { title: draft } }), todo.id)) setEditing(false);
  };

  const openNote = () =>
    run(
      `「${todo.title}」のメモを開く`,
      async () => {
        setNote(await call(`todos/${todo.id}/note`));
      },
      todo.id,
    );

  const saveNote = async () => {
    if (await run(`「${todo.title}」のメモを保存`, () => call(`todos/${todo.id}/note`, { method: 'PUT', text: note }), todo.id)) setNote(null);
  };

  return (
    <li className={done ? 'todo done' : 'todo'}>
      <div className="row">
        <label className="check">
          <input
            type="checkbox"
            checked={done}
            disabled={busy}
            aria-label={`「${todo.title}」を${done ? '未完了に戻す' : '完了にする'}`}
            onChange={toggle}
          />
          <span className="check-box" aria-hidden="true">
            <Check size={12} strokeWidth={3} />
          </span>
        </label>
        {editing ? (
          <form className="edit" onSubmit={save}>
            <label className="visually-hidden" htmlFor={`edit-${todo.id}`}>
              タイトル
            </label>
            <input id={`edit-${todo.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={200} autoFocus />
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              保存
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
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
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setDraft(todo.title);
                setEditing(true);
              }}
              aria-label={`「${todo.title}」を編集`}
            >
              <Pencil size={14} aria-hidden="true" />
              <span className="btn-text">編集</span>
            </button>
            <button
              type="button"
              className={todo.hasNote ? 'btn btn-ghost btn-sm has-note' : 'btn btn-ghost btn-sm'}
              onClick={note === null ? openNote : () => setNote(null)}
              aria-expanded={note !== null}
              aria-label={`「${todo.title}」のメモ`}
            >
              <FileText size={14} aria-hidden="true" />
              {todo.hasNote ? 'メモあり' : 'メモ'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm danger"
              disabled={busy}
              onClick={() => run(`「${todo.title}」を削除`, () => call(`todos/${todo.id}`, { method: 'DELETE' }), 'list')}
              aria-label={`「${todo.title}」を削除`}
            >
              <Trash2 size={14} aria-hidden="true" />
              <span className="btn-text">削除</span>
            </button>
          </div>
        )}
      </div>
      {note !== null && (
        <div className="note">
          <label htmlFor={`note-${todo.id}`}>メモ（S3 に保存）</label>
          <textarea id={`note-${todo.id}`} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={10000} />
          <div className="note-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={saveNote} disabled={busy}>
              メモを保存
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNote(null)}>
              <X size={14} aria-hidden="true" />
              閉じる
            </button>
          </div>
        </div>
      )}
      {trace && <OpTrace group={trace} onClose={onCloseTrace} />}
    </li>
  );
}
