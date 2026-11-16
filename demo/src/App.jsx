import {
  ArrowUpRight,
  Boxes,
  Play,
  Check,
  Cloud,
  CornerDownLeft,
  FileText,
  LogIn,
  LogOut,
  Pencil,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { call } from "./api-client.js";
import { Architecture } from "./Architecture.jsx";
import { CallLog } from "./CallLog.jsx";
import { LANGS, locale, rich, setLang, t, useLang } from "./i18n.js";

/**
 * What the page runs against (runtime-emulator.js or runtime-aws.js): `target` is
 * 'emulator' or 'aws', and the rest is what that target offers (tab lock and saves for the
 * emulator, sign-in for AWS).
 */
const Runtime = createContext(null);
const useRuntime = () => useContext(Runtime);

const REPO = "https://github.com/daisuke-awaji/aws-emulator-wasm";

const EVENTS = [
  "created",
  "completed",
  "reopened",
  "renamed",
  "noted",
  "deleted",
];

function useElapsed(running) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    const started = performance.now();
    const timer = setInterval(
      () => setSeconds((performance.now() - started) / 1000),
      100,
    );
    return () => clearInterval(timer);
  }, [running]);
  return seconds;
}

/** Re-renders when the runtime's live state changes: lock and saves, or the signed-in user. */
function useLive() {
  const { live } = useRuntime();
  const [, setVersion] = useState(0);
  useEffect(() => live.subscribe(() => setVersion((v) => v + 1)), [live]);
  return live;
}

const timeOf = (iso) => new Date(iso).toLocaleTimeString(locale());
const dateTimeOf = (iso) =>
  new Date(iso).toLocaleString(locale(), {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

/** Keeps --footer-h on <html> equal to the fixed footer's height, so the page can scroll past it. */
function useFooterHeight() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const set = () =>
      document.documentElement.style.setProperty(
        "--footer-h",
        `${el.offsetHeight}px`,
      );
    set();
    const observer = new ResizeObserver(set);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return ref;
}

function GitHubMark() {
  // Octicons mark-github (MIT).
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}

const LANG_NAMES = { en: "EN", ja: "JP" };

/** EN | 日本語: switches the page in place (and remembers the choice). */
function LangSwitch() {
  const lang = useLang();
  return (
    <div className="lang-switch" role="group" aria-label={t("nav.language")}>
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={l === lang}
          onClick={() => setLang(l)}
        >
          {LANG_NAMES[l]}
        </button>
      ))}
    </div>
  );
}

export function App({ runtime }) {
  return (
    <Runtime.Provider value={runtime}>
      <Page />
    </Runtime.Provider>
  );
}

