/**
 * ZOCO FITTING — Frontend Application Logic
 * ==========================================
 * Módulos:
 *  1. State Manager      — estado de las 3 imágenes
 *  2. Drop Zone Manager  — drag & drop para cada zona
 *  3. Preview Manager    — actualiza la imagen central
 *  4. API Client         — POST /api/tryon al servidor local
 *  5. UI State           — loader, errores, toasts
 *  6. Download Manager   — descarga la imagen generada
 *  7. Zoom Controls      — zoom in/out/reset de la imagen
 *  8. Theme Toggle       — dark/light mode
 *  9. Modal              — modal "Cómo funciona"
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   1. STATE MANAGER
═══════════════════════════════════════════════════════════════ */
const state = {
  // Archivos seleccionados por el usuario
  files: {
    model: null,
    top: null,
    bottom: null
  },
  // Flag: imagen fue inicializada con default (no contada como "subida por usuario")
  defaultLoaded: {
    model: false,
    top: false,
    bottom: false
  },
  // URL de la imagen generada
  generatedImageUrl: null,
  // Zoom level
  zoomLevel: 1,
  zoomStep: 0.15,
  zoomMin: 0.5,
  zoomMax: 3,
  // Estado de generación
  isGenerating: false
};

/**
 * Verifica si el usuario ha subido las prendas (top y bottom).
 * El modelo es fijo y siempre está disponible.
 */
function areAllImagesLoaded() {
  return !!(state.files.top && state.files.bottom);
}

/* ═══════════════════════════════════════════════════════════════
   2. DOM REFERENCES
═══════════════════════════════════════════════════════════════ */
const dom = {
  // Preview central
  previewImage:     document.getElementById('previewImage'),
  previewLoader:    document.getElementById('previewLoader'),
  previewError:     document.getElementById('previewError'),
  previewErrorMsg:  document.getElementById('previewErrorMsg'),
  previewPlaceholder: document.getElementById('previewPlaceholder'),
  retryBtn:         document.getElementById('retryBtn'),

  // Controles
  downloadBtn:      document.getElementById('downloadBtn'),
  generateBtn:      document.getElementById('generateBtn'),
  zoomInBtn:        document.getElementById('zoomInBtn'),
  zoomOutBtn:       document.getElementById('zoomOutBtn'),
  zoomResetBtn:     document.getElementById('zoomResetBtn'),

  // Upload zones
  topDropZone:      document.getElementById('topDropZone'),
  topInput:         document.getElementById('topInput'),
  topThumb:         document.getElementById('topThumb'),
  topCheck:         document.getElementById('topCheck'),

  bottomDropZone:   document.getElementById('bottomDropZone'),
  bottomInput:      document.getElementById('bottomInput'),
  bottomThumb:      document.getElementById('bottomThumb'),
  bottomCheck:      document.getElementById('bottomCheck'),

  modelDropZone:    document.getElementById('modelDropZone'),
  modelInput:       document.getElementById('modelInput'),
  modelThumb:       document.getElementById('modelThumb'),
  modelCheck:       document.getElementById('modelCheck'),

  // Footer
  footerMsg:        document.getElementById('footerMsg'),

  // Toasts
  toastContainer:   document.getElementById('toastContainer'),

  // Modal
  modalOverlay:     document.getElementById('modalOverlay'),
  modalClose:       document.getElementById('modalClose'),
  howItWorksBtn:    document.getElementById('howItWorksBtn'),

  // Theme
  themeToggle:      document.getElementById('themeToggle')
};

/* ═══════════════════════════════════════════════════════════════
   3. DROP ZONE MANAGER
═══════════════════════════════════════════════════════════════ */

/**
 * Configura una zona de drop para una imagen específica.
 * @param {HTMLElement} dropZone - El elemento de la zona de drop
 * @param {HTMLInputElement} input - El input file oculto
 * @param {'model'|'top'|'bottom'} target - El tipo de imagen
 */
