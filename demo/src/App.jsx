import { ArrowUpRight, Boxes, Check, CornerDownLeft, FileText, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Architecture } from './Architecture.jsx';
import { CallLog } from './CallLog.jsx';
import { emulator, live, reloadAndTakeOver, resetAndReload } from './emulator.js';

const REPO = 'https://github.com/daisuke-awaji/aws-emulator-wasm';

const EVENT_LABELS = {
  created: '追加',
  completed: '完了',
  reopened: '未完了に戻す',
  renamed: '名前を変更',
  noted: 'メモを更新',
  deleted: '削除',
};

const BOOT_STATUS = { loading: '読み込み中', waiting: '待機中', ready: '動作中', failed: '停止' };

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

/** Re-renders when the emulator's lock or save state changes (see emulator.js). */
function useLive() {
  const [, setVersion] = useState(0);
  useEffect(() => live.subscribe(() => setVersion((v) => v + 1)), []);
  return live;
}

const timeOf = (iso) => new Date(iso).toLocaleTimeString('ja-JP');
const dateTimeOf = (iso) =>
  new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

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
  const { lock } = useLive();
  const elapsed = useElapsed(boot.state === 'loading' && lock !== 'waiting');

  useEffect(() => {
    Promise.all([mocking, readyIn]).then(
      ([, { ms, persistence }]) => setBoot({ state: 'ready', ms, persistence }),
      (error) => setBoot({ state: 'failed', message: String(error?.message ?? error) }),
    );
  }, [mocking, readyIn]);

  // Another tab took the emulator over: this one is stopped, whatever it was doing.
  const state = lock === 'lost' ? 'failed' : lock === 'waiting' && boot.state === 'loading' ? 'waiting' : boot.state;

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
            <span className={`pill status-${state}`}>
              <span className="dot" aria-hidden="true" />
              {BOOT_STATUS[state]}
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

        {/* Cards that need an action come before the diagram, so a phone shows them at once. */}
        {state === 'waiting' && (
          <section className="card boot" role="status" aria-labelledby="waiting-title">
            <div>
              <h2 id="waiting-title">このデモは別のタブで開いています</h2>
              <p className="muted">
                エミュレーターの状態をこのブラウザに保存しているので、同時に動かせるのは 1 つのタブだけです。そのタブを閉じると、ここで始まります。
              </p>
              <p>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => emulator.takeOver()}>
                  このタブで使う
                </button>
              </p>
            </div>
          </section>
        )}
        {lock === 'lost' && (
          <section className="card boot" role="alert" aria-labelledby="lost-title">
            <div>
              <h2 id="lost-title">別のタブで使い始めたので、このタブは止めました</h2>
              <p className="muted">同時に動かせるのは 1 つのタブだけです。ここに戻すと、もう一方のタブが止まります。</p>
              <p>
                <button type="button" className="btn btn-primary btn-sm" onClick={reloadAndTakeOver}>
                  このタブで使う
                </button>
              </p>
            </div>
          </section>
        )}
        <Architecture state={state === 'waiting' ? 'loading' : state} />

        {state === 'loading' && (
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
        {state === 'failed' && lock !== 'lost' && (
          <section className="card error-box" role="alert">
            <h2>エミュレーターを起動できませんでした</h2>
            <pre>{boot.message}</pre>
          </section>
        )}
        {state === 'ready' && <Todos bootMs={boot.ms} persistence={boot.persistence} />}

        <footer className="footer">
          <p>
            状態はこのブラウザの中（OPFS）に保存され、再読み込みしても残ります。サーバーには送りません。「初期状態に戻す」で最初の 3 件に戻ります。
          </p>
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

function Todos({ bootMs, persistence }) {
  const [todos, setTodos] = useState(null);
  const [error, setError] = useState('');
  const [activity, setActivity] = useState([]);
  const [stats, setStats] = useState(null);
  const [groups, setGroups] = useState([]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const seen = useRef(0); // the last SDK call already in the log
  const groupId = useRef(0);

  /**
   * Runs one change, then reloads the list and the activity one request after another.
   * The emulator's counter is read last, so it includes every call above.
   */
  const run = useCallback(async (label, fn) => {
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
      setGroups((old) => [{ id, label, ok, at: new Date().toISOString(), calls }, ...old].slice(0, 8));
    } catch {
      // The counter is informational; a failure here must not hide the change itself.
    }
    setBusy(false);
    return ok;
  }, []);

  useEffect(() => {
    run(persistence?.restored ? '起動（保存した状態を復元）' : '起動（テーブル・バケット・キューの作成と初期データ）', async () => {});
  }, [run, persistence]);

  const add = async (event) => {
    event.preventDefault();
    const label = title.trim() ? `「${title.trim()}」を追加` : 'Todo を追加';
    if (await run(label, () => call('todos', { method: 'POST', json: { title } }))) {
      setTitle('');
      input.current?.focus();
    }
  };

  const remaining = todos?.filter((t) => !t.done).length ?? 0;
  const last = groups[0];

  return (
    <div className="workspace">
      <PersistNotice persistence={persistence} />
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

        {todos === null ? (
          <p className="muted pad">読み込み中…</p>
        ) : (
          <>
            <ul className="todos" aria-label="Todo の一覧">
              {todos.map((todo) => (
                <TodoItem key={todo.id} todo={todo} run={run} busy={busy} />
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
            {persistence && <SaveState persistence={persistence} busy={busy} />}
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

/** What happened to the saved state when the page loaded. */
function PersistNotice({ persistence }) {
  if (!persistence) return null;
  let text;
  if (!persistence.enabled) text = 'このブラウザでは保存を使えないため、再読み込みすると初期状態に戻ります。';
  else if (persistence.restored && persistence.discarded === 'corrupt')
    text = `最後の保存が壊れていたため、1 つ前の状態（${dateTimeOf(persistence.savedAt)} に保存）を復元しました。`;
  else if (persistence.restored) text = `前回の状態を復元しました（${dateTimeOf(persistence.savedAt)} に保存）。`;
  else if (persistence.discarded === 'version') text = 'エミュレーターが新しい版になったので、初期状態から始めました。';
  else if (persistence.discarded === 'corrupt') text = '保存したデータが壊れていたため、初期状態から始めました。';
  if (!text) return null;
  return (
    <p className="notice" role="status" data-testid="persist-notice">
      {text}
    </p>
  );
}

/** The last save, and the way back to the seed data. */
function SaveState({ persistence, busy }) {
  const { lastSave, saveError } = useLive();
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const reset = async () => {
    setResetting(true);
    await resetAndReload();
  };
  return (
    <div className="save-state">
      <p className="save-line" data-testid="last-save" data-requests={lastSave?.requests ?? 0} aria-live="polite">
        {!persistence.enabled
          ? '保存：使えません'
          : saveError
            ? `保存に失敗しました：${saveError}`
            : lastSave
              ? `保存：${timeOf(lastSave.at)}（${(lastSave.bytes / 1024 / 1024).toFixed(1)} MB、${Math.round(lastSave.ms)} ms）`
              : persistence.restored
                ? `保存：${timeOf(persistence.savedAt)}（復元した状態）`
                : '保存：まだありません'}
      </p>
      {persistence.enabled &&
        (confirming ? (
          <div className="confirm" role="group" aria-label="初期状態に戻す">
            <p>保存したデータを消して、最初の 3 件に戻します。</p>
            <div className="note-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={reset} disabled={resetting}>
                消して戻す
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)} disabled={resetting}>
                やめる
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm danger" onClick={() => setConfirming(true)} disabled={busy}>
            <RotateCcw size={14} aria-hidden="true" />
            初期状態に戻す
          </button>
        ))}
    </div>
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
    const label = `「${todo.title}」を${next ? '完了にする' : '未完了に戻す'}`;
    if (!(await run(label, () => call(`todos/${todo.id}`, { method: 'PATCH', json: { done: next } })))) setDone(todo.done);
  };

  const save = async (event) => {
    event.preventDefault();
    const label = `「${todo.title}」の名前を変更`;
    if (await run(label, () => call(`todos/${todo.id}`, { method: 'PATCH', json: { title: draft } }))) setEditing(false);
  };

  const openNote = () =>
    run(`「${todo.title}」のメモを開く`, async () => {
      setNote(await call(`todos/${todo.id}/note`));
    });

  const saveNote = async () => {
    if (await run(`「${todo.title}」のメモを保存`, () => call(`todos/${todo.id}/note`, { method: 'PUT', text: note }))) setNote(null);
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
              onClick={() => run(`「${todo.title}」を削除`, () => call(`todos/${todo.id}`, { method: 'DELETE' }))}
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
    </li>
  );
}
