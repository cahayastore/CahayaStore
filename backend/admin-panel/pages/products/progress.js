/* Progress bar (header chips) untuk Product Wizard */
import { el } from '../../dom.js';
import { STEPS } from './constants.js';

export function buildProgress(currentStep) {
  const inner = el('div', { class: 'wz-progress-inner' });
  STEPS.forEach((s, i) => {
    const isActive = s.num === currentStep;
    const isDone = s.num < currentStep;
    const cls = 'wz-step' + (isActive ? ' active' : '') + (isDone ? ' done' : '');
    inner.appendChild(
      el('div', { class: cls },
        el('div', { class: 'dot' }, isDone ? '✓' : String(s.num)),
        el('div', { class: 'label' }, s.label)
      )
    );
    if (i < STEPS.length - 1) {
      const c = el('div', { class: 'wz-connector' + (isDone ? ' filled' : '') });
      inner.appendChild(c);
    }
  });
  return el('div', { class: 'wz-progress' }, inner);
}
