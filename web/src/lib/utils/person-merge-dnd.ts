/** A private MIME type so a person merge cannot be mistaken for another drag operation. */
export const PERSON_MERGE_MIME = 'application/x-gallery-person-merge';

export const writePersonMergeSource = (dataTransfer: DataTransfer, personId: string): void => {
  dataTransfer.setData(PERSON_MERGE_MIME, personId);
};

export const readPersonMergeSource = (dataTransfer: DataTransfer): string | null => {
  const personId = dataTransfer.getData(PERSON_MERGE_MIME);
  return personId || null;
};

/**
 * The browser's default drag image can be a large snapshot of the whole People page. Replace it
 * with a compact label so the source and drop target remain visible while the user drags.
 */
export const setPersonMergeDragLabel = (dataTransfer: DataTransfer, label: string): void => {
  if (typeof document === 'undefined' || typeof dataTransfer.setDragImage !== 'function') {
    return;
  }

  const chip = document.createElement('div');
  chip.dataset.personMergeDragChip = '';
  chip.textContent = label;
  chip.style.cssText = [
    'position:absolute',
    'top:-1000px',
    'inset-inline-start:0',
    'min-width:2rem',
    'max-width:16rem',
    'overflow:hidden',
    'white-space:nowrap',
    'text-overflow:ellipsis',
    'padding:0.25rem 0.5rem',
    'border-radius:0.375rem',
    'font-size:0.875rem',
    'background:#1f2937',
    'color:#ffffff',
  ].join(';');

  document.body.append(chip);
  try {
    dataTransfer.setDragImage(chip, 12, 12);
  } catch {
    // happy-dom exposes the method but deliberately throws; older browser implementations can
    // behave similarly. Falling back to the browser image is better than breaking the drop.
    chip.remove();
    return;
  }
  setTimeout(() => chip.remove(), 0);
};
