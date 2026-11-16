import { setupWorker } from 'msw/browser';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { readyIn } from './emulator.js';
import { handlers } from './mocks/handlers.js';
import './styles.css';

const worker = setupWorker(...handlers);
// The emulator starts downloading at import time; MSW starts in parallel.
const mocking = worker.start({
  serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
  onUnhandledFrame: 'bypass',
  quiet: true,
});

createRoot(document.getElementById('root')).render(<App mocking={mocking} readyIn={readyIn} />);
