// Popup: liga/desliga a prévia. A preferência fica em chrome.storage.local
// e o content script percebe a mudança na hora (sem recarregar a página).
const caixa = document.getElementById('ativo');
const status = document.getElementById('status');

function mostrarStatus(ativo) {
  status.textContent = ativo ? 'Ligada: mostrando o produto ao digitar o código de barras.' : 'Desligada: o PDV funciona sem a prévia.';
  status.className = ativo ? 'on' : 'off';
}

chrome.storage.local.get({ ativo: true }, (cfg) => {
  caixa.checked = cfg.ativo !== false;
  mostrarStatus(caixa.checked);
});

caixa.addEventListener('change', () => {
  chrome.storage.local.set({ ativo: caixa.checked });
  mostrarStatus(caixa.checked);
});
