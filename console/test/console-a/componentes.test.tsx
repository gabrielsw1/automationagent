// Componentes reutilizáveis: modal, abas, campo com erro, estados, toast e regras da ficha.
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Abas, Campo, Confirmar, EstadoErro, Modal, ProvedorToast, Tabela, useToast } from '../../src/componentes/index.ts';
import { ErroApiCliente } from '../../src/api/cliente.ts';
import { chaveDoRotulo, descricaoValidacao, proximaVersao, quandoAs, renomearChave } from '../../src/paginas/tarefas/ficha.ts';
import { definicao, renderizar } from './ambiente.tsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Modal', () => {
  it('foca o primeiro campo, prende o Tab e fecha com Esc', () => {
    const aoFechar = vi.fn();
    render(
      <>
        <button type="button">fora</button>
        <Modal aberto titulo="Editar campo" aoFechar={aoFechar} rodape={<button type="button">Salvar</button>}>
          <input aria-label="Nome" data-autofoco />
        </Modal>
      </>,
    );
    const dialogo = screen.getByRole('dialog', { name: 'Editar campo' });
    expect(dialogo.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByLabelText('Nome'));
    const salvar = screen.getByRole('button', { name: 'Salvar' });
    salvar.focus();
    fireEvent.keyDown(salvar, { key: 'Tab' });
    expect(dialogo.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(aoFechar).toHaveBeenCalled();
  });

  it('travado não fecha com Esc; Confirmar mostra o erro', () => {
    const aoFechar = vi.fn();
    render(
      <Confirmar
        aberto
        titulo="Desativar?"
        texto="Texto"
        rotuloConfirmar="Desativar"
        perigo
        carregando
        erro="Não deu."
        aoConfirmar={() => {}}
        aoFechar={aoFechar}
      />,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(aoFechar).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Não deu.');
  });
});

describe('Abas', () => {
  it('troca pelas setas do teclado', () => {
    function Teste() {
      const [a, setA] = useState<'um' | 'dois'>('um');
      return (
        <Abas
          rotulo="Seções"
          ativa={a}
          aoTrocar={setA}
          abas={[
            { chave: 'um', rotulo: 'Um' },
            { chave: 'dois', rotulo: 'Dois' },
          ]}
        />
      );
    }
    render(<Teste />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Um' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Dois' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Dois' }));
  });
});

describe('Campo e Tabela', () => {
  it('liga rótulo, erro e ajuda ao controle', () => {
    render(
      <Campo rotulo="E-mail de cobrança" obrigatorio erro="Digite um e-mail válido" ajuda="Para onde vai a fatura.">
        {(p) => <input {...p} />}
      </Campo>,
    );
    const input = screen.getByLabelText(/E-mail de cobrança/);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.className).toContain('is-error');
    const ids = input.getAttribute('aria-describedby')!.split(' ');
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toContain('Digite um e-mail válido');
  });

  it('tabela vazia mostra o texto de vazio', () => {
    render(<Tabela linhas={[] as { id: string }[]} chave={(l) => l.id} colunas={[{ titulo: 'Nome', celula: (l) => l.id }]} vazio="Nada aqui." />);
    expect(screen.getByText('Nada aqui.')).toBeTruthy();
  });
});

describe('Estados', () => {
  it('erro com código de referência e "Tentar de novo"', () => {
    const tentar = vi.fn();
    render(<EstadoErro erro={new ErroApiCliente(500, 'interno', 'Falhou.', '7F3A-21')} aoTentar={tentar} />);
    expect(screen.getByText(/7F3A-21/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Tentar de novo/ }));
    expect(tentar).toHaveBeenCalled();
  });

  it('sem conexão e sem permissão', () => {
    renderizar(<EstadoErro erro={new ErroApiCliente(0, 'offline', 'Sem conexão.')} />);
    expect(screen.getByText(/sem internet|Sem conexão/i)).toBeTruthy();
    cleanup();
    renderizar(<EstadoErro erro={new ErroApiCliente(403, 'sem_permissao', 'Só Admin.')} />, { perfil: 'leitor' });
    expect(screen.getByText(/Seu perfil é Leitor/)).toBeTruthy();
  });
});

describe('Toast', () => {
  it('mostra, executa a ação e some sozinho', () => {
    vi.useFakeTimers();
    const acao = vi.fn();
    function Botao() {
      const t = useToast();
      return (
        <button type="button" onClick={() => t.mostrar({ texto: 'Tarefa publicada.', acao: { rotulo: 'Desfazer', aoClicar: acao }, duracaoMs: 8000 })}>
          publicar
        </button>
      );
    }
    render(
      <ProvedorToast>
        <Botao />
      </ProvedorToast>,
    );
    fireEvent.click(screen.getByText('publicar'));
    expect(screen.getByText('Tarefa publicada.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(acao).toHaveBeenCalled();
    fireEvent.click(screen.getByText('publicar'));
    act(() => void vi.advanceTimersByTime(9000));
    expect(screen.queryByText('Tarefa publicada.')).toBeNull();
  });
});

describe('Regras da ficha', () => {
  it('chave, validação, versão e renomear', () => {
    expect(chaveDoRotulo('Nome da empresa')).toBe('nome_empresa');
    expect(chaveDoRotulo('E-mail de cobrança')).toBe('email_cobranca');
    expect(chaveDoRotulo('Prazo de pagamento (dias)')).toBe('prazo_pagamento_dias');
    expect(chaveDoRotulo('2ª via')).toBe('campo_2a_via');
    const def = definicao();
    expect(descricaoValidacao(def.campos[0])).toBe('Mínimo de 3 letras');
    expect(descricaoValidacao(def.campos[1])).toBe('Valida os dígitos verificadores e se já existe cadastro');
    expect(descricaoValidacao({ chave: 'v', rotulo: 'Valor', tipo: 'moeda', obrigatorio: true, pergunta: '', minimo: 10, maximo: 500 })).toBe(
      'Entre R$ 10 e R$ 500',
    );
    expect(proximaVersao(null, { versao: 4 })).toBe(5);
    expect(proximaVersao({ versao: 5 }, { versao: 4 })).toBe(5);
    expect(proximaVersao(null, null)).toBe(1);
    const nova = renomearChave(def, 'cnpj', 'documento');
    expect(nova.api?.mapeamento.find((m) => m.destino === 'cnpj')?.campo).toBe('documento');
    const agora = new Date('2026-10-17T15:00:00.000Z');
    expect(quandoAs('2026-10-17T12:12:00.000Z', agora)).toBe('hoje às 09:12');
    expect(quandoAs('2026-10-16T12:12:00.000Z', agora)).toBe('ontem às 09:12');
    expect(quandoAs('2026-10-02T12:12:00.000Z', agora)).toBe('em 02/10/2026 às 09:12');
  });
});