function Page() {
  useLang(); // everything below re-renders in the new language
  const runtime = useRuntime();
  const aws = runtime.target === "aws";
  // The emulator build starts idle: nothing is downloaded until the user asks for it.
  const [boot, setBoot] = useState({
    state: runtime.idle ? "idle" : "loading",
  });
  const { lock, user } = useLive();
  const elapsed = useElapsed(boot.state === "loading" && lock !== "waiting");
  const startEmulator = () => {
    setBoot({ state: "loading" });
    runtime.boot();
  };
  const footer = useFooterHeight();

  useEffect(() => {
    runtime.ready.then(
      ({ ms, persistence }) => setBoot({ state: "ready", ms, persistence }),
      (error) =>
        setBoot({ state: "failed", message: String(error?.message ?? error) }),
    );
  }, [runtime]);

  // Another tab took the emulator over: this one is stopped, whatever it was doing.
  let state =
    lock === "lost"
      ? "failed"
      : lock === "waiting" && boot.state === "loading"
        ? "waiting"
        : boot.state;
  if (aws && state === "ready" && !user) state = "signedOut";

  return (
    <>
      <nav className="nav" aria-label={t("nav.label")}>
        <div className="nav-inner">
          <a className="brand" href="./" aria-label={t("nav.home")}>
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
              {t(`status.${state}`)}
            </span>
            {aws ? (
              user && (
                <button
                  type="button"
                  className="nav-link"
                  onClick={runtime.signOut}
                >
                  <LogOut size={14} aria-hidden="true" />
                  {t("aws.signOut")}
                </button>
              )
            ) : (
              <a className="nav-link" href="sdk.html">
                {t("nav.sdk")}
              </a>
            )}
            <LangSwitch />
            <a className="icon-link" href={REPO} aria-label={t("nav.repo")}>
              <GitHubMark />
            </a>
          </div>
        </div>
      </nav>

      <div className="page">
        <header className="hero">
          <p className="eyebrow">{t(aws ? "aws.eyebrow" : "eyebrow")}</p>
          <h1>Todo</h1>
          <p className="lead">
            {rich(aws ? "aws.lead" : "lead", (text) => (
              <strong>{text}</strong>
            ))}
          </p>
        </header>

        {/* Cards that need an action come before the diagram, so a phone shows them at once. */}
        {state === "waiting" && (
          <section
            className="card boot"
            role="status"
            aria-labelledby="waiting-title"
          >
            <div>
              <h2 id="waiting-title">{t("waiting.title")}</h2>
              <p className="muted">{t("waiting.body")}</p>
              <p>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => runtime.takeOver()}
                >
                  {t("tab.useHere")}
                </button>
              </p>
            </div>
          </section>
        )}
        {lock === "lost" && (
          <section
            className="card boot"
            role="alert"
            aria-labelledby="lost-title"
          >
            <div>
              <h2 id="lost-title">{t("lost.title")}</h2>
              <p className="muted">{t("lost.body")}</p>
              <p>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={runtime.reloadAndTakeOver}
                >
                  {t("tab.useHere")}
                </button>
              </p>
            </div>
          </section>
        )}
        {state === "idle" && (
          <section className="card boot start" aria-labelledby="start-title">
            <div>
              <h2 id="start-title">{t("start.title")}</h2>
              <p className="muted">{t("start.body")}</p>
              <p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={startEmulator}
                >
                  <Play size={15} aria-hidden="true" />
                  {t("start.button")}
                </button>
              </p>
              <p className="muted small">{t("start.note")}</p>
            </div>
          </section>
        )}
        {!aws && (
          <Architecture state={state === "waiting" ? "loading" : state} />
        )}
        {state === "signedOut" && (
          <section className="card boot" aria-labelledby="signin-title">
            <div>
              <h2 id="signin-title">{t("aws.signInTitle")}</h2>
              <p className="muted">{t("aws.signInBody")}</p>
              <p>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={runtime.signIn}
                >
                  <LogIn size={14} aria-hidden="true" />
                  {t("aws.signIn")}
                </button>
              </p>
            </div>
          </section>
        )}

        {state === "loading" && (
          <section className="card boot" role="status" aria-live="polite">
            <div className="spinner" aria-hidden="true" />
            <div>
              <p>
                {aws ? (
                  t("aws.loading")
                ) : (
                  <>
                    {t("boot.loading")}{" "}
                    <span className="mono">
                      {t("seconds", elapsed.toFixed(1))}
                    </span>
                  </>
                )}
              </p>
              {!aws && <p className="muted">{t("boot.firstTime")}</p>}
            </div>
          </section>
        )}
        {state === "failed" && lock !== "lost" && (
          <section className="card error-box" role="alert">
            <h2>{t(aws ? "aws.failed" : "boot.failed")}</h2>
            <pre>{boot.message}</pre>
          </section>
        )}
        {state === "ready" && (
          <Todos bootMs={boot.ms} persistence={boot.persistence} />
        )}

        {/* Fixed to the bottom of the screen; the page leaves room for it (--footer-h). */}
        <footer className="footer" ref={footer}>
          <div className="footer-inner">
            <p>{t(aws ? "aws.footer" : "footer")}</p>
            <p className="footer-links">
              {!aws && <a href="sdk.html">{t("footer.sdk")}</a>}
              <a href={REPO}>
                GitHub
                <ArrowUpRight size={13} aria-hidden="true" />
              </a>
            </p>
          </div>
        </footer>
      </div>
    </>
  );
}

