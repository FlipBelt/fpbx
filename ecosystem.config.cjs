// The deployed native SQLite module is built against the bundled Node 22.
// PM2 resolves `interpreter: "node"` from its own environment (Node 18 on
// this ECS), so keep the production default explicit across future restarts.
const reimbursementNodeInterpreter = process.env.REIMBURSEMENT_NODE_INTERPRETER
  || (process.platform === "linux" ? "/opt/node-v22.23.2-linux-x64/bin/node" : "node");

module.exports = {
  apps: [{
    name: "reimbursement-assistant",
    script: "./server.mjs",
    cwd: __dirname,
    instances: 1,
    exec_mode: "fork",
    interpreter: reimbursementNodeInterpreter,
    env: {
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: 8793,
      REIMBURSEMENT_V2_ENABLED: "true",
      // 三步版试用必须按钉钉 userId 授权；姓名仅作为人工可读的冗余校验。
      REIMBURSEMENT_V2_EXPERIMENT_USER_IDS: "dingaygke3oh1kncubnv",
      REIMBURSEMENT_V2_EXPERIMENT_USER_NAMES: "十叶-冯硕硕",
      REIMBURSEMENT_V2_COMPACT_TEST_USER_IDS: "dingaygke3oh1kncubnv",
      REIMBURSEMENT_V2_COMPACT_TEST_USER_NAMES: "十叶-冯硕硕",
      REIMBURSEMENT_SCHEDULED_WORKFLOW_IDS: "daily,no_invoice,project,travel_transport",
      REIMBURSEMENT_ADMIN_WORKBENCH_ENABLED: "true",
      REIMBURSEMENT_ADMIN_WORKBENCH_READ_ENABLED: "true",
      REIMBURSEMENT_OSS_ARCHIVE_ENABLED: "true",
      REIMBURSEMENT_ADMIN_RETENTION_DAYS: "60",
      OSS_REGION: "cn-hangzhou",
      OSS_BUCKET: "cm-1",
      OSS_RAM_ROLE: "cm-ecs-oss-role",
      // Only the existing scheduled-approval administrators can use these
      // actions; every operation also needs a reason and is audit-recorded.
      REIMBURSEMENT_ADMIN_REPAIR_ENABLED: "true",
      REIMBURSEMENT_ADMIN_SUBMIT_ENABLED: "true",
      REIMBURSEMENT_ADMIN_MANUAL_CREATE_ENABLED: "true",
      REIMBURSEMENT_ON_BEHALF_ENABLED: "true",
    },
    env_production: {
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: 8793,
      REIMBURSEMENT_V2_ENABLED: "true",
      // 三步版试用必须按钉钉 userId 授权；姓名仅作为人工可读的冗余校验。
      REIMBURSEMENT_V2_EXPERIMENT_USER_IDS: "dingaygke3oh1kncubnv",
      REIMBURSEMENT_V2_EXPERIMENT_USER_NAMES: "十叶-冯硕硕",
      REIMBURSEMENT_V2_COMPACT_TEST_USER_IDS: "dingaygke3oh1kncubnv",
      REIMBURSEMENT_V2_COMPACT_TEST_USER_NAMES: "十叶-冯硕硕",
      REIMBURSEMENT_SCHEDULED_WORKFLOW_IDS: "daily,no_invoice,project,travel_transport",
      REIMBURSEMENT_ADMIN_WORKBENCH_ENABLED: "true",
      REIMBURSEMENT_ADMIN_WORKBENCH_READ_ENABLED: "true",
      REIMBURSEMENT_OSS_ARCHIVE_ENABLED: "true",
      REIMBURSEMENT_ADMIN_RETENTION_DAYS: "60",
      OSS_REGION: "cn-hangzhou",
      OSS_BUCKET: "cm-1",
      OSS_RAM_ROLE: "cm-ecs-oss-role",
      REIMBURSEMENT_ADMIN_REPAIR_ENABLED: "true",
      REIMBURSEMENT_ADMIN_SUBMIT_ENABLED: "true",
      REIMBURSEMENT_ADMIN_MANUAL_CREATE_ENABLED: "true",
      REIMBURSEMENT_ON_BEHALF_ENABLED: "true",
    },
    // 日志配置
    error_file: "./logs/err.log",
    out_file: "./logs/out.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss",
    // 自动重启
    max_restarts: 10,
    restart_delay: 3000,
    // 内存限制，超出自动重启
    max_memory_restart: "350M",
  }, {
    name: "reimbursement-scheduled-worker",
    script: "./scheduled-worker.mjs",
    cwd: __dirname,
    instances: 1,
    exec_mode: "fork",
    interpreter: reimbursementNodeInterpreter,
    env: {
      NODE_ENV: "production",
    },
    env_production: {
      NODE_ENV: "production",
    },
    error_file: "./logs/scheduled-worker-err.log",
    out_file: "./logs/scheduled-worker-out.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss",
    max_restarts: 10,
    restart_delay: 3000,
    max_memory_restart: "300M",
  }],
};
