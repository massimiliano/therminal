import { fitStructuralTerminalChange } from "./resize-policy.js";

export function attachSessionToHost(
  session,
  host,
  { preserveWorkspaceHost = false, fit = false } = {}
) {
  if (!session?.cell || !host) {
    return false;
  }

  if (!preserveWorkspaceHost) {
    session.host = host;
  }

  if (session.attachedHost === host && session.cell.parentNode === host) {
    return false;
  }

  host.append(session.cell);
  session.attachedHost = host;

  if (fit) {
    requestAnimationFrame(() => fitStructuralTerminalChange(session.id));
  }

  return true;
}