function Todos({ bootMs, persistence }) {
  const runtime = useRuntime();
  const aws = runtime.target === "aws";
  const [todos, setTodos] = useState(null);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState([]);
  const [stats, setStats] = useState(null);
  const [groups, setGroups] = useState([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const seen = useRef(0); // the last SDK call already in the log
  const groupId = useRef(0);

  /**
   * Runs one change, then reloads the list and the activity one request after another.
   * The emulator's counter is read last, so it includes every call above.
   * `label` is [message key, ...args], so the log follows a language switch.
   */
  const run = useCallback(
    async (label, fn) => {
      setBusy(true);
      setError("");
      let ok = false;
      try {
        await fn();
        setTodos(await call("todos"));
        const events = await call("activity");
        if (events.length)
          setActivity((old) => [...events.reverse(), ...old].slice(0, 30));
        ok = true;
      } catch (e) {
        setError(e.message);
      }
      // The SDK call log exists only where the emulator answers in the page.
      if (!aws) {
        try {
          const emu = await call(`emulator?since=${seen.current}`);
          const calls = emu.calls ?? [];
          if (calls.length) seen.current = calls[calls.length - 1].seq;
          setStats(emu);
          const id = ++groupId.current;
          setGroups((old) =>
            [
              { id, label, ok, at: new Date().toISOString(), calls },
              ...old,
            ].slice(0, 8),
          );
        } catch {
          // The counter is informational; a failure here must not hide the change itself.
        }
      }
      setBusy(false);
      return ok;
    },
    [aws],
  );

  useEffect(() => {
    run(
      [
        aws
          ? "action.bootAws"
          : persistence?.restored
            ? "action.bootRestored"
            : "action.bootFresh",
      ],
      async () => {},
    );
  }, [run, persistence, aws]);

  const add = async (event) => {
    event.preventDefault();
    if (
      await run(["action.add", title.trim()], () =>
        call("todos", { method: "POST", json: { title } }),
      )
    ) {
      setTitle("");
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
              {t("todos.remaining", remaining, todos.length)}
            </p>
          )}
        </div>
        <form className="add" onSubmit={add}>
          <label htmlFor="new-title" className="visually-hidden">
            {t("todos.new")}
          </label>
          <input
            id="new-title"
            ref={input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("todos.placeholder")}
            maxLength={200}
            autoComplete="off"
          />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t("todos.add")}
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
          <p className="muted pad">{t("todos.loading")}</p>
        ) : (
          <>
            <ul className="todos" aria-label={t("todos.list")}>
              {todos.map((todo) => (
                <TodoItem key={todo.id} todo={todo} run={run} busy={busy} />
              ))}
            </ul>
            {todos.length === 0 && (
              <p className="muted pad">{t("todos.empty")}</p>
            )}
          </>
        )}
      </main>

      <aside className="side">
        {aws && <AwsCard />}
        {stats && (
          <section className="card" aria-labelledby="emu-title">
            <div className="card-head">
              <h2 id="emu-title">{t("emu.title")}</h2>
              <span className="badge">Web Worker</span>
            </div>
            <dl className="stats" aria-label={t("emu.title")}>
              <div>
                <dt>{t("emu.boot")}</dt>
                <dd>
                  {(bootMs / 1000).toFixed(1)}
                  <small>{t("unitSeconds")}</small>
                </dd>
              </div>
              <div>
                <dt>{t("emu.requests")}</dt>
                <dd data-testid="requests">
                  {stats.requests}
                  <small>{t("unitCalls")}</small>
                </dd>
              </div>
              <div>
                <dt>{t("emu.last")}</dt>
                <dd data-testid="last-calls">
                  {last ? last.calls.length : 0}
                  <small>{t("unitCalls")}</small>
                </dd>
              </div>
              <div>
                <dt>{t("emu.skipped")}</dt>
                <dd>
                  {(stats.skippedMs / 1000).toFixed(1)}
                  <small>{t("unitSeconds")}</small>
                </dd>
              </div>
            </dl>
            {persistence && <SaveState persistence={persistence} busy={busy} />}
          </section>
        )}

        <section className="card activity" aria-labelledby="activity-title">
          <div className="card-head">
            <h2 id="activity-title">{t("activity.title")}</h2>
            <span className="badge">{t("activity.badge")}</span>
          </div>
          {activity.length === 0 ? (
            <p className="muted pad">{t("activity.empty")}</p>
          ) : (
            <ol aria-label={t("activity.title")}>
              {activity.map((e, i) => (
                <li key={`${e.at}-${e.id}-${i}`}>
                  <span className={`tag tag-${e.type}`}>
                    {EVENTS.includes(e.type) ? t(`event.${e.type}`) : e.type}
                  </span>
                  <span className="event-title">{e.title}</span>
                  <time dateTime={e.at}>{timeOf(e.at)}</time>
                </li>
              ))}
            </ol>
          )}
        </section>
      </aside>

      {!aws && <CallLog groups={groups} />}
    </div>
  );
}

/** The AWS build: where the API is, and who is signed in. */
function AwsCard() {
  const runtime = useRuntime();
  const { user } = useLive();
  return (
    <section className="card" aria-labelledby="aws-title">
      <div className="card-head">
        <h2 id="aws-title">{t("aws.title")}</h2>
        <span className="badge">
          <Cloud size={12} aria-hidden="true" /> Lambda Web Function
        </span>
      </div>
      <dl className="aws-facts">
        <div>
          <dt>{t("aws.endpoint")}</dt>
          <dd className="mono" data-testid="api-host">
            {new URL(runtime.apiUrl).host}
          </dd>
        </div>
        <div>
          <dt>{t("aws.signedInAs")}</dt>
          <dd>{user?.profile?.email ?? user?.profile?.sub}</dd>
        </div>
      </dl>
    </section>
  );
}

/** What happened to the saved state when the page loaded. */
function PersistNotice({ persistence }) {
  if (!persistence) return null;
  let text;
  if (!persistence.enabled) text = t("persist.unavailable");
  else if (persistence.restored && persistence.discarded === "corrupt")
    text = t("persist.restoredOlder", dateTimeOf(persistence.savedAt));
  else if (persistence.restored)
    text = t("persist.restored", dateTimeOf(persistence.savedAt));
  else if (persistence.discarded === "version") text = t("persist.newVersion");
  else if (persistence.discarded === "corrupt") text = t("persist.corrupt");
  if (!text) return null;
  return (
    <p className="notice" role="status" data-testid="persist-notice">
      {text}
    </p>
  );
}

