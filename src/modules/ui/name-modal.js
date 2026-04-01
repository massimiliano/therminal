import { dom } from "../dom.js";

const DEFAULT_MODAL_TITLE = "Salva preset";
const DEFAULT_MODAL_PLACEHOLDER = "Nome del preset...";

export function openNameModal({
  mode = "preset",
  title = DEFAULT_MODAL_TITLE,
  placeholder = DEFAULT_MODAL_PLACEHOLDER,
  value = "",
  workspaceId = null,
} = {}) {
  dom.presetNameTitle.textContent = title;
  dom.presetNameInput.value = value;
  dom.presetNameInput.placeholder = placeholder;
  dom.presetNameModal.dataset.mode = mode;

  if (workspaceId) {
    dom.presetNameModal.dataset.workspaceId = workspaceId;
  } else {
    delete dom.presetNameModal.dataset.workspaceId;
  }

  dom.presetNameModal.classList.remove("hidden");
  dom.presetNameInput.focus();
  dom.presetNameInput.select();
}

export function closeNameModal() {
  dom.presetNameModal.classList.add("hidden");
  dom.presetNameTitle.textContent = DEFAULT_MODAL_TITLE;
  dom.presetNameInput.value = "";
  dom.presetNameInput.placeholder = DEFAULT_MODAL_PLACEHOLDER;
  delete dom.presetNameModal.dataset.mode;
  delete dom.presetNameModal.dataset.workspaceId;
}
