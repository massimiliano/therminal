import { dom } from "./dom.js";
import { state } from "./state.js";

const HOME_PAGES = new Set(["home", "usage", "status", "agents"]);

function normalizeHomePage(pageId) {
  return HOME_PAGES.has(pageId) ? pageId : "home";
}

function getServiceStatusPanel() {
  return dom.serviceStatusList?.closest("aside") || null;
}

function getUsageSummaryPanel() {
  return dom.usageSummaryList?.closest(".rounded-2xl") || null;
}

function syncHomeNavState(activePage) {
  dom.homePageTabs?.querySelectorAll("button[data-home-page]").forEach((button) => {
    const isActive = button.dataset.homePage === activePage;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function getHomePageHost() {
  return dom.homeOverview?.parentElement || null;
}

function ensurePageContainer(id) {
  const host = getHomePageHost();
  let panel = host?.querySelector(`#${id}`) || null;
  if (panel) {
    if (host && panel.parentElement !== host) {
      host.insertBefore(panel, dom.step2El || null);
    }
    return panel;
  }

  panel = document.createElement("section");
  panel.id = id;
  panel.className = "home-page-surface hidden";
  if (host) {
    host.insertBefore(panel, dom.step2El || null);
  }
  return panel;
}

function ensureHomePageLayout() {
  if (!dom.homeView || !dom.homeOverview) {
    return;
  }

  const homeGrid = dom.homeOverview.querySelector(":scope > .grid");
  const serviceStatusPanel = getServiceStatusPanel();
  const usageSummaryPanel = getUsageSummaryPanel();

  const usagePage = ensurePageContainer("homeUsagePage");
  const statusPage = ensurePageContainer("homeStatusPage");
  const agentPage = ensurePageContainer("homeAgentPage");

  if (homeGrid) {
    homeGrid.classList.add("home-launch-grid");
  }

  if (usagePage && usageSummaryPanel && usageSummaryPanel.parentElement !== usagePage) {
    usagePage.append(usageSummaryPanel);
  }
  if (statusPage && serviceStatusPanel && serviceStatusPanel.parentElement !== statusPage) {
    statusPage.append(serviceStatusPanel);
  }
  if (agentPage && dom.agentCreatorSection && dom.agentCreatorSection.parentElement !== agentPage) {
    agentPage.append(dom.agentCreatorSection);
  }
}

function syncHomePageVisibility(activePage) {
  ensureHomePageLayout();

  const isHomePage = activePage === "home";
  const isUsagePage = activePage === "usage";
  const isStatusPage = activePage === "status";
  const isAgentsPage = activePage === "agents";
  const isWizardLaunchStep = isHomePage && state.wizardStep === 1;
  const isWizardConfigStep = isHomePage && state.wizardStep === 2;
  const homeGrid = dom.homeOverview?.querySelector(":scope > .grid");

  dom.homeOverview?.classList.toggle("hidden", !isWizardLaunchStep);
  getHomePageHost()?.querySelector("#homeUsagePage")?.classList.toggle("hidden", !isUsagePage);
  getHomePageHost()?.querySelector("#homeStatusPage")?.classList.toggle("hidden", !isStatusPage);
  getHomePageHost()?.querySelector("#homeAgentPage")?.classList.toggle("hidden", !isAgentsPage);

  homeGrid?.classList.toggle("hidden", !isWizardLaunchStep);
  dom.step1El?.classList.toggle("hidden", !isWizardLaunchStep);
  dom.step2El?.classList.toggle("hidden", !isWizardConfigStep);
}

export function showHomePage(pageId = "home", { scroll = true } = {}) {
  const nextPage = normalizeHomePage(pageId);
  state.homePage = nextPage;
  syncHomePageVisibility(nextPage);
  syncHomeNavState(nextPage);

  if (scroll) {
    dom.homeView?.scrollTo({ top: 0, behavior: "smooth" });
  }
}

export function initHomePages() {
  ensureHomePageLayout();

  dom.homeView?.querySelectorAll("button[data-home-page]").forEach((button) => {
    if (button.dataset.bound === "true") {
      return;
    }

    button.dataset.bound = "true";
    button.addEventListener("click", () => {
      showHomePage(button.dataset.homePage || "home");
    });
  });

  showHomePage(state.homePage || "home", { scroll: false });
}
