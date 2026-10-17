// Fila de mensagens offline: envia quando a conexão volta, com o mesmo idCliente, sem duplicar.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnviarMensagemPedido } from '@copiloto/shared';
import { ClienteApi } from '../src/chat/api.ts';
import { ControladorChat } from '../src/chat/controlador.ts';
import { EventSourceFalso, conversa, esperarPromessas, inicioFalso, json, msg, servidorFalso } from './apoio.ts';

let online = true;

beforeEach(() => {
  online = true;
  EventSourceFalso.reiniciar();
  vi.stubGlobal('EventSource', EventSourceFalso);
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function ficarOffline() {
  online = false;
  window.dispatchEvent(new Event('offline'));
}

function voltarOnline() {
  online = true;
  window.dispatchEvent(new Event('online'));
}

function novoControlador(opcoes: { esperaMaximaFila?: number } = {}) {
  const inicio = inicioFalso({ conversaId: 'c1' });
  return new ControladorChat({ api: new ClienteApi('http://localhost:3000', inicio.token), inicio, ...opcoes });
}

function mensagensDaPessoa(c: ControladorChat, texto: string) {
  return c.obter().mensagens.filter((m) => m.autor === 'usuario' && m.texto === texto);
}

describe('fila offline', () => {
  it('guarda a mensagem sem internet e envia uma vez quando a conexão volta', async () => {
    const recebidos: EnviarMensagemPedido[] = [];
    const srv = servidorFalso({
      'GET /api/widget/conversas/c1': () => conversa([]),
      'POST /api/widget/conversas/c1/mensagens': (ch) => {
        const corpo = ch.corpo as EnviarMensagemPedido;
        recebidos.push(corpo);
        return { mensagem: msg({ id: `srv-${corpo.idCliente}`, autor: 'usuario', texto: corpo.texto }) };
      },
    });
    const c = novoControlador();
    await c.iniciar();
    EventSourceFalso.ultima().abrir();

    ficarOffline();
    expect(c.obter().online).toBe(false);
    expect(c.obter().conexao).toBe('instavel');
    c.enviar('cadastra a ACME Logística');
    await esperarPromessas();
    expect(srv.de('POST', '/api/widget/conversas/c1/mensagens')).toHaveLength(0);
    expect(mensagensDaPessoa(c, 'cadastra a ACME Logística')[0].local?.situacao).toBe('na_fila');
    // A fila sobrevive à troca de página.
    expect(sessionStorage.getItem('copiloto_fila:101')).toContain('cadastra a ACME Logística');

    voltarOnline();
    await esperarPromessas(10);
    expect(recebidos).toHaveLength(1);
    expect(recebidos[0].idCliente).toBeTruthy();
    const depois = mensagensDaPessoa(c, 'cadastra a ACME Logística');
    expect(depois).toHaveLength(1);
    expect(depois[0].local).toBeUndefined();
    expect(depois[0].id).toBe(`srv-${recebidos[0].idCliente}`);
    expect(sessionStorage.getItem('copiloto_fila:101')).toBeNull();

    // O mesmo recado chega pelo SSE: não duplica.
    c.aoEvento({ tipo: 'mensagem', mensagem: msg({ id: `srv-${recebidos[0].idCliente}`, autor: 'usuario', texto: 'cadastra a ACME Logística' }) });
    expect(mensagensDaPessoa(c, 'cadastra a ACME Logística')).toHaveLength(1);
    c.destruir();
  });

  it('reenvia com o mesmo idCliente quando a rede falha no meio do envio', async () => {
    const recebidos: EnviarMensagemPedido[] = [];
    let falhar = true;
    servidorFalso({
      'GET /api/widget/conversas/c1': () => conversa([]),
      'POST /api/widget/conversas/c1/mensagens': (ch) => {
        const corpo = ch.corpo as EnviarMensagemPedido;
        recebidos.push(corpo);
        if (falhar) {
          falhar = false;
          throw new TypeError('Failed to fetch');
        }
        return { mensagem: msg({ id: 'srv-1', autor: 'usuario', texto: corpo.texto }) };
      },
    });
    const c = novoControlador({ esperaMaximaFila: 5 });
    await c.iniciar();
    c.enviar('emite o relatório de setembro');
    await esperarPromessas();
    await vi.waitFor(() => expect(recebidos).toHaveLength(2));
    await esperarPromessas();
    expect(recebidos[0].idCliente).toBe(recebidos[1].idCliente);
    expect(mensagensDaPessoa(c, 'emite o relatório de setembro')).toHaveLength(1);
    expect(mensagensDaPessoa(c, 'emite o relatório de setembro')[0].id).toBe('srv-1');
    c.destruir();
  });

  it('não duplica quando o SSE entrega a mensagem antes da resposta do POST', async () => {
    let responder: (r: Response) => void = () => {};
    servidorFalso({
      'GET /api/widget/conversas/c1': () => conversa([]),
      'POST /api/widget/conversas/c1/mensagens': () => new Promise<Response>((r) => (responder = r)),
    });
    const c = novoControlador();
    await c.iniciar();
    c.enviar('oi');
    await esperarPromessas();
    const servidor = msg({ id: 'srv-oi', autor: 'usuario', texto: 'oi' });
    c.aoEvento({ tipo: 'mensagem', mensagem: servidor });
    expect(mensagensDaPessoa(c, 'oi')).toHaveLength(1);
    responder(json({ mensagem: servidor }));
    await esperarPromessas(10);
    expect(mensagensDaPessoa(c, 'oi')).toHaveLength(1);
    expect(mensagensDaPessoa(c, 'oi')[0].local).toBeUndefined();
    c.destruir();
  });

  it('retoma a fila guardada ao abrir outra página e envia em ordem', async () => {
    const recebidos: EnviarMensagemPedido[] = [];
    servidorFalso({
      'GET /api/widget/conversas/c1': () => conversa([]),
      'POST /api/widget/conversas/c1/mensagens': (ch) => {
        const corpo = ch.corpo as EnviarMensagemPedido;
        recebidos.push(corpo);
        return { mensagem: msg({ autor: 'usuario', texto: corpo.texto }) };
      },
    });
    ficarOffline();
    const primeira = novoControlador();
    await primeira.iniciar().catch(() => {});
    primeira.enviar('primeira');
    primeira.enviar('segunda');
    await esperarPromessas();
    primeira.destruir();
    expect(recebidos).toHaveLength(0);

    online = true;
    const outra = novoControlador();
    await outra.iniciar();
    await esperarPromessas(10);
    expect(recebidos.map((r) => r.texto)).toEqual(['primeira', 'segunda']);
    expect(new Set(recebidos.map((r) => r.idCliente)).size).toBe(2);
    expect(mensagensDaPessoa(outra, 'primeira')).toHaveLength(1);
    expect(mensagensDaPessoa(outra, 'segunda')).toHaveLength(1);
    outra.destruir();
  });

  it('marca como não enviada quando o servidor recusa, e permite tentar de novo', async () => {
    let recusar = true;
    const recebidos: EnviarMensagemPedido[] = [];
    servidorFalso({
      'GET /api/widget/conversas/c1': () => conversa([]),
      'POST /api/widget/conversas/c1/mensagens': (ch) => {
        recebidos.push(ch.corpo as EnviarMensagemPedido);
        if (recusar) return json({ erro: 'pedido_invalido', mensagem: 'Mensagem longa demais.' }, 400);
        return { mensagem: msg({ autor: 'usuario', texto: 'ok' }) };
      },
    });
    const c = novoControlador();
    await c.iniciar();
    c.enviar('ok');
    await esperarPromessas(10);
    const falhou = mensagensDaPessoa(c, 'ok')[0];
    expect(falhou.local?.situacao).toBe('falhou');
    expect(falhou.local?.erro).toBe('Mensagem longa demais.');
    recusar = false;
    c.reenviar(falhou.local!.idCliente);
    await esperarPromessas(10);
    expect(recebidos[1].idCliente).toBe(recebidos[0].idCliente);
    expect(mensagensDaPessoa(c, 'ok')).toHaveLength(1);
    expect(mensagensDaPessoa(c, 'ok')[0].local).toBeUndefined();
    c.destruir();
  });
});
