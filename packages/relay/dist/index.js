"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const http_1 = require("http");
const slack_1 = require("./slack");
const ws_server_1 = require("./ws-server");
const PORT = process.env.PORT ?? 3000;
// Single HTTP server shared by Express (Slack events) and WS (agent connections)
const server = (0, http_1.createServer)((0, slack_1.getExpressApp)());
(0, ws_server_1.createAgentServer)(server);
server.listen(PORT, () => {
    console.log(`[http] runafk-relay listening on port ${PORT}`);
    (0, slack_1.initSlack)();
});
//# sourceMappingURL=index.js.map