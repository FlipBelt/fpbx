process.env.REIMBURSEMENT_SCHEDULED_WORKER = "1";

const { startScheduledApprovalWorker } = await import("./server.mjs");
const result = startScheduledApprovalWorker();

if (!result.enabled) {
  console.log("Scheduled approval worker is disabled by configuration.");
  // Keep the PM2 process healthy while the feature flag is off. Enabling the
  // module later only requires a normal PM2 restart with updated config.
  const idleTimer = setInterval(() => {}, 60 * 60 * 1000);
  const stopIdle = () => {
    clearInterval(idleTimer);
    process.exit(0);
  };
  process.on("SIGINT", stopIdle);
  process.on("SIGTERM", stopIdle);
} else {
  const shutdown = () => {
    result.scheduler?.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
