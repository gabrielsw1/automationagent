// "Meus códigos de recuperação": pede um código do aplicativo autenticador e mostra os 10 códigos
// novos uma vez só, para copiar ou baixar. Os antigos param de funcionar.
import { useState } from 'react';
import { fmt } from '@copiloto/shared';
import type { ErroApiCliente } from '../../api/cliente.ts';
import { apiPlataforma } from '../../api/plataforma.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Campo } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { Modal } from '../../componentes/Modal.tsx';
import { useSessaoStarta } from './contexto.tsx';
import { copiarTexto } from './pecas.tsx';

function baixar(nome: string, texto: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

export function ModalCodigos({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const { eu, definirEu } = useSessaoStarta();
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [novos, setNovos] = useState<string[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const fechar = () => {
    setCodigo('');
    setErro(null);
    setNovos(null);
    setAviso(null);
    aoFechar();
  };

  const gerar = async () => {
    if (!/^\d{6}$/.test(codigo.trim())) {
      setErro('Digite os 6 dígitos que aparecem agora no aplicativo.');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const r = await apiPlataforma.post<{ codigosRecuperacao: string[] }>('/auth/codigos-recuperacao', { codigo: codigo.trim() });
      setNovos(r.codigosRecuperacao);
      definirEu({ ...eu, codigosRecuperacao: r.codigosRecuperacao.length });
    } catch (e) {
      setErro((e as ErroApiCliente).message);
    } finally {
      setEnviando(false);
    }
  };

  const texto = novos
    ? [`Códigos de recuperação da Plataforma Starta (${eu.email}), gerados em ${fmt.dataHora(new Date())}.`, 'Cada código vale uma vez.', '', ...novos].join('\n')
    : '';

  return (
    <Modal
      aberto={aberto}
      titulo="Meus códigos de recuperação"
      descricao={
        novos
          ? undefined
          : `Use um código de recuperação para entrar quando estiver sem o celular. Você tem ${fmt.numero(eu.codigosRecuperacao)} ${
              eu.codigosRecuperacao === 1 ? 'código que ainda funciona' : 'códigos que ainda funcionam'
            }.`
      }
      aoFechar={fechar}
      travado={enviando}
      largura={520}
      rodape={
        novos ? (
          <Botao variante="primario" onClick={fechar}>
            Pronto, guardei
          </Botao>
        ) : (
          <>
            <Botao onClick={fechar} disabled={enviando}>
              Cancelar
            </Botao>
            <Botao variante="primario" carregando={enviando} onClick={() => void gerar()}>
              Gerar códigos novos
            </Botao>
          </>
        )
      }
    >
      {novos ? (
        <>
          <div className="alert alert-warning" role="status">
            <Icone nome="alerta" />
            <p className="small">Guarde estes códigos agora: eles não aparecem de novo. Os códigos antigos pararam de funcionar.</p>
          </div>
          <ul className="cp-codigos" aria-label="Códigos de recuperação novos">
            {novos.map((c) => (
              <li key={c} className="mono">
                {c}
              </li>
            ))}
          </ul>
          <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
            <Botao tamanho="sm" icone="copiar" onClick={async () => setAviso((await copiarTexto(novos.join('\n'))) ? 'Códigos copiados.' : 'Não consegui copiar. Selecione os códigos e copie.')}>
              Copiar códigos
            </Botao>
            <Botao
              tamanho="sm"
              icone="baixar"
              onClick={() => setAviso(baixar('codigos-recuperacao-plataforma-starta.txt', texto) ? 'Arquivo baixado.' : 'Não consegui baixar o arquivo. Copie os códigos.')}
            >
              Baixar .txt
            </Botao>
            {aviso ? (
              <span className="tiny muted" role="status">
                {aviso}
              </span>
            ) : null}
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void gerar();
          }}
        >
          <Campo rotulo="Código do aplicativo autenticador" erro={erro} ajuda="Os códigos novos substituem os antigos.">
            {(p) => (
              <input
                {...p}
                className={`${p.className} mono cp-codigo-app`}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                data-autofoco
              />
            )}
          </Campo>
        </form>
      )}
    </Modal>
  );
}
