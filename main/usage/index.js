const { getLatestActiveSession } = require("../session");
const { createUsagePanelManager } = require("./panel");
const { createServiceStatusManager } = require("./services");
const { createUsageSummaryManager } = require("./summaries");

const usageSummaryManager = createUsageSummaryManager({ getLatestActiveSession });
const usagePanelManager = createUsagePanelManager({ getLatestActiveSession });
const serviceStatusManager = createServiceStatusManager();

function invalidateUsageSummaryCache() {
  usageSummaryManager.invalidateUsageSummaryCache();
}

function registerUsageIpcHandlers(ipcMain) {
  ipcMain.handle("usage:summary", () => usageSummaryManager.getUsageSummary());
  ipcMain.handle("usage:panel", (_event, payload) => usagePanelManager.getUsagePanelSummary(payload || {}));
  ipcMain.handle("usage:panel-provider", (_event, payload) => usagePanelManager.getUsagePanelProvider(payload || {}));
  ipcMain.handle("services:status", (_event, payload) => serviceStatusManager.getServiceStatuses(Boolean(payload?.force)));
}

module.exports = {
  invalidateUsageSummaryCache,
  registerUsageIpcHandlers
};
