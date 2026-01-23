/**
 * Modal de confirmación reutilizable
 */

/**
 * initModal - Inicializa el modal de confirmación
 * @param {Object} options
 * @param {HTMLElement} options.modal - Elemento contenedor del modal
 * @param {HTMLElement} options.modalMessage - Elemento para el mensaje
 * @param {HTMLElement} options.modalCancelBtn - Botón de cancelar
 * @param {HTMLElement} options.modalConfirmBtn - Botón de confirmar
 * @returns {{ showModal: Function, hideModal: Function }}
 */
export function initModal({
  modal,
  modalMessage,
  modalCancelBtn,
  modalConfirmBtn,
}) {
  let modalCallback = null;

  function showModal(message, confirmText, onConfirm) {
    modalMessage.textContent = message;
    modalConfirmBtn.textContent = confirmText;
    modalCallback = onConfirm;
    modal.hidden = false;
  }

  function hideModal() {
    modal.hidden = true;
    modalCallback = null;
  }

  // Event listeners
  modalCancelBtn.addEventListener("click", () => {
    hideModal();
  });

  modalConfirmBtn.addEventListener("click", () => {
    if (modalCallback) {
      modalCallback();
    }
    hideModal();
  });

  // Close modal on overlay click
  const overlay = modal.querySelector(".energy-modal-overlay");
  if (overlay) {
    overlay.addEventListener("click", () => {
      hideModal();
    });
  }

  return { showModal, hideModal };
}
