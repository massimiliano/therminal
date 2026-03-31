import { dom } from "./dom.js";
import { showNotice } from "./notices.js";
import { launchWorkspaceFromConfig } from "./workspace.js";
import { sessionStore, state, workspaces } from "./state.js";
import { showHomePage } from "./home-pages.js";

const PROMPT_DISPATCH_DELAY_MS = 900;
const DEFAULT_AGENT_CREATOR_PROVIDER = "codex";
const AGENT_CREATOR_PROVIDERS = {
  codex: {
    provider: "codex",
    label: "Codex",
    heroLabel: "Codex Agents",
    outputPath: ".codex/agents/",
    outputFormat: "TOML",
    buttonLabel: "Avvia Codex",
    badgeIcon: "bi bi-terminal",
    prompt: `Sei un Lead Software Architect esperto in automazione dello sviluppo e sistemi Multi-Agente.

Il tuo compito e analizzare la codebase del progetto corrente e generare una suite completa di subagenti personalizzati per la CLI di OpenAI Codex.

Per farlo correttamente, devi aderire rigorosamente a questo schema tecnico per la creazione dei file TOML degli agenti.

SCHEMA TOML DEI SUBAGENTI CODEX:

Ogni agente deve essere definito in un file .toml separato.

Campi supportati:

- name (string, REQUIRED): Nome identificativo dell'agente (es. "db_guru"). Senza spazi.

- description (string, REQUIRED): Spiegazione di quando l'agente orchestratore dovrebbe delegare a questo subagente.

- developer_instructions (string, REQUIRED): Le istruzioni core. Devono essere iper-specifiche, citare i file/moduli del progetto di sua competenza e definire il suo comportamento esatto.

- model (string, OPTIONAL): Imposta "gpt-5.4" per ragionamenti complessi (architettura, sicurezza) o "gpt-5.4-mini" per compiti di ricerca/mappatura veloci.

- sandbox_mode (string, OPTIONAL): Imposta "read-only" (consigliato per ispezioni e review) o "workspace-write" (solo se l'agente deve implementare fix attivamente).

REGOLE DI ARCHITETTURA DEGLI AGENTI:

1. Analizza l'intera struttura delle directory e individua i domini logici principali (es. Frontend, Backend, Database, Configurazione, UI, Sicurezza).

2. Genera un agente specializzato per ogni dominio critico per evitare "context pollution" (sovrapposizione di compiti).

3. Assicurati che le 'developer_instructions' siano calate nel contesto del progetto che stai leggendo, menzionando le tecnologie e i pattern che trovi.

FORMATO DI OUTPUT:

Genera esclusivamente l'elenco dei file da creare all'interno della cartella .codex/agents/, seguiti dal blocco di codice TOML. Non inserire preamboli, spiegazioni o testo fuori dai blocchi di codice.

Esempio:

File: .codex/agents/router_expert.toml

toml

name = "router_expert"

description = "Gestisce esclusivamente le rotte e i middleware."

model = "gpt-5.4-mini"

sandbox_mode = "read-only"

developer_instructions = """

Analizza i file in /routes.

Verifica la corretta applicazione dei middleware di autenticazione...

"""`,
  },
  claude: {
    provider: "claude",
    label: "Claude",
    heroLabel: "Claude Agents",
    outputPath: ".claude/agents/",
    outputFormat: "Markdown + YAML",
    buttonLabel: "Avvia Claude",
    badgeIcon: "bi bi-stars",
    prompt: `Sei un Lead Software Architect esperto in sistemi Multi-Agente e automazione dello sviluppo.

Il tuo compito e analizzare l'architettura del progetto corrente e generare una suite completa di subagenti personalizzati per Claude Code.

Per farlo correttamente, devi aderire rigorosamente a questo schema tecnico per la creazione dei file Markdown con YAML frontmatter.

SCHEMA DEI SUBAGENTI CLAUDE CODE:

Ogni agente deve essere definito in un file .md separato all'interno della cartella .claude/agents/.

Il file deve iniziare con un blocco frontmatter YAML (delimitato da ---) contenente la configurazione, seguito dal corpo del testo che fungera da system prompt.

Campi frontmatter supportati e regole di utilizzo:

- name (REQUIRED): Nome identificativo in kebab-case (es. db-guru, electron-shield).

- description (REQUIRED): Spiegazione chiara e dettagliata di quando Claude dovrebbe delegare i task a questo subagente.

- model (OPTIONAL): Usa sonnet per ragionamenti complessi e scrittura di codice; usa haiku per esplorazione veloce e sola lettura.

- tools (OPTIONAL): Lista separata da virgole dei tool permessi (es. Read, Grep, Glob, Bash, Edit, Write).

- disallowedTools (OPTIONAL): Lista dei tool da negare esplicitamente.

- memory (OPTIONAL): Imposta su project per abilitare la memoria persistente e far ricordare all'agente le decisioni architetturali tra diverse conversazioni.

- permissionMode (OPTIONAL): Opzioni valide: default, acceptEdits, dontAsk, plan.

REGOLE DI GENERAZIONE:

1. Analizza l'intera codebase e individua i domini logici principali.

2. Genera un subagente specializzato per ogni strato o modulo critico per evitare context pollution.

3. Il corpo del file Markdown deve contenere istruzioni iper-focalizzate, citando i file reali del progetto di cui l'agente e responsabile.

4. Per agenti di indagine/ispezione: limita gli strumenti in frontmatter (es. tools: Read, Grep, Glob, Bash) e usa model: haiku.

5. Per agenti di implementazione/refactoring: consenti l'editing, usa model: sonnet e abilita memory: project.

FORMATO DI OUTPUT RICHIESTO:

Genera esclusivamente l'elenco dei file da creare, ciascuno seguito dal proprio blocco di codice completo. Non inserire alcun preambolo, saluto, spiegazione o testo al di fuori dell'output richiesto.

Esempio di formato:

File: .claude/agents/router-expert.md

markdown

---

name: router-expert

description: Gestisce le rotte, i middleware e il passaggio di stato della navigazione.

tools: Read, Grep, Glob

model: haiku

memory: project

---

Sei l'architetto del routing di questo progetto. Analizza i file di navigazione e verifica che...`,
  },
};

