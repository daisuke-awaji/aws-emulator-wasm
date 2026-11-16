import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { setDocumentKeys } from './i18n.js';
import './styles.css';

setDocumentKeys({ title: 'doc.title', description: 'doc.description' });

// The build decides where the API is (target.js); the other runtime is not in the bundle.
const { start } = await (import.meta.env.VITE_API_URL ? import('./runtime-aws.js') : import('./runtime-emulator.js'));
createRoot(document.getElementById('root')).render(<App runtime={start()} />);