function setupDropZone(dropZone, input, target) {

  // Click en la zona → abre el selector de archivos
  dropZone.addEventListener('click', (e) => {
    // No abrir si se hace clic directamente en el input
    if (e.target !== input) {
      input.click();
    }
  });

  // Keyboard: Enter/Space abre el selector
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });

  // Drag over
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
  });

  // Drop
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        handleFileSelection(target, file);
      } else {
        showToast('Por favor sube solo imágenes (JPG, PNG, WebP)', 'error');
      }
    }
  });

  // Input change (file picker)
  input.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelection(target, file);
    }
    // Reset el input para poder subir el mismo archivo de nuevo
    input.value = '';
  });
}

/**
 * Procesa un archivo de imagen seleccionado.
 */
function handleFileSelection(target, file) {
  // Validar tipo
  if (!file.type.startsWith('image/')) {
    showToast('Formato no válido. Usa JPG, PNG o WebP', 'error');
    return;
  }

  // Validar tamaño (máx 20MB)
  if (file.size > 20 * 1024 * 1024) {
    showToast('La imagen es muy grande. Máximo 20MB', 'error');
    return;
  }

  // Guardar en estado
  state.files[target] = file;
  state.defaultLoaded[target] = false;

  // Crear URL temporal para preview
  const url = URL.createObjectURL(file);

  // Actualizar thumbnail y checkmark
  updateThumbnail(target, url);

  // Si es el modelo, actualizar la preview central
  if (target === 'model') {
    updateMainPreview(url);
  }

  // Actualizar estado del botón GENERAR
  updateGenerateButton();

  // Actualizar mensaje del footer
  updateFooterMsg();
}

/**
 * Actualiza el thumbnail y el checkmark de una zona.
 */
function updateThumbnail(target, url) {
  const thumbMap = { model: dom.modelThumb, top: dom.topThumb, bottom: dom.bottomThumb };
  const checkMap = { model: dom.modelCheck, top: dom.topCheck, bottom: dom.bottomCheck };
  const placeholderMap = {
    model: document.getElementById('modelPlaceholder'),
    top: document.getElementById('topPlaceholder'),
    bottom: document.getElementById('bottomPlaceholder')
  };

  const thumb = thumbMap[target];
  const check = checkMap[target];
  const placeholder = placeholderMap[target];

  if (thumb) {
    thumb.src = url;
    thumb.style.display = 'block';
  }

  if (placeholder) {
    placeholder.style.display = 'none';
  }

  if (check) {
    check.classList.add('is-checked');
  }
}

/* ═══════════════════════════════════════════════════════════════
   4. PREVIEW MANAGER
═══════════════════════════════════════════════════════════════ */

/**
 * Actualiza la imagen en el área central de preview.
 */
function updateMainPreview(url, animate = true) {
  const img = dom.previewImage;

  img.style.display = 'block';

  if (animate) {
    img.classList.add('fading');
    setTimeout(() => {
      img.src = url;
      img.classList.remove('fading');
      img.style.opacity = '1';
    }, 300);
  } else {
    img.src = url;
    img.style.opacity = '1';
  }
}

/* ═══════════════════════════════════════════════════════════════
   5. UI STATE
═══════════════════════════════════════════════════════════════ */

function showLoader() {
  dom.previewLoader.hidden = false;
  dom.previewLoader.setAttribute('aria-busy', 'true');
  dom.previewError.hidden = true;
  dom.generateBtn.classList.add('is-loading');
  dom.generateBtn.disabled = true;
  state.isGenerating = true;
}

function hideLoader() {
  dom.previewLoader.hidden = true;
  dom.previewLoader.setAttribute('aria-busy', 'false');
  dom.generateBtn.classList.remove('is-loading');
  state.isGenerating = false;
  updateGenerateButton();
}

function showError(message) {
  hideLoader();
  dom.previewError.hidden = false;
  dom.previewErrorMsg.textContent = message || 'Ocurrió un error al generar la imagen.';
}

function hideError() {
  dom.previewError.hidden = true;
}

function updateGenerateButton() {
  if (state.isGenerating) return;
  const canGenerate = areAllImagesLoaded();
  dom.generateBtn.disabled = !canGenerate;
}

function updateFooterMsg() {
  const hasTop    = !!state.files.top;
  const hasBottom = !!state.files.bottom;

  if (hasTop && hasBottom) {
    dom.footerMsg.textContent = '¡Se ve genial! Guarda o prueba otro estilo.';
  } else if (!hasTop && !hasBottom) {
    dom.footerMsg.textContent = 'Sube tus prendas para comenzar.';
  } else {
    const missing = [];
    if (!hasTop)    missing.push('prenda superior');
    if (!hasBottom) missing.push('prenda inferior');
    dom.footerMsg.textContent = `Falta subir: ${missing.join(' y ')}.`;
  }
}