let selectedAgentCreatorProvider = DEFAULT_AGENT_CREATOR_PROVIDER;

function getAgentCreatorConfig() {
  return AGENT_CREATOR_PROVIDERS[selectedAgentCreatorProvider] || AGENT_CREATOR_PROVIDERS[DEFAULT_AGENT_CREATOR_PROVIDER];
}

function getTrailingPathLabel(input) {
  if (typeof input !== "string") {
    return "";
  }

  const normalized = input.trim().replace(/[\\/]+$/, "");
  if (!normalized || normalized === "." || normalized === "..") {
    return "";
  }

  const segments = normalized.split(/[\\/]/).filter(Boolean);
  const lastSegment = segments[segments.length - 1];
  return lastSegment && !/^[A-Za-z]:$/.test(lastSegment) ? lastSegment : "";
}

function getActiveWorkspacePath() {
  const activeWorkspace = workspaces.get(state.activeView);
  return activeWorkspace?.clients?.find((client) => client.cwd)?.cwd || "";
}

function getPreferredProjectPath() {
  const currentValue = dom.agentCreatorProjectPath?.value?.trim();
  if (currentValue && currentValue !== ".") {
    return currentValue;
  }

  const activeWorkspacePath = getActiveWorkspacePath();
  if (activeWorkspacePath) {
    return activeWorkspacePath;
  }

  const wizardPath = dom.cwdInput?.value?.trim();
  if (wizardPath) {
    return wizardPath;
  }

  return ".";
}

function buildWorkspaceName(projectPath) {
  const config = getAgentCreatorConfig();
  const projectLabel = getTrailingPathLabel(projectPath) || "project";
  return `${config.label} Agents - ${projectLabel}`;
}

function syncProviderButtons() {
  document.querySelectorAll("[data-agent-creator-provider]").forEach((button) => {
    const isSelected = button.dataset.agentCreatorProvider === selectedAgentCreatorProvider;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", isSelected ? "true" : "false");
  });
}

function syncProviderUi() {
  const config = getAgentCreatorConfig();

  if (dom.agentCreatorPrompt) {
    dom.agentCreatorPrompt.value = config.prompt;
  }
  if (dom.agentCreatorProviderBadge) {
    dom.agentCreatorProviderBadge.innerHTML = `<i class="${config.badgeIcon}"></i>${config.label}`;
  }
  if (dom.agentCreatorOutputPath) {
    dom.agentCreatorOutputPath.textContent = config.outputPath;
  }
  if (dom.agentCreatorOutputFormat) {
    dom.agentCreatorOutputFormat.textContent = config.outputFormat;
  }
  if (dom.agentCreatorLaunchBtn) {
    dom.agentCreatorLaunchBtn.innerHTML = `<span>${config.buttonLabel}</span><i class="bi bi-play-fill"></i>`;
  }

  syncProviderButtons();
  updateSummary();
}

function updateSummary() {
  if (!dom.agentCreatorSummary) {
    return;
  }

  const config = getAgentCreatorConfig();
  const projectLabel = getTrailingPathLabel(dom.agentCreatorProjectPath?.value) || "project";
  dom.agentCreatorSummary.textContent = `Verrà avviata una singola sessione ${config.label} nel progetto ${projectLabel}. Il prompt bootstrap chiederà di analizzare la codebase e generare gli agenti in ${config.outputPath}.`;
}

function syncSuggestedProjectPath() {
  if (!dom.agentCreatorProjectPath) {
    return;
  }

  if (!dom.agentCreatorProjectPath.value.trim() || dom.agentCreatorProjectPath.value.trim() === ".") {
    dom.agentCreatorProjectPath.value = getPreferredProjectPath();
  }
}

