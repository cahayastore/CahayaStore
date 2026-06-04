/* ════════════════════════════════════════════════════════════════════
   Product Wizard — Shell
   Modal full-screen wizard (4 step) untuk create/edit produk.
   Modular: step files di folder yang sama.
   ════════════════════════════════════════════════════════════════════ */
import { el, alertBox } from '../../dom.js';
import { api } from '../../api.js';
import {
  STEPS,
  createDefaultForm,
  createFormFromProduct,
  buildSubmission,
} from './constants.js';
import { buildProgress } from './progress.js';
import { renderStepType,    validateStepType }    from './step-type.js';
import { renderStepInfo,    validateStepInfo }    from './step-info.js';
import { renderStepPricing, validateStepPricing } from './step-pricing.js';
import { renderStepStock,   validateStepStock }   from './step-stock.js';
import { renderStepReview,  validateStepReview }  from './step-review.js';
import { STOCK_CONTENT_MAP, parseStockItems } from './constants.js';

const STEP_RENDERERS = {
  1: renderStepType,
  2: renderStepInfo,
  3: renderStepPricing,
  4: renderStepStock,
  5: renderStepReview,
};
const STEP_VALIDATORS = {
  1: validateStepType,
  2: validateStepInfo,
  3: validateStepPricing,
  4: validateStepStock,
  5: validateStepReview,
};

function closeWizard() {
  document.getElementById('product-wizard')?.remove();
}

function buildHeader(isEdit, onClose) {
  return el('div', { class: 'wz-head' },
    el('div', { class: 'title' },
      el('div', { class: 'icon' }, '📦'),
      el('div', {},
        el('div', {}, isEdit ? 'Edit Produk' : 'Tambah Produk Baru'),
        el('div', { class: 'sub' },
          isEdit ? 'Ubah detail produk yang sudah ada' : 'Buat produk baru lewat 4 langkah singkat')
      )
    ),
    el('button', { class: 'close', type: 'button', onclick: onClose, 'aria-label': 'Tutup' }, '✕')
  );
}

function buildFooter(state, controls) {
  const left = el('div', { class: 'left' }, `Langkah ${state.step} dari ${STEPS.length}`);

  const backBtn = el('button', {
    class: 'btn ghost',
    type: 'button',
    onclick: controls.prev,
    disabled: state.step === 1 || state.submitting
  }, '← Kembali');

  const isLast = state.step === STEPS.length;
  const nextBtn = el('button', {
    class: 'btn primary',
    type: 'button',
    onclick: isLast ? controls.submit : controls.next,
    disabled: state.submitting
  }, state.submitting
      ? 'Menyimpan…'
      : (isLast ? (state.isEdit ? 'Simpan Perubahan' : 'Buat Produk') : 'Lanjut →'));

  return el('div', { class: 'wz-foot' },
    left,
    el('div', { class: 'right' }, backBtn, nextBtn)
  );
}

/**
 * Open wizard.
 * @param {object} opts
 * @param {object|null} opts.product   product yang diedit, null = create
 * @param {array}       opts.categories
 * @param {function}    opts.onDone    dipanggil setelah submit sukses
 */
export function openProductWizard({ product = null, categories = [], onDone }) {
  closeWizard();
  const isEdit = !!product;
  const state = {
    step: 1,
    submitting: false,
    error: null,
    form: isEdit ? createFormFromProduct(product) : createDefaultForm(),
    isEdit,
    flags: { slugTouched: isEdit }, // di edit mode jangan auto-overwrite slug
  };

  const root = el('div', { class: 'wz-bg', id: 'product-wizard' });
  const modal = el('div', { class: 'wz-modal', role: 'dialog', 'aria-modal': 'true' });
  root.appendChild(modal);
  document.body.appendChild(root);

  function setField(k, v) { state.form[k] = v; }

  function ctxForStep() {
    return {
      form: state.form,
      categories,
      isEdit,
      flags: state.flags,
      setField,
      rerender: render,
    };
  }

  async function submit() {
    state.error = null;
    // Final validation walk
    for (const s of STEPS) {
      const err = STEP_VALIDATORS[s.num](state.form);
      if (err) {
        state.step = s.num;
        state.error = err;
        render();
        return;
      }
    }
    state.submitting = true;
    render();
    try {
      const body = buildSubmission(state.form);
      let createdId = product?.id || null;
      if (isEdit) {
        await api('/api/admin/products/' + product.id, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
      } else {
        const created = await api('/api/admin/products', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        createdId = created?.data?.id || null;
      }

      // Bulk-insert stok (hanya create mode, dan kalau ada items)
      if (!isEdit && createdId) {
        const contentType = STOCK_CONTENT_MAP[state.form.stock_type];
        const items = parseStockItems(state.form.stock_items_raw);
        if (contentType && items.length > 0) {
          try {
            await api(`/api/admin/products/${createdId}/stocks`, {
              method: 'POST',
              body: JSON.stringify({ content_type: contentType, items }),
            });
          } catch (stockErr) {
            // Produk sudah dibuat, tapi stok gagal — beri warning, jangan rollback
            state.submitting = false;
            state.error = `Produk dibuat, tapi gagal menambah stok: ${stockErr.message}`;
            render();
            return;
          }
        }
      }

      closeWizard();
      if (typeof onDone === 'function') onDone();
    } catch (e) {
      state.submitting = false;
      state.error = e.message || 'Gagal menyimpan produk.';
      render();
    }
  }

  function next() {
    const err = STEP_VALIDATORS[state.step](state.form);
    if (err) { state.error = err; render(); return; }
    state.error = null;
    if (state.step < STEPS.length) state.step += 1;
    render();
  }

  function prev() {
    state.error = null;
    if (state.step > 1) state.step -= 1;
    render();
  }

  function render() {
    modal.innerHTML = '';
    modal.appendChild(buildHeader(isEdit, closeWizard));
    modal.appendChild(buildProgress(state.step));

    const body = el('div', { class: 'wz-body' });
    if (state.error) body.appendChild(alertBox('err', state.error));
    body.appendChild(STEP_RENDERERS[state.step](ctxForStep()));
    modal.appendChild(body);

    modal.appendChild(buildFooter(state, { prev, next, submit }));
  }

  render();
}
