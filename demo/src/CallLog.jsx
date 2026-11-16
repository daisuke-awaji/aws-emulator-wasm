import { ChevronRight } from 'lucide-react';
import dynamodbIcon from './assets/aws/dynamodb.svg';
import s3Icon from './assets/aws/s3.svg';
import sqsIcon from './assets/aws/sqs.svg';

const ICONS = { DynamoDB: dynamodbIcon, S3: s3Icon, SQS: sqsIcon };
const ROUTE_LABELS = { setup: '起動時の準備', concurrent: '並行', other: '—' };

const ms = (n) => (n < 10 ? n.toFixed(1) : Math.round(n).toString());
const json = (value) => JSON.stringify(value, null, 2);

/** e.g. docs.send(UpdateCommand), as written in backend.js. */
function sendText(c) {
  return c.sdk?.command ? `${c.sdk.client}.send(${c.sdk.command})` : c.operation;
}

/** One SDK execution: what backend.js sent, and the HTTP call the emulator answered. Opens to the input and output. */
function SdkCall({ call: c }) {
  const sdk = c.sdk;
  // The low-level operation, when the command name does not already say it (PutCommand sends PutItem).
  const op = sdk?.command && sdk.command !== `${c.operation}Command` ? c.operation : null;
  return (
    <li className="sdk-call">
      <details>
        <summary className="call-row">
          <span className="call-seq mono">#{c.seq}</span>
          <span className="call-route mono">{ROUTE_LABELS[c.route] ?? c.route}</span>
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
              <h4>入力</h4>
              <pre className="mono" aria-label={`#${c.seq} の入力`}>{json(sdk.input)}</pre>
            </div>
            <div>
              <h4>{sdk.error ? 'エラー' : '出力'}</h4>
              <pre className={sdk.error ? 'mono ng' : 'mono'} aria-label={`#${c.seq} の${sdk.error ? 'エラー' : '出力'}`}>
                {sdk.error ? `${sdk.error.name}: ${sdk.error.message}` : json(sdk.output ?? {})}
              </pre>
            </div>
          </div>
        ) : (
          <p className="muted pad">SDK の記録がありません。</p>
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
        <h2 id="calls-title">SDK の呼び出し</h2>
        <span className="badge">操作ごと</span>
      </div>
      <p className="calls-help">
        操作のたびに、画面は変更の API を 1 回呼んだあと、一覧（<code>GET /api/todos</code> → DynamoDB Scan）と変更の記録（
        <code>GET /api/activity</code> → SQS が空になるまで受信し、受け取った分を削除）を読み直します。そのため Todo の追加は、PutItem と SendMessage
        の 2 回に読み直しの 4 回を足して <strong>6 回</strong>になります。行を開くと、<code>backend.js</code> が SDK に渡した入力と、返ってきた出力が見られます。
      </p>
      {groups.length === 0 ? (
        <p className="muted pad">まだありません。</p>
      ) : (
        <div className="call-groups">
          {groups.map((g, i) => (
            <details key={g.id} className="call-group" open={i === 0}>
              <summary>
                <ChevronRight size={14} className="chev" aria-hidden="true" />
                <span className="call-label">{g.label}</span>
                {!g.ok && <span className="badge badge-error">エラー</span>}
                <span className="call-count mono">SDK {g.calls.length} 回</span>
                <span className="call-total mono">{ms(g.calls.reduce((n, c) => n + c.ms, 0))} ms</span>
              </summary>
              {g.calls.length === 0 ? (
                <p className="muted pad">SDK は呼ばれていません（ハンドラが入力を受け付けませんでした）。</p>
              ) : (
                <ol className="call-rows" aria-label={`${g.label} の SDK 呼び出し`}>
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