/** The last save, and the way back to the seed data. */
function SaveState({ persistence, busy }) {
  const { resetAndReload } = useRuntime();
  const { lastSave, saveError } = useLive();
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const reset = async () => {
    setResetting(true);
    await resetAndReload();
  };
  return (
    <div className="save-state">
      <p
        className="save-line"
        data-testid="last-save"
        data-requests={lastSave?.requests ?? 0}
        aria-live="polite"
      >
        {!persistence.enabled
          ? t("save.unavailable")
          : saveError
            ? t("save.failed", saveError)
            : lastSave
              ? t(
                  "save.last",
                  timeOf(lastSave.at),
                  (lastSave.bytes / 1024 / 1024).toFixed(1),
                  Math.round(lastSave.ms),
                )
              : persistence.restored
                ? t("save.restored", timeOf(persistence.savedAt))
                : t("save.none")}
      </p>
      {persistence.enabled &&
        (confirming ? (
          <div className="confirm" role="group" aria-label={t("reset.button")}>
            <p>{t("reset.confirm")}</p>
            <div className="note-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={reset}
                disabled={resetting}
              >
                {t("reset.yes")}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirming(false)}
                disabled={resetting}
              >
                {t("reset.no")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm danger"
            onClick={() => setConfirming(true)}
            disabled={busy}
          >
            <RotateCcw size={14} aria-hidden="true" />
            {t("reset.button")}
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
    if (
      !(await run([next ? "action.done" : "action.reopen", todo.title], () =>
        call(`todos/${todo.id}`, { method: "PATCH", json: { done: next } }),
      ))
    )
      setDone(todo.done);
  };

  const save = async (event) => {
    event.preventDefault();
    if (
      await run(["action.rename", todo.title], () =>
        call(`todos/${todo.id}`, { method: "PATCH", json: { title: draft } }),
      )
    )
      setEditing(false);
  };

  const openNote = () =>
    run(["action.openNote", todo.title], async () => {
      setNote(await call(`todos/${todo.id}/note`));
    });

  const saveNote = async () => {
    if (
      await run(["action.saveNote", todo.title], () =>
        call(`todos/${todo.id}/note`, { method: "PUT", text: note }),
      )
    )
      setNote(null);
  };

  return (
    <li className={done ? "todo done" : "todo"}>
      <div className="row">
        <label className="check">
          <input
            type="checkbox"
            checked={done}
            disabled={busy}
            aria-label={t(done ? "todo.markOpen" : "todo.markDone", todo.title)}
            onChange={toggle}
          />
          <span className="check-box" aria-hidden="true">
            <Check size={12} strokeWidth={3} />
          </span>
        </label>
        {editing ? (
          <form className="edit" onSubmit={save}>
            <label className="visually-hidden" htmlFor={`edit-${todo.id}`}>
              {t("todo.titleField")}
            </label>
            <input
              id={`edit-${todo.id}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={200}
              autoFocus
            />
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={busy}
            >
              {t("todo.save")}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setDraft(todo.title);
                setEditing(false);
              }}
            >
              {t("todo.cancel")}
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
              aria-label={t("todo.editLabel", todo.title)}
            >
              <Pencil size={14} aria-hidden="true" />
              <span className="btn-text">{t("todo.edit")}</span>
            </button>
            <button
              type="button"
              className={
                todo.hasNote
                  ? "btn btn-ghost btn-sm has-note"
                  : "btn btn-ghost btn-sm"
              }
              onClick={note === null ? openNote : () => setNote(null)}
              aria-expanded={note !== null}
              aria-label={t("todo.noteLabel", todo.title)}
            >
              <FileText size={14} aria-hidden="true" />
              {t(todo.hasNote ? "todo.hasNote" : "todo.note")}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm danger"
              disabled={busy}
              onClick={() =>
                run(["action.delete", todo.title], () =>
                  call(`todos/${todo.id}`, { method: "DELETE" }),
                )
              }
              aria-label={t("todo.deleteLabel", todo.title)}
            >
              <Trash2 size={14} aria-hidden="true" />
              <span className="btn-text">{t("todo.delete")}</span>
            </button>
          </div>
        )}
      </div>
      {note !== null && (
        <div className="note">
          <label htmlFor={`note-${todo.id}`}>{t("note.field")}</label>
          <textarea
            id={`note-${todo.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={10000}
          />
          <div className="note-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={saveNote}
              disabled={busy}
            >
              {t("note.save")}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setNote(null)}
            >
              <X size={14} aria-hidden="true" />
              {t("note.close")}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
