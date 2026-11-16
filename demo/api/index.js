// Entry point of the Web Function package (Lambda loads index.js at the package root).
// Run it locally the same way: TABLE_NAME=… BUCKET_NAME=… QUEUE_URL=… node api/index.js
import { createServerApp, listen } from './server.js';

const server = await listen(createServerApp());
const { address, port } = server.address();
console.log(JSON.stringify({ level: 'INFO', message: `listening on ${address}:${port}` }));

// Lambda sends SIGTERM before it removes the environment, and allows 1 second.
process.on('SIGTERM', () => {
  server.close();
  process.exit(0);
});
