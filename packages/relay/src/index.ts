import 'dotenv/config';
import { createServer } from 'http';
import { getExpressApp, initSlack } from './slack';
import { createAgentServer } from './ws-server';

const PORT = process.env.PORT ?? 3000;

// Single HTTP server shared by Express (Slack events) and WS (agent connections)
const server = createServer(getExpressApp());
createAgentServer(server);

server.listen(PORT, () => {
  console.log(`[http] runafk-relay listening on port ${PORT}`);
  initSlack();
});