/* ─── Toasts ─────────────────────────────────────────────────── */
function showToast(message, type = 'info', duration = 4000) {
  const toast = document.createElement('div');
  toast.className = `toast${type === 'error' ? ' toast--error' : type === 'success' ? ' toast--success' : ''}`;
  toast.textContent = message;
  toast.setAttribute('role', 'status');

  dom.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/* ═══════════════════════════════════════════════════════════════
   6. API CLIENT
═══════════════════════════════════════════════════════════════ */

/**
 * Llama al servidor proxy local para generar el look.
 */
async function generateLook() {
  if (state.isGenerating) return;

    // Verificar que las prendas estén cargadas
    if (!state.files.top || !state.files.bottom) {
      showToast('Sube las 2 prendas primero: prenda superior e inferior', 'error');
      return;
    }

  showLoader();
  hideError();

  try {
    // Verificar que el servidor está corriendo
    let serverOnline = false;
    try {
      const healthRes = await fetch('/api/health', { signal: AbortSignal.timeout(3000) });
      serverOnline = healthRes.ok;
    } catch {
      serverOnline = false;
    }

    if (!serverOnline) {
      throw new Error('El servidor no está corriendo. Inicia el servidor con: node server.js');
    }

    // Crear FormData con las prendas + modelo fijo
    const formData = new FormData();

    // Cargar el modelo fijo como blob desde el servidor
    const modelResponse = await fetch('img/caro2.jpg');
    const modelBlob = await modelResponse.blob();
    formData.append('model', modelBlob, 'model.jpg');
    formData.append('top', state.files.top, state.files.top.name);
    formData.append('bottom', state.files.bottom, state.files.bottom.name);

    console.log('📤 Enviando imágenes al servidor...');

    // POST al servidor proxy (sin timeout fijo, Fal puede tardar)
    const response = await fetch('/api/tryon', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Error del servidor: ${response.status}`);
    }

    if (!data.imageUrl) {
      throw new Error('No se recibió imagen en la respuesta');
    }

    console.log('✅ Imagen generada:', data.imageUrl);

    // Guardar URL y mostrar resultado
    state.generatedImageUrl = data.imageUrl;
    updateMainPreview(data.imageUrl, true);

    // Habilitar descarga
    dom.downloadBtn.disabled = false;

    // Actualizar footer
    dom.footerMsg.textContent = '✨ ¡Look generado! Descárgalo o prueba otro estilo.';

    showToast('¡Look generado con éxito!', 'success');

  } catch (err) {
    console.error('Error generando look:', err);
    let userMessage = err.message;

    // Mensajes de error más amigables
    if (err.name === 'AbortError' || err.message.includes('timeout')) {
      userMessage = 'La generación tardó demasiado. Inténtalo de nuevo.';
    } else if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
      userMessage = 'Error de red. Verifica que el servidor esté corriendo.';
    }

    showError(userMessage);
    showToast(userMessage, 'error', 6000);

  } finally {
    hideLoader();
  }
}

/* ═══════════════════════════════════════════════════════════════
   7. DOWNLOAD MANAGER
═══════════════════════════════════════════════════════════════ */

async function downloadGeneratedImage() {
  if (!state.generatedImageUrl) {
    showToast('No hay imagen generada para descargar', 'error');
    return;
  }

  try {
    showToast('Iniciando descarga...', 'success');
    
    const proxyUrl = `/api/download?url=${encodeURIComponent(state.generatedImageUrl)}`;
    const response = await fetch(proxyUrl);
    
    if (!response.ok) throw new Error('Error al descargar del servidor');
    
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `zoco-fitting-look-${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(url), 1000);

  } catch (err) {
    console.error('Error descargando:', err);
    showError('Error al descargar la imagen');
  }
}

/* ═══════════════════════════════════════════════════════════════
   8. ZOOM CONTROLS
═══════════════════════════════════════════════════════════════ */

function applyZoom(newLevel) {
  state.zoomLevel = Math.max(state.zoomMin, Math.min(state.zoomMax, newLevel));
  dom.previewImage.style.transform = `scale(${state.zoomLevel})`;
}

function zoomIn() { applyZoom(state.zoomLevel + state.zoomStep); }
function zoomOut() { applyZoom(state.zoomLevel - state.zoomStep); }
function zoomReset() { applyZoom(1); }

/* ═══════════════════════════════════════════════════════════════
   9. THEME TOGGLE
═══════════════════════════════════════════════════════════════ */

function initTheme() {
  const saved = localStorage.getItem('zoco-theme') || 'light';
  applyTheme(saved);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.body.setAttribute('data-theme', theme);
  const isDark = theme === 'dark';
  dom.themeToggle.setAttribute('aria-checked', isDark ? 'true' : 'false');
  dom.themeToggle.setAttribute('aria-label', isDark ? 'Activar modo claro' : 'Activar modo oscuro');
  localStorage.setItem('zoco-theme', theme);
}

function toggleTheme() {
  const current = document.body.getAttribute('data-theme') || 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

/* ═══════════════════════════════════════════════════════════════
   10. MODAL
═══════════════════════════════════════════════════════════════ */

function openModal() {
  dom.modalOverlay.hidden = false;
  dom.howItWorksBtn.setAttribute('aria-expanded', 'true');
  document.addEventListener('keydown', handleModalKeydown);
  dom.modalClose.focus();
}

function closeModal() {
  dom.modalOverlay.hidden = true;
  dom.howItWorksBtn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('keydown', handleModalKeydown);
  dom.howItWorksBtn.focus();
}

function handleModalKeydown(e) {
  if (e.key === 'Escape') closeModal();
}


/* ═══════════════════════════════════════════════════════════════
   INICIALIZACIÓN
═══════════════════════════════════════════════════════════════ */

function init() {
  // ─── Configurar drop zones ─────────────────────────────────
  setupDropZone(dom.topDropZone, dom.topInput, 'top');
  setupDropZone(dom.bottomDropZone, dom.bottomInput, 'bottom');
  // Nota: modelo es fijo, no hay dropzone de modelo

  // ─── Botón GENERAR ─────────────────────────────────────────
  dom.generateBtn.addEventListener('click', generateLook);

  // ─── Retry ─────────────────────────────────────────────────
  dom.retryBtn.addEventListener('click', () => {
    hideError();
    generateLook();
  });

  // ─── Descarga ──────────────────────────────────────────────
  dom.downloadBtn.addEventListener('click', downloadGeneratedImage);

  // ─── Zoom ──────────────────────────────────────────────────
  dom.zoomInBtn.addEventListener('click', zoomIn);
  dom.zoomOutBtn.addEventListener('click', zoomOut);
  dom.zoomResetBtn.addEventListener('click', zoomReset);

  // Zoom con rueda del ratón sobre la imagen
  const previewCanvas = document.getElementById('previewCanvas');
  previewCanvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY < 0) zoomIn();
    else zoomOut();
  }, { passive: false });

  // ─── Tema ──────────────────────────────────────────────────
  initTheme();
  dom.themeToggle.addEventListener('click', toggleTheme);

  // ─── Modal ─────────────────────────────────────────────────
  dom.howItWorksBtn.addEventListener('click', openModal);
  dom.modalClose.addEventListener('click', closeModal);
  dom.modalOverlay.addEventListener('click', (e) => {
    if (e.target === dom.modalOverlay) closeModal();
  });

  // ─── Estado inicial ────────────────────────────────────────
  updateGenerateButton();
  updateFooterMsg();

  // Verificar si el servidor está disponible
  checkServerHealth();

  console.log('✅ ZOCO FITTING iniciado');
}

/**
 * Verifica si el servidor proxy está corriendo.
 */
async function checkServerHealth() {
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json();
      if (!data.hasApiKey) {
        showToast('⚠️ API Key no encontrada en el servidor', 'error', 6000);
      } else {
        console.log('🔑 Servidor y API Key OK');
      }
    }
  } catch {
    // Servidor no disponible — es esperado si no se ha iniciado aún
    console.warn('Servidor no disponible. Inicia con: node server.js');
  }
}

// Iniciar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
