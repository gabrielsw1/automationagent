// "Descrever a tarefa": a pessoa escreve em português o que a tarefa faz, o Claude monta a ficha
// a partir do texto e das rotas da API do sistema (POST /tarefas/descrever), o console cria o
// rascunho (POST /tarefas) e abre a ficha para revisar.
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TarefaDefinicao, TarefaDetalhe } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Aviso } from '../../componentes/formulario.tsx';
import { Modal } from '../../componentes/Modal.tsx';
import { useSessao } from '../../componentes/sessao.tsx';
import { useToast } from '../../componentes/Toast.tsx';

type Etapa = 'escrevendo' | 'montando' | 'criando';

const MINIMO = 15;

export default function ModalDescrever({ aberto, aoFechar, textoInicial = '' }: { aberto: boolean; aoFechar: () => void; textoInicial?: string }) {
  const navegar = useNavigate();
  const toast = useToast();
  const { resumo } = useSessao();
  const [texto, setTexto] = useState(textoInicial);
  const [etapa, setEtapa] = useState<Etapa>('escrevendo');
  const [erro, setErro] = useState<string | null>(null);
  const [tocado, setTocado] = useState(false);

  useEffect(() => {
    if (aberto) {
      setTexto(textoInicial);
      setEtapa('escrevendo');
      setErro(null);
      setTocado(false);
    }
  }, [aberto, textoInicial]);

  const curto = texto.trim().length < MINIMO;
  const ocupado = etapa !== 'escrevendo';

  const enviar = async (e?: FormEvent) => {
    e?.preventDefault();
    setTocado(true);
    if (curto) return;
    setErro(null);
    try {
      setEtapa('montando');
      const { definicao } = await api.post<{ definicao: TarefaDefinicao }>('/tarefas/descrever', { descricao: texto.trim() });
      setEtapa('criando');
      const det = await api.post<TarefaDetalhe>('/tarefas', { definicao });
      toast.sucesso('Ficha montada. Confira os campos, teste e publique quando estiver tudo certo.');
      aoFechar();
      navegar(`/tarefas/${det.id}`);
    } catch (ex) {
      setErro((ex as ErroApiCliente).message);
      setEtapa('escrevendo');
    }
  };

  return (
    <Modal
      aberto={aberto}
      titulo="Descrever a tarefa"
      descricao={`Escreva como explicaria a um colega novo. O copiloto monta a ficha e liga na API do ${resumo.nomeSistema}; você revisa antes de publicar.`}
      aoFechar={aoFechar}
      travado={ocupado}
      largura={620}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={ocupado}>
            Cancelar
          </Botao>
          <Botao variante="primario" carregando={ocupado} onClick={() => void enviar()}>
            Montar a ficha
          </Botao>
        </>
      }
    >
      <form className="stack" onSubmit={enviar}>
        <div className="field">
          <label htmlFor="descricao-tarefa">O que a tarefa faz</label>
          <textarea
            id="descricao-tarefa"
            className={`textarea${tocado && curto ? ' is-error' : ''}`}
            rows={7}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onBlur={() => setTocado(true)}
            disabled={ocupado}
            aria-invalid={tocado && curto ? true : undefined}
            aria-describedby="descricao-ajuda"
            placeholder="Ex.: Quero que o copiloto cadastre clientes novos com razão social, CNPJ, e-mail de cobrança e prazo de pagamento de 15, 30, 45 ou 60 dias. Só Comercial e Financeiro podem cadastrar."
            data-autofoco
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void enviar();
            }}
          />
          {tocado && curto ? (
            <span className="error-text">Descreva com um pouco mais de detalhe: o que a tarefa faz e quais dados ela precisa.</span>
          ) : null}
          <span className="help" id="descricao-ajuda">
            Diga quais dados a tarefa precisa, quem pode pedir e se alguém precisa aprovar. Ctrl+Enter monta a ficha.
          </span>
        </div>
        {ocupado ? (
          <div className="row small muted" role="status">
            <span className="spinner" aria-hidden="true" />
            {etapa === 'montando'
              ? `Lendo a API do ${resumo.nomeSistema} e montando a ficha. Pode levar alguns segundos…`
              : 'Criando o rascunho da tarefa…'}
          </div>
        ) : null}
        {erro ? (
          <Aviso tipo="erro" titulo="Não consegui montar a ficha">
            {erro}
          </Aviso>
        ) : null}
      </form>
    </Modal>
  );
}
