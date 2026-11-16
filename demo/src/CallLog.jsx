import { ChevronRight } from 'lucide-react';
import dynamodbIcon from './assets/aws/dynamodb.svg';
import s3Icon from './assets/aws/s3.svg';
import sqsIcon from './assets/aws/sqs.svg';
import { rich, t, tl } from './i18n.js';

const ICONS = { DynamoDB: dynamodbIcon, S3: s3Icon, SQS: sqsIcon };
const routeLabel = (route) => (route === 'setup' || route === 'concurrent' ? t(`route.${route}`) : route === 'other' ? '—' : route);

const ms = (n) => (n < 10 ? n.toFixed(1) : Math.round(n).toString());
const json = (value) => JSON.stringify(value, null, 2);

/** e.g. docs.send(UpdateCommand), as written in api/todos.js. */
function sendText(c) {
  return c.sdk?.command ? `${c.sdk.client}.send(${c.sdk.command})` : c.operation;
}

/** One SDK execution: what api/todos.js sent, and the HTTP call the emulator answered. Opens to the input and output. */
function SdkCall({ call: c }) {
  const sdk = c.sdk;
  // The low-level operation, when the command name does not already say it (PutCommand sends PutItem).
  const op = sdk?.command && sdk.command !== `${c.operation}Command` ? c.operation : null;
  return (
    <li className="sdk-call">
      <details>
        <summary className="call-row">
          <span className="call-seq mono">#{c.seq}</span>
          <span className="call-route mono">{routeLabel(c.route)}</span>
          <span className="call-service">
            {ICONS[c.service] && <img src={ICONS[c.service]} alt="" width="16" height="16" />}
            {c.service}
          </span>
          <span className="call-op mono">
            {sendText(c)}
            {op && <span className="call-wire"> → {op}</span>}
          </span>
          <span className={`call-status mono ${c.status < 400 ? 'ok' : 'ng'}`}>{c.status}</span>
          <span className="call-ms mono">{ms(c.ms)} ms</span>
        </summary>
        {sdk ? (
          <div className="sdk-io">
            <div>
              <h4>{t('calls.input')}</h4>
              <pre className="mono" aria-label={t('calls.inputLabel', c.seq)}>{json(sdk.input)}</pre>
            </div>
            <div>
              <h4>{t(sdk.error ? 'calls.error' : 'calls.output')}</h4>
              <pre className={sdk.error ? 'mono ng' : 'mono'} aria-label={t('calls.outputLabel', c.seq, Boolean(sdk.error))}>
                {sdk.error ? `${sdk.error.name}: ${sdk.error.message}` : json(sdk.output ?? {})}
              </pre>
            </div>
          </div>
        ) : (
          <p className="muted pad">{t('calls.noSdk')}</p>
        )}
      </details>
    </li>
  );
}

/** The SDK calls each UI action caused, newest action first (like a request log). */
export function CallLog({ groups }) {
  return (
    <section className="card calls" aria-labelledby="calls-title">
      <div className="card-head">
        <h2 id="calls-title">{t('calls.title')}</h2>
        <span className="badge">{t('calls.badge')}</span>
      </div>
      <p className="calls-help">
        {rich(
          'calls.help',
          (text) => <code>{text}</code>,
          (text) => <strong>{text}</strong>,
        )}
      </p>
      {groups.length === 0 ? (
        <p className="muted pad">{t('calls.empty')}</p>
      ) : (
        <div className="call-groups">
          {groups.map((g, i) => (
            <details key={g.id} className="call-group" open={i === 0}>
              <summary>
                <ChevronRight size={14} className="chev" aria-hidden="true" />
                <span className="call-label">{tl(g.label)}</span>
                {!g.ok && <span className="badge badge-error">{t('calls.error')}</span>}
                <span className="call-count mono">{t('calls.count', g.calls.length)}</span>
                <span className="call-total mono">{ms(g.calls.reduce((n, c) => n + c.ms, 0))} ms</span>
              </summary>
              {g.calls.length === 0 ? (
                <p className="muted pad">{t('calls.none')}</p>
              ) : (
                <ol className="call-rows" aria-label={t('calls.listLabel', tl(g.label))}>
                  {g.calls.map((c) => (
                    <SdkCall key={c.seq} call={c} />
                  ))}
                </ol>
              )}
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
