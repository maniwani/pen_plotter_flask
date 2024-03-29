export function registerModalListeners() {
    document.addEventListener("DOMContentLoaded", () => {
        // Create functions to open and close modals.
        function openModal(modal) {
            modal.classList.add("is-active");
        }

        function closeModal(modal) {
            modal.classList.remove("is-active");
        }

        function closeAllModals() {
            (document.querySelectorAll(".modal") || []).forEach((modal) => {
                closeModal(modal);
            });
        }

        // Add a click event on buttons to open a specific modal.
        (document.querySelectorAll(".js-modal-trigger") || []).forEach((trigger) => {
            const modal = trigger.dataset.target;
            const target = document.getElementById(modal);
            trigger.addEventListener("click", () => {
                openModal(target);
            });
        });

        // Add a click event on various child elements to close the parent modal.
        (document.querySelectorAll(".modal-background, .modal-close, .modal-card-head .delete, .modal-card-foot .auto-close") || []).forEach((close) => {
            const target = close.closest(".modal");
            close.addEventListener("click", () => {
                closeModal(target);
            });
        });

        // Add a keyboard event to close all modals.
        document.addEventListener("keydown", (event) => {
            const e = event || window.event;
            if (e.keyCode === 27) { // Escape key
                closeAllModals();
            }
        });

        let backgroundUpload = document.getElementById("background-upload")
        if (backgroundUpload) {
            backgroundUpload.addEventListener("change", () => {
                closeAllModals();
            })
        }

        let backgroundFileDrop = document.getElementById("background-file-drop")
        if (backgroundFileDrop) {
            backgroundFileDrop.addEventListener("drop", () => {
                closeAllModals();
            })
        }

    });
}