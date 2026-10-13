const BesMapSupport = (() => {
  'use strict';
  const dialog = document.getElementById('support-dialog');
  const toggle = document.getElementById('support-toggle');
  const close = document.getElementById('support-close');
  const image = document.getElementById('support-image');
  const openImage = document.getElementById('support-open-image');
  const saveImage = document.getElementById('support-save-image');
  const payee = document.getElementById('support-payee');
  const description = dialog.querySelector('.support-description');
  const sourceLink = description.querySelector('.support-source-link');
  const encodedImages = JSON.parse(document.getElementById('support-image-data').textContent);
  const imageUrls = new Map();
  const methods = {
    wechat: { label: 'support.wechat', name: 'Benson(**城)', width: 1266, height: 1749 },
    alipay: { label: 'support.alipay', name: 'Bes软件', width: 1080, height: 1680 }
  };
  let selected = 'wechat';

  function renderDescription() {
    const copy = BesMapI18n.text('support.description');
    const marker = '{source}';
    const linkAt = copy.indexOf(marker);
    sourceLink.textContent = BesMapI18n.text('support.sourceLink');
    description.replaceChildren(document.createTextNode(copy.slice(0, linkAt)), sourceLink,
      document.createTextNode(copy.slice(linkAt + marker.length)));
  }

  function imageUrl(method) {
    if (!imageUrls.has(method)) {
      const bytes = Uint8Array.from(atob(encodedImages[method]), character => character.charCodeAt(0));
      imageUrls.set(method, URL.createObjectURL(new Blob([bytes], { type: 'image/png' })));
    }
    return imageUrls.get(method);
  }

  function selectMethod(method) {
    if (!Object.hasOwn(methods, method)) return;
    selected = method;
    const details = methods[method];
    const label = BesMapI18n.text(details.label);
    const url = imageUrl(method);
    image.src = url;
    image.width = details.width;
    image.height = details.height;
    image.alt = BesMapI18n.text('support.imageAlt', { method: label, payee: details.name });
    payee.textContent = BesMapI18n.text('support.payee', { method: label, payee: details.name });
    openImage.href = url;
    saveImage.href = url;
    saveImage.download = `BesMapLab-${method}.png`;
    dialog.querySelectorAll('[data-support-method]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.supportMethod === method));
    });
  }

  toggle.addEventListener('click', () => {
    selectMethod('wechat');
    dialog.showModal();
    close.focus();
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => toggle.focus({ preventScroll: true }));
  dialog.querySelectorAll('[data-support-method]').forEach(button => {
    button.addEventListener('click', () => selectMethod(button.dataset.supportMethod));
  });
  BesMapI18n.subscribe(() => { renderDescription(); if (dialog.open) selectMethod(selected); });
  renderDescription();
  return { get open() { return dialog.open; } };
})();
