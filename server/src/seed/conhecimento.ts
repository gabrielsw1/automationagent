// Fontes de conhecimento de exemplo (central de ajuda do Horizonte), já divididas em trechos.
export interface FonteExemplo {
  tipo: 'site' | 'arquivo' | 'video' | 'respostas';
  nome: string;
  origem: string;
  status: 'indexado' | 'indexando' | 'erro' | 'pausado';
  erro?: string;
  comoResolver?: string;
  trechos: { titulo: string; local?: string; url?: string; texto: string }[];
}

export function fontesExemplo(): FonteExemplo[] {
  return [];
}

export function perguntasSemRespostaExemplo(): { pergunta: string; causa: string; vezes: number }[] {
  return [];
}
