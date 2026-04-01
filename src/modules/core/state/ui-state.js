export const state = {
  workspaceCounter: 0,
  activeView: "home",
  homePage: "home",
  wizardStep: 1,
  wizardClientCount: 0,
  wizardProviders: [],
  wizardInlineArgs: [],
  wizardBulkInlineArgs: {},
  currentFontSize: parseInt(localStorage.getItem("therminal-font-size")) || 13,
  maximizedSessionId: null,
  focusedSessionId: null,
  dragSessionId: null,
  broadcastMode: false
};
