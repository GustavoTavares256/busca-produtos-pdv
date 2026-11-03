# CODXIS - Prévia por Código de Barras (extensão do Chrome)

No **PDV (Realizar Venda)** da CODXIS, ao digitar ou ler um código de barras,
aparece logo abaixo do campo **o nome do produto, o código interno, o preço e o estoque**,
antes mesmo de apertar Enter. Assim dá para conferir o produto sem decorar códigos.

```
┌ Código/Descrição ─────────┐
│ 7891027283278             │
└───────────────────────────┘
┌──────────────────────────────────────────┐
│ Código de barras 7891027283278           │
│ GRAFITE 2B 0.7MM TILIBRA                 │
│ Cód.: 290297 · Preço: R$ 4,80 · Estoque: 6│
└──────────────────────────────────────────┘
```

## Instalar

1. Abra `chrome://extensions` no Chrome.
2. Ligue o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e escolha a pasta **`extensao`** deste projeto.
4. (Opcional) Fixe o ícone da extensão na barra (ícone de quebra-cabeça → alfinete).
5. Abra ou recarregue o PDV em `https://web.codxis.api.br`.

## Usar

- Digite (ou leia com o leitor) um código de barras de **8 a 14 dígitos** no campo
  "Código/Descrição". A prévia aparece em instantes.
- Confirme com **Enter** normalmente: quem seleciona o produto é o próprio sistema.
- Se o código não existir no cadastro, aparece **"Código de barras não encontrado"**.
  Quando o dígito verificador do código não confere, a prévia avisa para conferir a digitação.
- Se o mesmo código de barras estiver em mais de um produto, todos aparecem (até 3).
- Busca por **nome** continua igual: a extensão só age quando o texto é só números com 8 a 14 dígitos.
- Para desligar/ligar: clique no ícone da extensão e use a opção **Ativada**.

## Atualizar

Depois de trocar os arquivos da pasta `extensao`, vá em `chrome://extensions`,
clique no botão de **recarregar** (↻) do cartão da extensão e recarregue a página do PDV.

## Como funciona

O sistema da CODXIS é JSF/PrimeFaces (não tem uma API REST de produtos). Na tela
**Cadastro → Produto → Consultar** existe o filtro **"Código de Barras"**. A extensão:

1. abre essa tela em segundo plano **uma vez** por página do PDV (usando a sessão já logada);
2. a cada código de barras, faz o mesmo pedido AJAX que o botão **Consultar** faz;
3. lê a tabela de resposta (código, descrição, estoque, preço) e mostra na prévia.

Detalhes:
- **Nada sai do domínio** `web.codxis.api.br`. Não há servidor externo, nem senha guardada.
- Os resultados ficam em cache **só na memória da página** (somem ao recarregar), então
  não há risco de misturar produtos de empresas diferentes.
- O **custo não é mostrado**, para o cliente não ver.
- A extensão **não intercepta o Enter** nem usa o **ESC** (no PDV o ESC aciona "Sair").
- Funciona em qualquer empresa em que você entrar, porque consulta o cadastro da empresa logada.

## Testar sem o sistema

A pasta `teste` tem uma página que imita o campo do PDV, com produtos falsos:

```
node teste/servidor.js
```

Abra `http://localhost:8123/teste/teste.html` e clique em **▶ Rodar testes automáticos**.
Ela testa: leitor (digitação rápida + Enter), Enter não bloqueado, código com 2 produtos,
"não encontrado" + dígito verificador, digitação manual, busca por nome sem interferência,
EAN-8 e a prévia sumindo quando o produto é inserido.

## Limitações conhecidas

- Depende da tela de consulta de produtos e do filtro "Código de Barras". Se a CODXIS
  mudar essa tela, a prévia mostra "Não foi possível consultar o código de barras"
  (o PDV continua funcionando normalmente).
- A primeira consulta de cada página leva ~1 s (abre a tela de consulta); as seguintes, ~0,2 s.
- O usuário precisa ter permissão de acesso a **Cadastro → Produto → Consultar**.
