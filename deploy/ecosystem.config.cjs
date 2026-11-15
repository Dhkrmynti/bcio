// pm2 · `pm2 startOrRestart deploy/ecosystem.config.cjs --update-env`
const path = require("node:path");
module.exports = {
  apps: [{
    name: "bcio",
    cwd: path.join(__dirname, "..", "engine"),
    script: "src/server.js",
    node_args: "--env-file-if-exists=.env --max-old-space-size=220",
    // PORT/HOST di sini menang atas .env (Node --env-file tidak menimpa env yang sudah ada)
    env: { NODE_ENV: "production", PORT: 5860, HOST: "127.0.0.1" },
    max_memory_restart: "300M",
    time: true,
    autorestart: true,
    max_restarts: 20,
  }],
};
