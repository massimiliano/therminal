import { agentCreatorDom } from "./core/dom/agent-creator.js";
import { appShellDom } from "./core/dom/app-shell.js";
import { sharedContextDom } from "./core/dom/shared-context.js";
import { voiceDom } from "./core/dom/voice.js";
import { wizardDom } from "./core/dom/wizard.js";
import { workspaceDom } from "./core/dom/workspace.js";

export const dom = {
  ...appShellDom,
  ...agentCreatorDom,
  ...wizardDom,
  ...sharedContextDom,
  ...workspaceDom,
  ...voiceDom
};
