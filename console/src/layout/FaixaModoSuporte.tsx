// Faixa do modo suporte: alguém da equipe Starta entrou no console desta empresa por "Entrar como
// suporte" (Plataforma). Fica no topo enquanto durar, com quem, o motivo e até quando, e o botão
// para sair, que encerra o acesso (fica na auditoria da empresa) e volta para a Plataforma.
import { useState } from 'react';
import { fmt } from '@copiloto/shared';
import { api } from '../api/cliente.ts';
import { Botao } from '../componentes/Botao.tsx';
import { Icone } from '../componentes/icones.tsx';
import { recarregar, useSessao } from '../componentes/sessao.tsx';
import './faixa-suporte.css';

export function FaixaModoSuporte() {
  const { resumo } = useSessao();
  const suporte = resumo.eu.modoSuporte;
  const [saindo, setSaindo] = useState(false);
  if (!suporte) return null;

  const sair = async () => {
    setSaindo(true);
    await api.post('/auth/sair').catch(() => {});
    // Sai do console da empresa: a Plataforma abre do zero, com a sessão da equipe Starta.
    recarregar.console('/plataforma');
  };

  return (
    <div className="ca-faixa-suporte" role="status" aria-label="Modo suporte">
      <Icone nome="cadeado" />
      <p className="small grow">
        <span className="strong">Modo suporte</span> · {suporte.pessoa} (Starta) · Motivo: {suporte.motivo} · até {fmt.hora(suporte.ate)}
      </p>
      <Botao tamanho="sm" carregando={saindo} onClick={() => void sair()}>
        Sair do modo suporte
      </Botao>
    </div>
  );
}
