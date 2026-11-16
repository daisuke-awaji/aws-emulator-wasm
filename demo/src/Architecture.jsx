import { Atom, Braces, CloudOff, Cpu, Globe, Radar } from 'lucide-react';
// AWS Architecture Icons (https://aws.amazon.com/architecture/icons/, package 07312026, 48 px).
import dynamodbIcon from './assets/aws/dynamodb.svg';
import s3Icon from './assets/aws/s3.svg';
import sqsIcon from './assets/aws/sqs.svg';
import { t } from './i18n.js';

// role and where are message keys, except where a name needs no translation.
const STEPS = [
  { icon: Atom, title: 'React', role: 'arch.screen', where: 'arch.mainThread' },
  { icon: Radar, title: 'MSW', role: 'arch.mock', where: 'Service Worker' },
  { icon: Braces, title: 'Hono + AWS SDK v3', role: 'arch.handlers', where: 'arch.mainThread' },
];
const EDGES = ['fetch', 'arch.forward'];

const SERVICES = [
  { icon: dynamodbIcon, name: 'DynamoDB', use: 'arch.useTodos' },
  { icon: s3Icon, name: 'S3', use: 'arch.useNotes' },
  { icon: sqsIcon, name: 'SQS', use: 'arch.useActivity' },
];

function Edge({ label: key, className = '' }) {
  const label = t(key);
  return (
    <li className={`arch-edge ${className}`} aria-label={t('arch.passes', label)}>
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
        {t('arch.browser')}
        <span className="arch-chip">
          <CloudOff size={12} aria-hidden="true" />
          {t('arch.noServer')}
        </span>
      </figcaption>
      <ol className="arch-grid" aria-label={t('arch.label')}>
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
              <strong>{t('arch.emulator')}</strong>
              <span className="arch-where">Web Worker</span>
            </span>
            <span className="arch-status" role="img" aria-label={t(`arch.${state}`)} title={t(`arch.${state}`)} />
          </div>
          <ul className="arch-services" aria-label={t('arch.services')}>
            {SERVICES.map((s) => (
              <li key={s.name}>
                <img src={s.icon} alt="" width="40" height="40" />
                <span className="arch-text">
                  <strong>{s.name}</strong>
                  <span className="arch-role">{t(s.use)}</span>
                </span>
              </li>
            ))}
          </ul>
        </li>
      </ol>
    </figure>
  );
}

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
          <span className="arch-role">{t(step.role)}</span>
        </span>
        <span className="arch-where">{t(step.where)}</span>
      </li>
      {edge && <Edge label={edge} />}
    </>
  );
}
