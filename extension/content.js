/*
 * CODXIS - Prévia por Código de Barras
 * -------------------------------------
 * Ao digitar (ou ler com leitor) um código de barras de 8 a 14 dígitos no
 * campo de busca de produto do PDV, mostra logo abaixo do campo o nome,
 * código interno, preço e estoque do produto.
 *
 * Como a consulta funciona:
 *   O próprio sistema tem, em Cadastro > Produto > Consultar, um filtro
 *   "Código de Barras". A extensão abre essa tela em segundo plano (uma vez
 *   por página), e a cada código faz o mesmo POST AJAX (JSF/PrimeFaces) que
 *   o botão "Consultar" faria, usando a sessão já logada (cookie).
 *   Nada é enviado para fora de web.codxis.api.br.
 *
 * O que a extensão NÃO faz:
 *   - Não intercepta o Enter: o PDV já seleciona o produto pelo código de
 *     barras sozinho. A extensão só mostra a informação.
 *   - Não usa ESC (no PDV o ESC aciona "Sair").
 *   - Não mostra o custo (para o cliente não ver).
 */
(function () {
  'use strict';

  if (window.__codxisPreviaCB) return; // evita rodar duas vezes no mesmo frame
  window.__codxisPreviaCB = true;

  // ---------------------------------------------------------------------
  // Configuração
  // ---------------------------------------------------------------------
  const URL_CONSULTA = '/sistema/pages/privado/cadastro/produto/produto/select';
  const REGEX_CODIGO_BARRAS = /^\d{8,14}$/;
  const ESPERA_DIGITACAO_MS = 250; // aguarda o usuário parar de digitar
  const MAX_RESULTADOS = 3;

  // Para a página de teste local: se existir uma função de consulta "falsa",
  // usamos ela no lugar da consulta real. (No Chrome, o content script roda
  // num mundo isolado, então a página real não consegue definir isso.)
  const consultaMock = typeof window.__CODXIS_MOCK_CONSULTA__ === 'function'
    ? window.__CODXIS_MOCK_CONSULTA__ : null;

  const temChromeStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

  let ativo = true;
  if (temChromeStorage) {
    chrome.storage.local.get({ ativo: true }, (cfg) => { ativo = cfg.ativo !== false; if (!ativo) esconderCaixa(); });
    chrome.storage.onChanged.addListener((mud) => {
      if (mud.ativo) { ativo = mud.ativo.newValue !== false; if (!ativo) esconderCaixa(); }
    });
  }

  // ---------------------------------------------------------------------
  // Identificação dos campos de busca de produto
  // ---------------------------------------------------------------------
  // O PDV usa um AutoComplete do PrimeFaces cujo id termina em
  // "codigoProduto_input" e com placeholder "Busque pelo código ou descrição".
  // Como o JSF substitui o campo a cada atualização AJAX, não guardamos
  // referência a ele: usamos delegação de eventos no documento inteiro.
  function ehCampoDeProduto(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if (el.type && el.type !== 'text' && el.type !== 'search') return false;
    if (el.dataset && el.dataset.codxisPrevia === 'off') return false;
    const id = el.id || '';
    if (/codigoProduto_input$/i.test(id)) return true;
    const ph = el.placeholder || '';
    return /busque pelo c[oó]digo|c[oó]digo\s*\/?\s*descri/i.test(ph);
  }

  // ---------------------------------------------------------------------
  // Validação do dígito verificador (EAN-8, UPC-A, EAN-13, GTIN-14)
  // ---------------------------------------------------------------------
  function digitoVerificadorOk(codigo) {
    if (![8, 12, 13, 14].includes(codigo.length)) return null; // tamanho fora do padrão GTIN
    const d = codigo.split('').map(Number);
    const verificador = d.pop();
    let soma = 0;
    // Da direita para a esquerda: pesos 3, 1, 3, 1...
    for (let i = d.length - 1, peso = 3; i >= 0; i--, peso = peso === 3 ? 1 : 3) soma += d[i] * peso;
    return ((10 - (soma % 10)) % 10) === verificador;
  }

  // ---------------------------------------------------------------------
  // Consulta ao sistema (tela de Produtos > filtro Código de Barras)
  // ---------------------------------------------------------------------
  let sessaoConsulta = null;      // { params, chaveVS, viewState, prefixo, botaoId, render }
  let filaConsultas = Promise.resolve(); // consultas em série (mesma "view" JSF)
  const cache = new Map();        // só em memória: vale enquanto a página estiver aberta

  async function abrirSessaoConsulta() {
    const resp = await fetch(URL_CONSULTA, { credentials: 'same-origin' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ao abrir a consulta de produtos');
    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const campoCB = doc.querySelector('input[id$=":codigoBarras"]');
    const form = campoCB && campoCB.form;
    if (!form) throw new Error('Filtro "Código de Barras" não encontrado (sessão expirada?)');

    const botao = [...form.querySelectorAll('button')]
      .find((b) => b.textContent.trim() === 'Consultar' && /datatable/.test(b.getAttribute('onclick') || ''));
    if (!botao) throw new Error('Botão "Consultar" não encontrado');
    const render = ((botao.getAttribute('onclick') || '').match(/u:"([^"]+)"/) || [])[1] || '@form';

    // Serializa o formulário do jeito que o navegador faria
    const params = new URLSearchParams();
    for (const el of form.elements) {
      if (!el.name || el.disabled) continue;
      if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) continue;
      if (el.tagName === 'BUTTON' || el.type === 'submit' || el.type === 'button') continue;
      if (el.tagName === 'SELECT') { for (const o of el.selectedOptions) params.append(el.name, o.value); continue; }
      params.append(el.name, el.value);
    }
    const prefixo = [...params.keys()].some((k) => k.startsWith('jakarta.faces')) ? 'jakarta' : 'javax';
    const chaveVS = prefixo + '.faces.ViewState';

    return {
      params, chaveVS, viewState: params.get(chaveVS), prefixo,
      botaoId: botao.id, campoNome: campoCB.name, render,
    };
  }

  async function postConsulta(s, codigo) {
    const p = new URLSearchParams(s.params);
    p.set(s.chaveVS, s.viewState);
    p.set(s.campoNome, codigo);
    p.set(s.prefixo + '.faces.partial.ajax', 'true');
    p.set(s.prefixo + '.faces.source', s.botaoId);
    p.set(s.prefixo + '.faces.partial.execute', '@all');
    p.set(s.prefixo + '.faces.partial.render', s.render);
    p.set(s.botaoId, s.botaoId);

    const resp = await fetch(URL_CONSULTA, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Faces-Request': 'partial/ajax',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: p.toString(),
    });
    const texto = await resp.text();
    if (!resp.ok || /ViewExpired/i.test(texto)) throw new Error('view-expirada');

    const xml = new DOMParser().parseFromString(texto, 'text/xml');
    const updates = [...xml.getElementsByTagName('update')];
    // Se o servidor devolver um ViewState novo, guardamos para a próxima
    const novoVS = updates.find((u) => /ViewState/.test(u.getAttribute('id') || ''));
    if (novoVS && novoVS.textContent) s.viewState = novoVS.textContent;

    const tabela = updates.find((u) => /:datatable$/.test(u.getAttribute('id') || ''));
    if (!tabela) throw new Error('view-expirada'); // resposta inesperada: reabre a consulta
    return lerLinhas(tabela.textContent);
  }

  // Lê as linhas da tabela de produtos devolvida pelo servidor.
  // Colunas: Código | Descrição | Referência | Marca | Custo | Estoque | Preço venda
  function lerLinhas(htmlTabela) {
    const doc = new DOMParser().parseFromString('<table>' + htmlTabela + '</table>', 'text/html');
    const cabecalho = [...doc.querySelectorAll('thead th')].map((th) => th.textContent);
    const col = (re, padrao) => { const i = cabecalho.findIndex((t) => re.test(t)); return i >= 0 ? i : padrao; };
    const iCod = col(/Filter by C[oó]digo/i, 0);
    const iDesc = col(/Filter by Descri/i, 1);
    const iEst = col(/Filter by Estoque/i, 5);
    const iPreco = col(/Filter by Pre[cç]o/i, 6);

    return [...doc.querySelectorAll('tr[data-ri]')].map((tr) => {
      const c = [...tr.cells].map((td) => td.textContent.trim());
      return { codigo: c[iCod] || '', descricao: c[iDesc] || '', estoque: c[iEst] || '', preco: c[iPreco] || '' };
    }).filter((p) => p.descricao);
  }

  async function consultarNoSistema(codigo) {
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      try {
        if (!sessaoConsulta) sessaoConsulta = await abrirSessaoConsulta();
        return await postConsulta(sessaoConsulta, codigo);
      } catch (e) {
        sessaoConsulta = null; // na 2ª tentativa abre a tela de consulta de novo
        if (tentativa === 1) throw e;
      }
    }
    return [];
  }

  // Consulta com cache e em série (o JSF não gosta de POSTs paralelos na mesma view)
  function consultar(codigo) {
    if (cache.has(codigo)) return cache.get(codigo);
    const promessa = filaConsultas.then(() => (consultaMock ? consultaMock(codigo) : consultarNoSistema(codigo)));
    filaConsultas = promessa.catch(() => {});
    cache.set(codigo, promessa);
    promessa.catch(() => cache.delete(codigo)); // erro não fica em cache
    return promessa;
  }

  // ---------------------------------------------------------------------
  // Caixa de prévia (aparece logo abaixo do campo)
  // ---------------------------------------------------------------------
  let caixa = null;
  let campoAtual = null;

  function obterCaixa() {
    if (caixa && document.body.contains(caixa)) return caixa;
    caixa = document.createElement('div');
    caixa.className = 'codxis-previa-cb';
    caixa.setAttribute('role', 'status');
    caixa.setAttribute('aria-live', 'polite');
    document.body.appendChild(caixa);
    return caixa;
  }

  function posicionar() {
    if (!caixa || !campoAtual || caixa.hidden) return;
    if (!document.contains(campoAtual)) { esconderCaixa(); return; }
    const r = campoAtual.getBoundingClientRect();
    caixa.style.left = (r.left + window.scrollX) + 'px';
    caixa.style.top = (r.bottom + window.scrollY + 4) + 'px';
    caixa.style.minWidth = Math.max(r.width, 320) + 'px';
  }

  function esc(t) {
    return String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  // Descobre se o sistema está no tema escuro ou claro pela cor de fundo da página
  function temaDaPagina() {
    for (const el of [document.body, document.documentElement]) {
      const m = getComputedStyle(el).backgroundColor.match(/\d+(\.\d+)?/g);
      if (!m || (m.length === 4 && Number(m[3]) === 0)) continue; // transparente: tenta o próximo
      const [r, g, b] = m.map(Number);
      return (0.299 * r + 0.587 * g + 0.114 * b) < 128 ? 'escuro' : 'claro';
    }
    return 'escuro';
  }

  function mostrar(campo, tipo, html) {
    const novaExibicao = !caixa || caixa.hidden || campoAtual !== campo;
    campoAtual = campo;
    const el = obterCaixa();
    el.dataset.tipo = tipo; // carregando | ok | nao-encontrado | erro
    el.dataset.tema = temaDaPagina();
    el.innerHTML = html;
    el.hidden = false;
    if (novaExibicao) { // animação de entrada só quando a caixa aparece
      el.classList.remove('codxis-previa-cb--entrando');
      void el.offsetWidth;
      el.classList.add('codxis-previa-cb--entrando');
    }
    posicionar();
  }

  function esconderCaixa() {
    if (caixa) caixa.hidden = true;
    campoAtual = null;
  }

  // Ícones (SVG inline, herdam a cor do texto)
  const ICONE = {
    barras: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h2v14H3zM7 5h1v14H7zM10 5h2v14h-2zM14 5h1v14h-1zM17 5h1v14h-1zM20 5h1v14h-1z" fill="currentColor"/></svg>',
    ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" fill="currentColor"/></svg>',
    alerta: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" fill="currentColor"/></svg>',
    erro: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="currentColor"/></svg>',
    enter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 7v4H5.8l3.6-3.6L8 6l-6 6 6 6 1.4-1.4L5.8 13H21V7z" fill="currentColor"/></svg>',
  };

  // "6,000" -> 6 ; "-36,000" -> -36 ; "1,500" -> 1,5
  function numeroBR(t) {
    const n = Number(String(t).replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  function formatarEstoque(t) {
    const n = numeroBR(t);
    return n === null ? esc(t) : n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  }
  function classeEstoque(t) {
    const n = numeroBR(t);
    if (n === null) return '';
    return n > 0 ? 'positivo' : n === 0 ? 'zerado' : 'negativo';
  }

  function cabecalho(codigo, icone, rotulo) {
    return `<div class="codxis-previa-cb__topo">
        <span class="codxis-previa-cb__codigo">${ICONE.barras}<span>${esc(codigo)}</span></span>
        <span class="codxis-previa-cb__selo">${icone}${esc(rotulo)}</span>
      </div>`;
  }

  function htmlCarregando(codigo) {
    return `${cabecalho(codigo, '<span class="codxis-previa-cb__spinner"></span>', 'Buscando…')}
      <div class="codxis-previa-cb__esqueleto"></div>
      <div class="codxis-previa-cb__esqueleto codxis-previa-cb__esqueleto--curto"></div>`;
  }

  function htmlProdutos(codigo, produtos) {
    const lista = produtos.slice(0, MAX_RESULTADOS).map((p) => `
      <div class="codxis-previa-cb__item">
        <div class="codxis-previa-cb__nome">${esc(p.descricao)}</div>
        <div class="codxis-previa-cb__linha">
          <div class="codxis-previa-cb__chips">
            <span class="codxis-previa-cb__chip">Cód. <b>${esc(p.codigo)}</b></span>
            ${p.estoque ? `<span class="codxis-previa-cb__chip codxis-previa-cb__chip--${classeEstoque(p.estoque)}">Estoque <b>${formatarEstoque(p.estoque)}</b></span>` : ''}
          </div>
          ${p.preco ? `<div class="codxis-previa-cb__preco"><small>R$</small>${esc(p.preco)}</div>` : ''}
        </div>
      </div>`).join('');
    const rotulo = produtos.length > 1 ? `${produtos.length} produtos` : 'Encontrado';
    const extra = produtos.length > MAX_RESULTADOS
      ? `<div class="codxis-previa-cb__aviso">+ ${produtos.length - MAX_RESULTADOS} outro(s) com este código de barras</div>` : '';
    const aviso = produtos.length > 1
      ? `<div class="codxis-previa-cb__aviso">${ICONE.alerta}Mais de um produto com este código de barras.</div>` : '';
    return `${cabecalho(codigo, ICONE.ok, rotulo)}${lista}${extra}${aviso}
      <div class="codxis-previa-cb__dica"><kbd>${ICONE.enter}Enter</kbd> para selecionar</div>`;
  }

  function htmlNaoEncontrado(codigo) {
    const dv = digitoVerificadorOk(codigo);
    const dica = dv === false
      ? `<div class="codxis-previa-cb__aviso">${ICONE.alerta}O dígito verificador deste código não confere. Confira a digitação.</div>`
      : '';
    return `${cabecalho(codigo, ICONE.alerta, 'Não encontrado')}
      <div class="codxis-previa-cb__nome">Código de barras não encontrado</div>
      <div class="codxis-previa-cb__sub">Nenhum produto cadastrado com este código.</div>${dica}`;
  }

  function htmlErro(mensagem) {
    return `<div class="codxis-previa-cb__topo"><span class="codxis-previa-cb__selo">${ICONE.erro}Erro</span></div>
      <div class="codxis-previa-cb__nome">Não foi possível consultar o código de barras</div>
      <div class="codxis-previa-cb__sub">${esc(mensagem)}</div>`;
  }

  // ---------------------------------------------------------------------
  // Fluxo principal
  // ---------------------------------------------------------------------
  let temporizador = null;
  let sequencia = 0; // ignora respostas que chegam fora de ordem

  async function atualizarPrevia(campo, imediato) {
    clearTimeout(temporizador);
    const valor = (campo.value || '').trim();

    if (!ativo || !REGEX_CODIGO_BARRAS.test(valor)) { // não é código de barras: não interfere
      if (campoAtual === campo) esconderCaixa();
      return;
    }

    const minhaVez = ++sequencia;
    const executar = async () => {
      if (!cache.has(valor)) mostrar(campo, 'carregando', htmlCarregando(valor));
      try {
        const produtos = await consultar(valor);
        if (minhaVez !== sequencia) return;
        if (produtos.length) mostrar(campo, 'ok', htmlProdutos(valor, produtos));
        else mostrar(campo, 'nao-encontrado', htmlNaoEncontrado(valor));
      } catch (e) {
        if (minhaVez !== sequencia) return;
        mostrar(campo, 'erro', htmlErro(e && e.message || e));
        console.warn('[CODXIS Prévia CB]', e);
      }
    };
    if (imediato) executar(); else temporizador = setTimeout(executar, ESPERA_DIGITACAO_MS);
  }

  // Digitação normal ou leitor (o leitor "digita" e dispara input a cada caractere)
  document.addEventListener('input', (ev) => {
    if (ehCampoDeProduto(ev.target)) atualizarPrevia(ev.target, false);
  }, true);

  // Enter (fim da leitura do leitor): consulta na hora, sem esperar o debounce.
  // NÃO chamamos preventDefault: o próprio PDV trata o Enter e seleciona o produto.
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ehCampoDeProduto(ev.target)) atualizarPrevia(ev.target, true);
  }, true);

  // Esconde a prévia quando o campo é apagado por outro meio ou perde o foco
  document.addEventListener('focusin', (ev) => {
    if (ehCampoDeProduto(ev.target)) atualizarPrevia(ev.target, true);
  }, true);

  // Mantém a caixa no lugar ao rolar/redimensionar, e some se o JSF trocar o campo
  window.addEventListener('scroll', posicionar, true);
  window.addEventListener('resize', posicionar);
  setInterval(() => {
    if (!campoAtual) return;
    if (!document.contains(campoAtual)) { // o JSF recriou o campo (atualização AJAX)
      const novo = campoAtual.id && document.getElementById(campoAtual.id);
      if (novo && REGEX_CODIGO_BARRAS.test((novo.value || '').trim())) { campoAtual = novo; posicionar(); }
      else esconderCaixa();
    } else if (!REGEX_CODIGO_BARRAS.test((campoAtual.value || '').trim())) {
      esconderCaixa(); // o campo foi limpo (ex.: produto inserido)
    }
  }, 400);

  // Clique fora fecha a caixa
  document.addEventListener('mousedown', (ev) => {
    if (caixa && !caixa.hidden && ev.target !== campoAtual && !caixa.contains(ev.target)) esconderCaixa();
  }, true);
})();
