(function() {
  // Create Modal DOM
  const modalHtml = `
    <div id="custom-modal" class="modal-overlay">
      <div class="modal-box">
        <div class="modal-header">
          <h3 class="modal-title" id="modal-title"></h3>
        </div>
        <div class="modal-body">
          <p id="modal-message"></p>
          <div id="modal-input-container" style="display: none;">
            <input type="text" id="modal-input" class="modal-input" autocomplete="off">
          </div>
        </div>
        <div class="modal-actions">
          <button id="modal-cancel" class="modal-btn modal-btn-cancel">取消</button>
          <button id="modal-confirm" class="modal-btn modal-btn-confirm">确认</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);

  const modal = document.getElementById('custom-modal');
  const titleEl = document.getElementById('modal-title');
  const messageEl = document.getElementById('modal-message');
  const inputContainer = document.getElementById('modal-input-container');
  const inputEl = document.getElementById('modal-input');
  const cancelBtn = document.getElementById('modal-cancel');
  const confirmBtn = document.getElementById('modal-confirm');

  let currentResolve = null;

  function close() {
    modal.classList.remove('open');
    setTimeout(() => {
      inputEl.value = '';
      // Reset button visibility for next use
      cancelBtn.style.display = ''; 
      confirmBtn.textContent = '确认';
      confirmBtn.className = 'modal-btn modal-btn-confirm';
      
      if (currentResolve) {
        currentResolve(null); // Cancelled
        currentResolve = null;
      }
    }, 200);
  }

  cancelBtn.addEventListener('click', () => close());
  
  // Close on click outside
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  confirmBtn.addEventListener('click', () => {
    if (currentResolve) {
      const val = inputContainer.style.display !== 'none' ? inputEl.value : true;
      currentResolve(val);
      currentResolve = null;
    }
    modal.classList.remove('open');
  });

  inputEl.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') confirmBtn.click();
  });

  window.Modal = {
    confirm: (title, message, options = {}) => {
      return new Promise((resolve) => {
        currentResolve = resolve;
        titleEl.textContent = title;
        messageEl.textContent = message;
        inputContainer.style.display = 'none';
        
        cancelBtn.style.display = ''; // Show cancel
        confirmBtn.className = 'modal-btn modal-btn-confirm';
        if (options.danger) {
          confirmBtn.classList.add('modal-btn-danger');
        }
        confirmBtn.textContent = options.confirmText || '确认';

        modal.classList.add('open');
      });
    },
    prompt: (title, message, defaultValue = '') => {
      return new Promise((resolve) => {
        currentResolve = resolve;
        titleEl.textContent = title;
        messageEl.textContent = message;
        inputContainer.style.display = 'block';
        inputEl.value = defaultValue;
        inputEl.focus();
        
        cancelBtn.style.display = ''; // Show cancel
        confirmBtn.className = 'modal-btn modal-btn-confirm';
        confirmBtn.textContent = '确认';

        modal.classList.add('open');
        setTimeout(() => inputEl.focus(), 100);
      });
    },
    custom: (title, content, buttons = [], options = {}) => {
      return new Promise((resolve) => {
        currentResolve = resolve;
        titleEl.textContent = title;

        // Clear message element and append content (supports both HTML string and DOM element)
        messageEl.innerHTML = '';
        messageEl.style.display = 'block';
        if (typeof content === 'string') {
          messageEl.innerHTML = content;
        } else if (content instanceof HTMLElement) {
          messageEl.appendChild(content);
        }
        inputContainer.style.display = 'none';

        // Get actions container
        const actionsEl = modal.querySelector('.modal-actions');

        // Save default buttons if not already saved
        if (!actionsEl.dataset.hasDefaultButtons) {
          // Store references to default buttons in dataset
          actionsEl.dataset.hasDefaultButtons = 'true';
        }

        if (buttons && buttons.length > 0) {
          // Hide default buttons instead of removing them
          cancelBtn.style.display = 'none';
          confirmBtn.style.display = 'none';

          // Remove any existing custom buttons
          const existingCustom = actionsEl.querySelectorAll('.modal-custom-btn');
          existingCustom.forEach(b => b.remove());

          // Add custom buttons
          buttons.forEach(btn => {
            const btnEl = document.createElement('button');
            btnEl.type = 'button';
            btnEl.textContent = btn.text;
            btnEl.className = btn.primary ? 'modal-btn modal-btn-confirm modal-custom-btn' : 'modal-btn modal-btn-cancel modal-custom-btn';
            if (btn.danger) btnEl.classList.add('modal-btn-danger');
            btnEl.addEventListener('click', () => {
              if (currentResolve) {
                currentResolve(btn.value);
                currentResolve = null;
              }
              modal.classList.remove('open');
              // Restore default buttons after modal closes
              setTimeout(() => {
                const customBtns = actionsEl.querySelectorAll('.modal-custom-btn');
                customBtns.forEach(b => b.remove());
                cancelBtn.style.display = '';
                confirmBtn.style.display = '';
                cancelBtn.textContent = '取消';
                confirmBtn.textContent = '确认';
                confirmBtn.className = 'modal-btn modal-btn-confirm';
              }, 200);
            });
            actionsEl.appendChild(btnEl);
          });
        } else {
          // Show default buttons
          cancelBtn.style.display = options.showCancel === false ? 'none' : '';
          confirmBtn.style.display = '';
          confirmBtn.className = 'modal-btn modal-btn-confirm';
          confirmBtn.textContent = options.confirmText || '确认';
        }

        modal.classList.add('open');
      });
    }
  };

  // Create version badge
  if (window.APP_VERSION) {
    const versionBadge = document.createElement('div');
    versionBadge.className = 'version-badge';
    versionBadge.textContent = window.APP_VERSION;
    document.body.appendChild(versionBadge);
  }
})();
