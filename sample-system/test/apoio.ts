// Apoio aos testes: servidor com relógio fixo (sexta, 16/10/2026, 10:00 em São Paulo) e atalhos de chamada.
import crypto from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { criarServidor, type OpcoesServidor } from '../src/servidor.ts';

export const AGORA = new Date('2026-10-16T13:00:00.000Z');
export const CHAVE = 'chave-servico-local';
export const SEGREDO_WIDGET = 'segredo-widget-local';

export function novoApp(opcoes: OpcoesServidor = {}): FastifyInstance {
  return criarServidor({ agora: () => AGORA, ...opcoes });
}

interface OpcoesChamada {
  usuario?: string;
  corpo?: unknown;
  cabecalhos?: Record<string, string>;
  semChave?: boolean;
}

export function api(app: FastifyInstance, metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, o: OpcoesChamada = {}) {
  const headers: Record<string, string> = { ...(o.cabecalhos ?? {}) };
  if (!o.semChave) headers.authorization = `Bearer ${CHAVE}`;
  if (o.usuario) headers['x-usuario-id'] = o.usuario;
  return app.inject({ method: metodo, url, headers, ...(o.corpo !== undefined ? { payload: o.corpo as object } : {}) });
}

/** Faz login de demonstração e devolve o cabeçalho Cookie. */
export async function entrar(app: FastifyInstance, usuarioId: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/entrar', payload: { usuario_id: usuarioId, voltar: '/clientes' }, headers: { 'content-type': 'application/json' } });
  const c = r.cookies.find((x) => x.name === 'hz_sessao');
  if (!c) throw new Error(`Login falhou para ${usuarioId}: ${r.statusCode}`);
  return `hz_sessao=${c.value}`;
}

export function tela(app: FastifyInstance, url: string, cookie?: string) {
  return app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
}

/** Envia um formulário (application/x-www-form-urlencoded). */
export function enviarForm(app: FastifyInstance, url: string, campos: Record<string, string>, cookie?: string) {
  return app.inject({
    method: 'POST',
    url,
    payload: new URLSearchParams(campos).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
  });
}

export function assinatura(id: string, segredo = SEGREDO_WIDGET): string {
  return crypto.createHmac('sha256', segredo).update(id).digest('hex');
}

export function snippetEsperado(id: string, url = 'http://localhost:3000', chave = 'pk_local_horizonte'): string {
  return `<script src="${url}/copiloto.js" data-chave="${chave}" data-usuario="${id}" data-assinatura="${assinatura(id)}" async></script>`;
}

/** Confere a estrutura de um PDF: cabeçalho, xref apontando para cada objeto e %%EOF. */
export function pdfValido(buf: Buffer): boolean {
  const s = buf.toString('latin1');
  if (!s.startsWith('%PDF-1.')) return false;
  if (!s.trimEnd().endsWith('%%EOF')) return false;
  const m = s.match(/startxref\n(\d+)\n%%EOF\s*$/);
  if (!m) return false;
  const inicioXref = Number(m[1]);
  if (!s.startsWith('xref', inicioXref)) return false;
  const linhas = s.slice(inicioXref).split('\n');
  const [, total] = linhas[1].split(' ').map(Number);
  for (let i = 1; i < total; i++) {
    const deslocamento = Number(linhas[2 + i].slice(0, 10));
    if (!s.startsWith(`${i} 0 obj`, deslocamento)) return false;
  }
  // Cada stream com /Length correto.
  for (const st of s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const inicio = st.index! + st[0].length;
    if (s.slice(inicio + Number(st[1]), inicio + Number(st[1]) + 10) !== '\nendstream') return false;
  }
  return true;
}

export function json<T = Record<string, unknown>>(r: LightMyRequestResponse): T {
  return r.json() as T;
}
