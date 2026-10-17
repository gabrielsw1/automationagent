// CSS das telas do Horizonte: sóbrio, com cara de sistema interno.

export const CSS = `
:root {
  --hz-fundo: #f2f4f7;
  --hz-superficie: #ffffff;
  --hz-superficie-2: #f8f9fb;
  --hz-borda: #d5dbe2;
  --hz-borda-forte: #b8c2cc;
  --hz-texto: #1d2733;
  --hz-texto-2: #546170;
  --hz-topo: #1b2f45;
  --hz-topo-2: #243c56;
  --hz-topo-texto: #e8eef4;
  --hz-acento: #1f6ba5;
  --hz-acento-escuro: #17568a;
  --hz-acento-claro: #e4eff8;
  --hz-erro: #b3261e;
  --hz-erro-fundo: #fcebea;
  --hz-ok: #1d7044;
  --hz-ok-fundo: #e6f4ec;
  --hz-aviso: #8a5a00;
  --hz-aviso-fundo: #fff3d6;
  --hz-raio: 6px;
}
* { box-sizing: border-box; }
html { font-size: 14px; }
body {
  margin: 0; min-height: 100vh; display: flex; flex-direction: column;
  font-family: "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  line-height: 1.5; color: var(--hz-texto); background: var(--hz-fundo);
}
a { color: var(--hz-acento); }
a:hover { color: var(--hz-acento-escuro); }
h1 { font-size: 1.55rem; margin: 0 0 4px; font-weight: 600; }
h2 { font-size: 1.15rem; margin: 0 0 12px; font-weight: 600; }
h3 { font-size: 1rem; margin: 18px 0 8px; font-weight: 600; }
p { margin: 0 0 10px; }
.pular { position: absolute; left: -999px; }
.pular:focus { left: 8px; top: 8px; background: #fff; padding: 6px 10px; z-index: 10; }

.topo {
  display: flex; align-items: center; gap: 20px; padding: 0 24px; min-height: 54px;
  background: var(--hz-topo); color: var(--hz-topo-texto); flex-wrap: wrap;
}
.marca { display: flex; align-items: center; gap: 9px; color: #fff; text-decoration: none; font-weight: 700; font-size: 1.15rem; letter-spacing: .2px; }
.marca:hover { color: #fff; }
.marca svg { width: 26px; height: 26px; }
.menu { display: flex; align-items: center; gap: 2px; flex: 1; flex-wrap: wrap; }
.menu > a, .submenu > summary {
  color: var(--hz-topo-texto); text-decoration: none; padding: 7px 12px; border-radius: var(--hz-raio);
  cursor: pointer; list-style: none; display: block; font-weight: 500;
}
.submenu > summary::-webkit-details-marker { display: none; }
.submenu > summary::after { content: " ▾"; font-size: .8em; opacity: .75; }
.menu > a:hover, .submenu > summary:hover, .submenu[open] > summary { background: var(--hz-topo-2); color: #fff; }
.menu .ativo, .submenu.ativo > summary { background: var(--hz-topo-2); color: #fff; box-shadow: inset 0 -2px 0 #7fb6e0; }
.submenu { position: relative; }
.submenu-itens {
  position: absolute; top: calc(100% + 4px); left: 0; min-width: 190px; z-index: 20;
  background: var(--hz-superficie); border: 1px solid var(--hz-borda); border-radius: var(--hz-raio);
  box-shadow: 0 6px 18px rgba(16, 32, 48, .16); padding: 6px;
}
.submenu-itens a { display: block; padding: 7px 10px; border-radius: 4px; color: var(--hz-texto); text-decoration: none; }
.submenu-itens a:hover { background: var(--hz-acento-claro); color: var(--hz-acento-escuro); }
.sessao { display: flex; align-items: center; gap: 10px; margin-left: auto; font-size: .93rem; }
.avatar {
  width: 30px; height: 30px; border-radius: 50%; background: #3d5d7e; color: #fff;
  display: inline-flex; align-items: center; justify-content: center; font-weight: 600; font-size: .8rem;
}
.quem { display: flex; flex-direction: column; line-height: 1.2; }
.quem small { color: #a9bccf; font-size: .78rem; }
.trocar { color: #cfe3f5; font-size: .88rem; margin-left: 6px; }
.trocar:hover { color: #fff; }

.conteudo { flex: 1; width: 100%; max-width: 1180px; margin: 0 auto; padding: 24px; }
.rodape { color: var(--hz-texto-2); font-size: .85rem; text-align: center; padding: 18px 24px 22px; }
.rodape a { color: var(--hz-texto-2); }

.cabecalho-pagina { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
.trilha { font-size: .85rem; color: var(--hz-texto-2); margin-bottom: 6px; }
.trilha a { color: var(--hz-texto-2); }
.subtitulo { color: var(--hz-texto-2); margin: 0; }

.painel { background: var(--hz-superficie); border: 1px solid var(--hz-borda); border-radius: var(--hz-raio); padding: 20px; margin-bottom: 18px; }
.painel > h2:first-child { margin-top: 0; }
.grade { display: grid; gap: 18px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
.duas-colunas { display: grid; gap: 18px; grid-template-columns: 2fr 1fr; align-items: start; }
@media (max-width: 860px) { .duas-colunas { grid-template-columns: 1fr; } .conteudo { padding: 16px; } }

.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 36px; padding: 0 16px;
  border-radius: var(--hz-raio); border: 1px solid var(--hz-acento); background: var(--hz-acento); color: #fff;
  font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; white-space: nowrap;
}
.btn:hover { background: var(--hz-acento-escuro); border-color: var(--hz-acento-escuro); color: #fff; }
.btn-secundario { background: var(--hz-superficie); color: var(--hz-acento); border-color: var(--hz-borda-forte); }
.btn-secundario:hover { background: var(--hz-acento-claro); color: var(--hz-acento-escuro); border-color: var(--hz-acento); }
.btn-perigo { background: var(--hz-superficie); color: var(--hz-erro); border-color: #e3b3ae; }
.btn-perigo:hover { background: var(--hz-erro-fundo); color: var(--hz-erro); border-color: var(--hz-erro); }
.btn-pequeno { height: 30px; padding: 0 12px; font-size: .9rem; }
.btn-claro { background: transparent; border-color: #6d8aa6; color: #fff; }
.btn:disabled { opacity: .55; cursor: not-allowed; }

form.formulario { max-width: 640px; }
.campo { margin-bottom: 16px; }
.campo label { display: block; font-weight: 600; margin-bottom: 5px; }
.campo input, .campo select, .campo textarea {
  width: 100%; font: inherit; color: var(--hz-texto); background: #fff; border: 1px solid var(--hz-borda-forte);
  border-radius: var(--hz-raio); padding: 7px 10px; min-height: 36px;
}
.campo textarea { min-height: 96px; resize: vertical; }
.campo input:focus, .campo select:focus, .campo textarea:focus { outline: 2px solid #8fbfe6; outline-offset: 0; border-color: var(--hz-acento); }
.campo .ajuda { color: var(--hz-texto-2); font-size: .86rem; margin: 4px 0 0; }
.campo.com-erro input, .campo.com-erro select, .campo.com-erro textarea { border-color: var(--hz-erro); background: #fffafa; }
.erro-campo { color: var(--hz-erro); font-size: .88rem; margin: 5px 0 0; font-weight: 500; }
.linha-campos { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
@media (max-width: 600px) { .linha-campos { grid-template-columns: 1fr; } }
.acoes { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 6px; }
.nota { color: var(--hz-texto-2); font-size: .88rem; }

.alerta { border-radius: var(--hz-raio); padding: 11px 14px; margin-bottom: 16px; border: 1px solid; }
.alerta ul { margin: 6px 0 0; padding-left: 20px; }
.alerta-erro { background: var(--hz-erro-fundo); border-color: #efc1bc; color: #7d1a14; }
.alerta-ok { background: var(--hz-ok-fundo); border-color: #b9dfc8; color: #14512f; }
.alerta-aviso { background: var(--hz-aviso-fundo); border-color: #f0d68f; color: #5f3e00; }
.alerta-info { background: var(--hz-acento-claro); border-color: #bcd7ee; color: #123f63; }

.tabela-wrap { overflow-x: auto; border: 1px solid var(--hz-borda); border-radius: var(--hz-raio); background: var(--hz-superficie); }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #e6eaef; vertical-align: middle; }
th { background: var(--hz-superficie-2); font-size: .82rem; text-transform: uppercase; letter-spacing: .3px; color: var(--hz-texto-2); font-weight: 600; }
tbody tr:hover { background: #f7fafd; }
tbody tr:last-child td { border-bottom: 0; }
td.num, th.num { text-align: right; white-space: nowrap; }
.vazio { padding: 26px; text-align: center; color: var(--hz-texto-2); }

.etiqueta { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: .8rem; font-weight: 600; border: 1px solid; white-space: nowrap; }
.etiqueta-cinza { background: #f0f2f5; color: #46525f; border-color: #d8dde3; }
.etiqueta-azul { background: var(--hz-acento-claro); color: #174a73; border-color: #c3dbef; }
.etiqueta-verde { background: var(--hz-ok-fundo); color: #1a5c38; border-color: #bfe0cc; }
.etiqueta-vermelha { background: var(--hz-erro-fundo); color: #8c1d16; border-color: #efc1bc; }
.etiqueta-amarela { background: var(--hz-aviso-fundo); color: #6b4700; border-color: #f0d68f; }
.etiqueta-roxa { background: #f1ecfa; color: #4b2f86; border-color: #dccdf4; }

dl.ficha { display: grid; grid-template-columns: 190px 1fr; gap: 0; margin: 0; }
dl.ficha dt { color: var(--hz-texto-2); padding: 8px 0; border-bottom: 1px solid #edf0f3; }
dl.ficha dd { margin: 0; padding: 8px 0; border-bottom: 1px solid #edf0f3; font-weight: 500; }
@media (max-width: 600px) { dl.ficha { grid-template-columns: 1fr; } dl.ficha dt { border-bottom: 0; padding-bottom: 0; } }
.codigo { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; }
.destaque-codigo { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size: 1rem; color: var(--hz-texto-2); font-weight: 600; }

.busca { display: flex; gap: 8px; max-width: 520px; }
.busca input { flex: 1; font: inherit; border: 1px solid var(--hz-borda-forte); border-radius: var(--hz-raio); padding: 7px 10px; min-height: 36px; }

.resultado-via { border: 1px solid #b9dfc8; background: var(--hz-ok-fundo); border-radius: var(--hz-raio); padding: 16px; margin-top: 16px; }
.resultado-via h2 { color: #14512f; }
.linha-digitavel {
  display: block; font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size: 1.05rem;
  background: #fff; border: 1px dashed #8cc4a3; border-radius: var(--hz-raio); padding: 10px 12px; margin: 8px 0 10px;
  word-break: break-all; color: var(--hz-texto);
}

.usuarios { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.usuario-opcao {
  display: flex; gap: 12px; align-items: center; width: 100%; text-align: left; cursor: pointer;
  background: var(--hz-superficie); border: 1px solid var(--hz-borda); border-radius: var(--hz-raio);
  padding: 12px 14px; font: inherit; color: var(--hz-texto);
}
.usuario-opcao:hover { border-color: var(--hz-acento); background: #f7fbfe; }
.usuario-opcao .avatar { background: var(--hz-acento); flex: none; }
.usuario-opcao span.info { display: flex; flex-direction: column; }
.usuario-opcao small { color: var(--hz-texto-2); }
.caixa-entrar { max-width: 900px; margin: 30px auto; }

.artigos { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
.artigos li { background: var(--hz-superficie); border: 1px solid var(--hz-borda); border-radius: var(--hz-raio); padding: 14px 16px; }
.artigos li a { font-weight: 600; text-decoration: none; }
.artigos li p { color: var(--hz-texto-2); margin: 4px 0 0; font-size: .92rem; }
article.artigo { max-width: 760px; }
article.artigo h2 { margin-top: 22px; }
article.artigo li { margin-bottom: 4px; }
article.artigo table { margin: 10px 0 16px; border: 1px solid var(--hz-borda); }
.meta { color: var(--hz-texto-2); font-size: .88rem; margin-bottom: 18px; }

.interruptor { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 14px 0; border-bottom: 1px solid #edf0f3; }
.interruptor:last-child { border-bottom: 0; }
.interruptor p { margin: 2px 0 0; color: var(--hz-texto-2); font-size: .92rem; }
`;

export const ICONE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#2b6ea6"/><circle cx="16" cy="19" r="7" fill="#f3b04b"/><rect x="5" y="19" width="22" height="2.6" fill="#ffffff"/><rect x="8" y="23.5" width="16" height="2" rx="1" fill="#cfe3f5"/></svg>`;
