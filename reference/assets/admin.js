/**
 * Jagruk Jaipur — Admin JavaScript
 */

// ─── Sidebar toggle (mobile) ──────────────────────────────────
function toggleSidebar() {
  const sidebar  = document.getElementById('admin-sidebar');
  const overlay  = document.getElementById('sidebar-overlay');
  if (!sidebar || !overlay) return;
  const isOpen   = sidebar.classList.contains('open');
  sidebar.classList.toggle('open', !isOpen);
  overlay.classList.toggle('show', !isOpen);
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.sidebar-link').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 900) {
        const sidebar = document.getElementById('admin-sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        if (sidebar) sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
      }
    });
  });
});

// ─── Image upload preview ─────────────────────────────────────
const imageInput   = document.getElementById('image-input');
const imagePreview = document.getElementById('image-preview');
const uploadPlaceholder = document.getElementById('upload-placeholder');
const uploadArea   = document.getElementById('image-upload-area');

imageInput?.addEventListener('change', function() {
  const file = this.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    imagePreview.src = e.target.result;
    imagePreview.style.display = 'block';
    if (uploadPlaceholder) uploadPlaceholder.style.display = 'none';
  };
  reader.readAsDataURL(file);
});

// Drag-and-drop
uploadArea?.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
uploadArea?.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
uploadArea?.addEventListener('drop', e => {
  e.preventDefault();
  uploadArea.classList.remove('drag-over');
  if (e.dataTransfer.files[0] && imageInput) {
    const dt = new DataTransfer();
    dt.items.add(e.dataTransfer.files[0]);
    imageInput.files = dt.files;
    imageInput.dispatchEvent(new Event('change'));
  }
});

// ─── Ticket URL section toggle ────────────────────────────────
function toggleTicketUrl(checkbox) {
  const priceField = document.getElementById('ticket_price')?.closest('.form-group');
  if (priceField) priceField.style.display = checkbox.checked ? 'none' : 'block';
}
// Initialize on load
const isFreeCheckbox = document.getElementById('is_free');
if (isFreeCheckbox) toggleTicketUrl(isFreeCheckbox);

// ─── Searchable Dropdowns (TomSelect) ─────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.form-select-search').forEach(el => {
    new TomSelect(el, {
      create: false,
      sortField: {
        field: 'text',
        direction: 'asc'
      }
    });
  });
  
  document.querySelectorAll('.form-select-search-multi').forEach(el => {
    new TomSelect(el, {
      create: false,
      maxItems: 3,
      plugins: ['remove_button'],
      sortField: {
        field: 'text',
        direction: 'asc'
      }
    });
  });
});

// ─── Google Maps Places Autocomplete ──────────────────────────
function initGmaps() {
  const input = document.getElementById('places-search');
  if (!input) return;

  const mapDiv = document.getElementById('map-preview');
  let map, marker;

  if (mapDiv) {
    map = new google.maps.Map(mapDiv, {
      center: { lat: 26.9124, lng: 75.7873 }, // Jaipur
      zoom: 12,
      disableDefaultUI: true,
      zoomControl: true,
    });
    mapDiv.style.display = 'block';
  }

  const autocomplete = new google.maps.places.Autocomplete(input, {
    types: ['establishment'],
    componentRestrictions: { country: 'IN' },
    fields: ['name', 'formatted_address', 'place_id', 'geometry'],
  });

  autocomplete.addListener('place_changed', () => {
    const place = autocomplete.getPlace();
    if (!place.geometry) return;

    // Fill hidden + visible fields
    const nameField    = document.getElementById('name');
    const addressField = document.getElementById('address');
    const placeIdField = document.getElementById('google_place_id');
    const latField     = document.getElementById('lat');
    const lngField     = document.getElementById('lng');

    if (nameField)    nameField.value    = place.name || '';
    if (addressField) addressField.value = place.formatted_address || '';
    if (placeIdField) placeIdField.value = place.place_id || '';
    if (latField)     latField.value     = place.geometry.location.lat();
    if (lngField)     lngField.value     = place.geometry.location.lng();

    // Build short Maps URL
    const mapsUrlField = document.getElementById('maps_url');
    if (mapsUrlField) {
      mapsUrlField.value = `https://www.google.com/maps/place/?q=place_id:${place.place_id}`;
    }

    // Move map to this place
    if (map) {
      map.setCenter(place.geometry.location);
      map.setZoom(16);
      if (marker) marker.setMap(null);
      marker = new google.maps.Marker({
        position: place.geometry.location,
        map,
        title: place.name,
      });
    }
  });
}

// ─── Flash auto-dismiss ───────────────────────────────────────
const flash = document.querySelector('.a-flash');
if (flash) {
  setTimeout(() => {
    flash.style.transition = 'all 0.4s ease';
    flash.style.opacity    = '0';
    flash.style.height     = '0';
    flash.style.padding    = '0';
    flash.style.margin     = '0';
    flash.style.overflow   = 'hidden';
  }, 5000);
}

// ─── Color picker live update ─────────────────────────────────
document.getElementById('color')?.addEventListener('input', function() {
  const hex = document.getElementById('color-hex');
  if (hex) hex.textContent = this.value;
});

// ─── Universal Admin Form Submit Loading & Anti-Double-Click Handler ─
(function() {
  document.addEventListener('submit', function(e) {
    if (e.defaultPrevented) return;
    const form = e.target;
    if (!form || form.tagName !== 'FORM') return;

    if (form.hasAttribute('data-no-loading') || form.getAttribute('role') === 'search' || (form.method && form.method.toUpperCase() === 'GET')) {
      return;
    }

    if (typeof form.checkValidity === 'function' && !form.checkValidity()) {
      return;
    }

    if (form.dataset.submitting === 'true') {
      e.preventDefault();
      return false;
    }

    const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
    if (submitBtn) {
      form.dataset.submitting = 'true';
      submitBtn.classList.add('is-submitting');
      submitBtn.style.pointerEvents = 'none';

      const currentWidth = submitBtn.offsetWidth;
      if (currentWidth > 0) {
        submitBtn.style.minWidth = currentWidth + 'px';
      }

      const customText = submitBtn.getAttribute('data-loading-text');

      if (submitBtn.tagName.toLowerCase() === 'button') {
        const textNode = submitBtn.innerText.trim();
        let loadingLabel = 'Saving...';
        if (customText) {
          loadingLabel = customText;
        } else if (textNode.toLowerCase().includes('delete')) {
          loadingLabel = 'Deleting...';
        } else if (textNode.toLowerCase().includes('approve')) {
          loadingLabel = 'Approving...';
        } else if (textNode.toLowerCase().includes('reject')) {
          loadingLabel = 'Rejecting...';
        } else if (textNode.toLowerCase().includes('submit')) {
          loadingLabel = 'Submitting...';
        }

        submitBtn.innerHTML = `<span class="btn-spinner"></span> ${loadingLabel}`;
      } else {
        submitBtn.value = customText || 'Saving...';
      }

      setTimeout(() => {
        form.dataset.submitting = 'false';
        submitBtn.classList.remove('is-submitting');
        submitBtn.style.pointerEvents = '';
      }, 25000);
    }
  }); // Bubble phase
})();

