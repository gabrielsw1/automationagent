// Regras do cadastro, as mesmas do servidor: e-mail da empresa (não de provedor gratuito) e senha
// com pelo menos 8 caracteres, letras e números, sem o nome da empresa.

export const emailValido = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

/** Provedores de e-mail pessoal: o cadastro pede o e-mail de trabalho. */
const PROVEDOR_GRATUITO =
  /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|bol|uol|terra|ig|aol|protonmail|proton|zoho|gmx)\.[a-z.]+$|^(me|mac)\.com$/;

export function emailGratuito(email: string): boolean {
  const dominio = email.trim().toLowerCase().split('@')[1] ?? '';
  return PROVEDOR_GRATUITO.test(dominio);
}

/** Erro do e-mail de trabalho, ou null quando está bom. */
export function erroEmailTrabalho(email: string): string | null {
  if (!emailValido(email)) return 'Digite um e-mail completo, por exemplo nome@suaempresa.com.br';
  if (emailGratuito(email)) return 'Use o e-mail da empresa, por exemplo nome@suaempresa.com.br';
  return null;
}

/** Só letras e números, em minúsculas (como o servidor), para comparar a senha com o nome da empresa. */
function simplificar(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\d]/gu, '');
}

export const SENHA_MINIMO = 8;

export interface RegraSenha {
  rotulo: string;
  ok: boolean;
}

/** As três regras da senha, na ordem em que aparecem embaixo do campo. */
export function regrasSenha(senha: string, nomeEmpresa: string): RegraSenha[] {
  const empresa = simplificar(nomeEmpresa);
  return [
    { rotulo: `Pelo menos ${SENHA_MINIMO} caracteres`, ok: senha.length >= SENHA_MINIMO },
    { rotulo: 'Letras e números', ok: /\p{L}/u.test(senha) && /\d/.test(senha) },
    {
      rotulo: 'Diferente do nome da empresa',
      // O servidor só compara nomes com 3 letras ou mais.
      ok: !!senha && !!empresa && (empresa.length < 3 || !simplificar(senha).includes(empresa)),
    },
  ];
}
