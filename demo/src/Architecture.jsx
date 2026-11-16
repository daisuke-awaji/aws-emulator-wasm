import { Atom, Braces, CloudOff, Cpu, Globe, Radar } from 'lucide-react';
// AWS Architecture Icons (https://aws.amazon.com/architecture/icons/, package 07312026, 48 px).
import dynamodbIcon from './assets/aws/dynamodb.svg';
import s3Icon from './assets/aws/s3.svg';
import sqsIcon from './assets/aws/sqs.svg';

const STEPS = [
  { icon: Atom, title: 'React', role: '画面', where: 'メインスレッド' },
  { icon: Radar, title: 'MSW', role: 'API のモック', where: 'Service Worker' },
  { icon: Braces, title: 'AWS SDK v3', role: 'MSW のハンドラ', where: 'メインスレッド' },
];
const EDGES = ['fetch', '転送'];

const SERVICES = [
  { icon: dynamodbIcon, name: 'DynamoDB', use: 'Todo' },
  { icon: s3Icon, name: 'S3', use: 'メモ' },
  { icon: sqsIcon, name: 'SQS', use: '変更の記録' },
];

function Edge({ label, className = '' }) {
  return (
    <li className={`arch-edge ${className}`} aria-label={`${label} で渡す`}>
      <span className="arch-edge-label">{label}</span>
      <span className="arch-edge-line" aria-hidden="true" />
    </li>
  );
}

/** The architecture diagram. `state` is 'loading' | 'ready' | 'failed' and colors the emulator. */
export function Architecture({ state }) {
  return (
    <figure className={`arch is-${state}`} aria-labelledby="arch-title">
      <figcaption id="arch-title" className="arch-frame-label">
        <Globe size={14} aria-hidden="true" />
        ブラウザ
        <span className="arch-chip">
          <CloudOff size={12} aria-hidden="true" />
          サーバーなし
        </span>
      </figcaption>
      <ol className="arch-grid" aria-label="構成">
        {STEPS.map((step, i) => (
          <Step key={step.title} step={step} edge={EDGES[i]} />
        ))}
        <Edge label="postMessage" className="arch-edge-down" />
        <li className={`arch-emulator is-${state}`}>
          <div className="arch-emulator-head">
            <span className="arch-icon">
              <Cpu size={20} aria-hidden="true" />
            </span>
            <span className="arch-text">
              <strong>AWS Emulator（wasm）</strong>
              <span className="arch-where">Web Worker</span>
            </span>
            <span className="arch-status" role="img" aria-label={STATUS[state]} title={STATUS[state]} />
          </div>
          <ul className="arch-services" aria-label="使っているサービス">
            {SERVICES.map((s) => (
              <li key={s.name}>
                <img src={s.icon} alt="" width="40" height="40" />
                <span className="arch-text">
                  <strong>{s.name}</strong>
                  <span className="arch-role">{s.use}</span>
                </span>
              </li>
            ))}
          </ul>
        </li>
      </ol>
    </figure>
  );
}

const STATUS = { loading: '読み込み中', ready: '動作中', failed: '起動に失敗' };

function Step({ step, edge }) {
  const Icon = step.icon;
  return (
    <>
      <li className="arch-node">
        <span className="arch-icon">
          <Icon size={20} aria-hidden="true" />
        </span>
        <span className="arch-text">
          <strong>{step.title}</strong>
          <span className="arch-role">{step.role}</span>
        </span>
        <span className="arch-where">{step.where}</span>
      </li>
      {edge && <Edge label={edge} />}
    </>
  );
}
