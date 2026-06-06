// pm2 process definitions for the isolated LeadEcho e2e stack.
// Backend API on :8090, dashboard (vite dev) on :13100.
module.exports = {
  apps: [
    {
      name: "leadecho-api",
      script: "/opt/leadecho/.e2e/start-backend.sh",
      interpreter: "bash",
      cwd: "/opt/leadecho/.e2e",
      autorestart: true,
      max_restarts: 50,
      out_file: "/opt/leadecho/.e2e/logs/api.out.log",
      error_file: "/opt/leadecho/.e2e/logs/api.err.log",
      merge_logs: true,
    },
    {
      name: "leadecho-dash",
      script: "pnpm",
      args: "dev --port 13100 --host 127.0.0.1 --strictPort",
      cwd: "/opt/leadecho/dashboard",
      interpreter: "none",
      autorestart: true,
      max_restarts: 50,
      env: { VITE_API_URL: "" },
      out_file: "/opt/leadecho/.e2e/logs/dash.out.log",
      error_file: "/opt/leadecho/.e2e/logs/dash.err.log",
      merge_logs: true,
    },
  ],
};
