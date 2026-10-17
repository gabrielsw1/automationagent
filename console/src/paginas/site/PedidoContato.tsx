// Pedido de contato do site: "Agendar demonstração", "Falar com vendas" e, com o cadastro fechado,
// "Começar piloto". POST /api/publico/contato guarda o pedido no banco da plataforma e avisa a equipe
// de vendas por e-mail (EMAIL_VENDAS).
import { useId, useState, type FormEvent } from 'react';
import {
  ROTULO_FAIXA_USUARIOS,
  ROTULO_ORIGEM_CONTATO,
  somenteDigitos,
  type ContatoPedido,
  type FaixaUsuarios,
  type OrigemContato,
} from '@copiloto/shared';
import { apiPublica, type ErroApiCliente } from '../../api/cliente.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Aviso, Campo } from '../../componentes/formulario.tsx';
import { Modal } from '../../componentes/Modal.tsx';
import { emailValido } from '../cadastro/regras.ts';

const FAIXAS = Object.keys(ROTULO_FAIXA_USUARIOS) as FaixaUsuarios[];

const DESCRICAO: Record<OrigemContato, string> = {
  demonstracao: 'Mostramos o copiloto funcionando num sistema como o seu e respondemos às dúvidas do seu time.',
  vendas: 'Conte sobre a sua base de usuários e os sistemas que quer ligar. A Starta prepara uma proposta.',
  piloto: 'O cadastro de empresas novas está fechado agora. Deixe seus dados e a Starta abre o piloto com você.',
};

export const SUCESSO_CONTATO = 'Recebemos seu pedido. A equipe da Starta vai falar com você pelo e-mail informado.';

type Chave = 'nome' | 'email' | 'empresa' | 'telefone' | 'faixa';

export function PedidoContato({ origem, aoFechar }: { origem: OrigemContato; aoFechar: () => void }) {
  const id = useId();
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [telefone, setTelefone] = useState('');
  const [faixa, setFaixa] = useState<FaixaUsuarios | ''>('');
  const [mensagem, setMensagem] = useState('');
  const [tocados, setTocados] = useState<Partial<Record<Chave, boolean>>>({});
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<ErroApiCliente | null>(null);
  const [enviado, setEnviado] = useState(false);

  const digitos = somenteDigitos(telefone).length;
  const erros: Record<Chave, string | null> = {
    nome: nome.trim().length < 2 ? 'Diga seu nome.' : null,
    email: !emailValido(email) ? 'Digite um e-mail completo, por exemplo nome@suaempresa.com.br' : null,
    empresa: empresa.trim().length < 2 ? 'Diga o nome da empresa.' : null,
    telefone: telefone.trim() && (digitos < 10 || digitos > 13) ? 'Digite o telefone com DDD, por exemplo (51) 99999-0000.' : null,
    faixa: !faixa ? 'Escolha quantos usuários o seu sistema tem.' : null,
  };
  const mostrar = (k: Chave) => (tocados[k] ? erros[k] : null);
  const tocar = (k: Chave) => () => setTocados((t) => ({ ...t, [k]: true }));

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setTocados({ nome: true, email: true, empresa: true, telefone: true, faixa: true });
    if (Object.values(erros).some(Boolean) || !faixa) return;
    const pedido: ContatoPedido = {
      nome: nome.trim(),
      email: email.trim(),
      empresa: empresa.trim(),
      ...(telefone.trim() ? { telefone: telefone.trim() } : {}),
      faixa,
      ...(mensagem.trim() ? { mensagem: mensagem.trim() } : {}),
      origem,
    };
    setEnviando(true);
    setErro(null);
    try {
      await apiPublica.post('/contato', pedido);
      setEnviado(true);
    } catch (ex) {
      setErro(ex as ErroApiCliente);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal
      aberto
      titulo={ROTULO_ORIGEM_CONTATO[origem]}
      descricao={enviado ? undefined : DESCRICAO[origem]}
      aoFechar={aoFechar}
      travado={enviando}
      largura={560}
      rodape={
        enviado ? (
          // O formulário some: o foco vai para o botão do rodapé.
          <Botao variante="primario" onClick={aoFechar} autoFocus>
            Voltar ao site
          </Botao>
        ) : (
          <>
            <Botao variante="secundario" onClick={aoFechar} disabled={enviando}>
              Cancelar
            </Botao>
            <Botao type="submit" form={`${id}-form`} variante="primario" carregando={enviando}>
              Enviar pedido
            </Botao>
          </>
        )
      }
    >
      {enviado ? (
        <Aviso tipo="sucesso" papel="status">
          {SUCESSO_CONTATO}
        </Aviso>
      ) : (
        <form id={`${id}-form`} className="stack st-form" onSubmit={enviar} noValidate>
          {erro ? (
            <Aviso tipo="erro" papel="alert">
              {erro.offline ? 'Sem conexão. Confira a internet e tente de novo.' : erro.message}
            </Aviso>
          ) : null}
          <div className="grid-auto">
            <Campo rotulo="Nome" obrigatorio erro={mostrar('nome')}>
              {(p) => (
                <input
                  {...p}
                  autoComplete="name"
                  maxLength={120}
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  onBlur={tocar('nome')}
                  data-autofoco
                />
              )}
            </Campo>
            <Campo rotulo="E-mail de trabalho" obrigatorio erro={mostrar('email')}>
              {(p) => (
                <input
                  {...p}
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  maxLength={200}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={tocar('email')}
                  placeholder="nome@suaempresa.com.br"
                />
              )}
            </Campo>
            <Campo rotulo="Empresa" obrigatorio erro={mostrar('empresa')}>
              {(p) => (
                <input
                  {...p}
                  autoComplete="organization"
                  maxLength={120}
                  value={empresa}
                  onChange={(e) => setEmpresa(e.target.value)}
                  onBlur={tocar('empresa')}
                />
              )}
            </Campo>
            <Campo rotulo="Telefone (opcional)" erro={mostrar('telefone')}>
              {(p) => (
                <input
                  {...p}
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  maxLength={40}
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                  onBlur={tocar('telefone')}
                  placeholder="(51) 99999-0000"
                />
              )}
            </Campo>
          </div>
          <Campo rotulo="Quantos usuários o seu sistema tem" obrigatorio classe="select" erro={mostrar('faixa')}>
            {(p) => (
              <select {...p} value={faixa} onChange={(e) => setFaixa(e.target.value as FaixaUsuarios)} onBlur={tocar('faixa')}>
                <option value="">Escolha uma faixa</option>
                {FAIXAS.map((f) => (
                  <option key={f} value={f}>
                    {ROTULO_FAIXA_USUARIOS[f]}
                  </option>
                ))}
              </select>
            )}
          </Campo>
          <Campo rotulo="Mensagem (opcional)" classe="textarea">
            {(p) => (
              <textarea
                {...p}
                maxLength={2000}
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
                placeholder="Qual é o seu sistema e o que você quer que o copiloto faça?"
              />
            )}
          </Campo>
        </form>
      )}
    </Modal>
  );
}
