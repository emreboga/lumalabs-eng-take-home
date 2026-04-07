import 'dotenv/config';
import { createServer } from 'http';
import { getExpressApp, initSlack, postToDM, postCheckpointDM, postPlanWithButtons } from './slack';
import { createAgentServer, setTextNotifier, setCheckpointNotifier, setPlanNotifier } from './ws-server';
import { initDb } from './db';
import './commands';
import './actions';

const PORT = process.env.PORT ?? 3000;

const server = createServer(getExpressApp());
createAgentServer(server);

server.listen(PORT, async () => {
  console.log(`[http] runafk-relay listening on port ${PORT}`);
  await initDb();
  setTextNotifier(postToDM);
  setCheckpointNotifier(postCheckpointDM);
  setPlanNotifier(postPlanWithButtons);
  initSlack();
});
