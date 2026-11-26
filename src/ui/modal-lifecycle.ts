/** Register resources owned by a modal so ScreenStack can release them on removal. */
const modalCleanups = new WeakMap<HTMLElement, () => void>();

export function registerModalCleanup(modal: HTMLElement, cleanup: () => void): void {
  modalCleanups.set(modal, cleanup);
}

export function disposeModal(modal: HTMLElement): void {
  const cleanup = modalCleanups.get(modal);
  if (!cleanup) return;
  modalCleanups.delete(modal);
  cleanup();
}
