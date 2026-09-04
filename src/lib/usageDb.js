// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  trackActiveSession, getActiveSessions,
  saveRequestUsage, getUsageHistory, getUsageStats, getUsageStatsInRange, getChartData,
  appendRequestLog, getRecentLogs,
  saveRequestDetail, getRequestDetails, getRequestDetailById,
} from "./db/index.js";
