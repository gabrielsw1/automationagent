// Textos jurídicos do site: /termos, /privacidade e /contrato-lgpd (GET /api/publico/textos/:documento).
// Enquanto o servidor servir a minuta que vem com o produto (docs/legal), a página avisa que o texto
// ainda está em revisão jurídica; com os textos aprovados (TEXTOS_LEGAIS_DIR), o aviso some.
import { useCallback, useEffect, useState } from 'react';
import { fmt, type DocumentoLegal, type OrigemContato, type TextoLegal } from '@copiloto/shared';
import { apiPublica, type ErroApiCliente } from '../../api/cliente.ts';
import { Carregando, EstadoErro } from '../../componentes/estados.tsx';
import { Aviso } from '../../componentes/formulario.tsx';
import { Markdown } from './markdown.tsx';
import { Rodape, Topo } from './moldura.tsx';
import { PedidoContato } from './PedidoContato.tsx';
import './site.css';

export const AVISO_MINUTA = 'Minuta em revisão jurídica: este texto ainda não é a versão final.';

/** "Versão de 17/10/2026" quando a versão é uma data; senão, como veio (o hash do texto). */
function rotuloVersao(versao: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(versao) ? `Versão de ${fmt.data(`${versao}T12:00:00Z`)}` : `Versão ${versao}`;
}

export default function PaginaLegal({ documento }: { documento: DocumentoLegal }) {
  const [texto, setTexto] = useState<TextoLegal | null>(null);
  const [erro, setErro] = useState<ErroApiCliente | null>(null);
  const [pedido, setPedido] = useState<OrigemContato | null>(null);

  const carregar = useCallback(async () => {
    setTexto(null);
    setErro(null);
    try {
      setTexto(await apiPublica.get<TextoLegal>(`/textos/${documento}`));
    } catch (e) {
      setErro(e as ErroApiCliente);
    }
  }, [documento]);

  useEffect(() => {
    void carregar();
    window.scrollTo?.(0, 0);
  }, [carregar]);

  useEffect(() => {
    if (texto) document.title = `${texto.titulo} · Copiloto Starta`;
  }, [texto]);

  return (
    <div className="st">
      <Topo aoAgendar={() => setPedido('demonstracao')} />
      <main className="st-dentro st-legal">
        <div className="st-legal-coluna stack-lg">
          {texto ? (
            <>
              {texto.fonte === 'minuta' ? <Aviso tipo="aviso">{AVISO_MINUTA}</Aviso> : null}
              <article className="st-texto">
                <Markdown texto={texto.markdown} />
              </article>
              <p className="tiny muted">{rotuloVersao(texto.versao)}</p>
            </>
          ) : erro ? (
            <EstadoErro erro={erro} aoTentar={() => void carregar()} titulo="Não conseguimos abrir este texto" />
          ) : (
            <Carregando texto="Abrindo o texto…" />
          )}
        </div>
      </main>
      <Rodape />
      {pedido ? <PedidoContato origem={pedido} aoFechar={() => setPedido(null)} /> : null}
    </div>
  );
}