function focusAgentCreatorProjectPath() {
  dom.agentCreatorProjectPath?.focus();
  dom.agentCreatorProjectPath?.setSelectionRange?.(
    dom.agentCreatorProjectPath.value.length,
    dom.agentCreatorProjectPath.value.length
  );
}

function openAgentCreatorSection() {
  syncSuggestedProjectPath();
  syncProviderUi();
  showHomePage("agents");
  window.setTimeout(() => focusAgentCreatorProjectPath(), 180);
}

function selectAgentCreatorProvider(provider) {
  if (!AGENT_CREATOR_PROVIDERS[provider]) {
    return;
  }

  selectedAgentCreatorProvider = provider;
  syncProviderUi();
}

function buildAgentClient(projectPath) {
  const config = getAgentCreatorConfig();
  return [{
    id: "agent-creator-1",
    provider: config.provider,
    inlineArgs: "",
    cwd: projectPath,
    taskStatus: "todo",
  }];
}

function dispatchPromptToWorkspace(workspace) {
  const config = getAgentCreatorConfig();
  const sessionId = workspace?.clients
    ?.map((client) => client.sessionId)
    .find((currentSessionId) => typeof currentSessionId === "string" && sessionStore.has(currentSessionId));

  if (!sessionId) {
    return;
  }

  window.setTimeout(() => {
    window.launcherAPI.writeSession(sessionId, `${config.prompt}\r`);
  }, PROMPT_DISPATCH_DELAY_MS);
}

async function handleBrowseProjectPath() {
  const selectedPath = await window.launcherAPI.openDirectoryDialog(getPreferredProjectPath());
  if (!selectedPath) {
    return;
  }

  dom.agentCreatorProjectPath.value = selectedPath;
  if (dom.cwdInput) {
    dom.cwdInput.value = selectedPath;
  }
  updateSummary();
}

async function handleLaunchAgentCreator() {
  const config = getAgentCreatorConfig();
  const projectPath = dom.agentCreatorProjectPath?.value?.trim() || "";
  if (!projectPath) {
    showNotice("Seleziona prima il path del progetto.", { type: "warning", timeoutMs: 2800 });
    dom.agentCreatorProjectPath?.focus();
    return;
  }

  if (dom.cwdInput) {
    dom.cwdInput.value = projectPath;
  }

  const originalButtonText = dom.agentCreatorLaunchBtn?.innerHTML;
  if (dom.agentCreatorLaunchBtn) {
    dom.agentCreatorLaunchBtn.disabled = true;
    dom.agentCreatorLaunchBtn.innerHTML = '<span>Avvio...</span><i class="bi bi-hourglass-split"></i>';
  }

  try {
    const workspace = await launchWorkspaceFromConfig({
      name: buildWorkspaceName(projectPath),
      cwd: projectPath,
      clients: buildAgentClient(projectPath),
    });

    if (!workspace) {
      return;
    }

    dispatchPromptToWorkspace(workspace);
    showNotice(`${config.label} avviato con il prompt bootstrap di Agent Creator.`, {
      type: "success",
      timeoutMs: 3200,
    });
  } catch (error) {
    console.error("Agent Creator launch failed:", error);
    showNotice(error?.message || "Impossibile avviare Agent Creator.", { type: "error" });
  } finally {
    if (dom.agentCreatorLaunchBtn) {
      dom.agentCreatorLaunchBtn.disabled = false;
      dom.agentCreatorLaunchBtn.innerHTML = originalButtonText || `<span>${config.buttonLabel}</span><i class="bi bi-play-fill"></i>`;
    }
  }
}

export function initAgentCreator() {
  if (
    !dom.agentCreatorSection ||
    !dom.agentCreatorProjectPath ||
    !dom.agentCreatorBrowseBtn ||
    !dom.agentCreatorPrompt ||
    !dom.agentCreatorLaunchBtn
  ) {
    return;
  }

  syncSuggestedProjectPath();
  syncProviderUi();

  dom.agentCreatorIntroBtn?.addEventListener("click", () => openAgentCreatorSection());
  document.querySelectorAll("[data-agent-creator-provider]").forEach((button) => {
    button.addEventListener("click", () => {
      selectAgentCreatorProvider(button.dataset.agentCreatorProvider || DEFAULT_AGENT_CREATOR_PROVIDER);
    });
  });
  dom.agentCreatorBrowseBtn.addEventListener("click", () => {
    void handleBrowseProjectPath();
  });
  dom.agentCreatorProjectPath.addEventListener("input", () => updateSummary());
  dom.agentCreatorProjectPath.addEventListener("focus", () => {
    if (!dom.agentCreatorProjectPath.value.trim()) {
      syncSuggestedProjectPath();
      updateSummary();
    }
  });
  dom.agentCreatorLaunchBtn.addEventListener("click", () => {
    void handleLaunchAgentCreator();
  });
}
