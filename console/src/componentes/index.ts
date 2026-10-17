// Componentes compartilhados do console. Importe daqui:
//   import { Botao, Modal, Tabela, useToast, Carregando } from '../../componentes/index.ts';
// Cada arquivo tem no topo um exemplo de uso. Cores só por var(--token); classes visuais em
// shared/styles/base.css e console/src/console.css (prefixo ca-).
export { Icone, type NomeIcone } from './icones.tsx';
export { Botao, type PropsBotao, type VarianteBotao } from './Botao.tsx';
export { Modal, Confirmar, usePrenderFoco, type PropsModal, type PropsConfirmar } from './Modal.tsx';
export { Gaveta, type PropsGaveta } from './Gaveta.tsx';
export { ProvedorToast, useToast, type ApiToast, type OpcoesToast } from './Toast.tsx';
export { Abas, type Aba } from './Abas.tsx';
export { Tabela, type ColunaTabela } from './Tabela.tsx';
export {
  SeloStatusTarefa,
  SeloStatusExecucao,
  SeloCaminho,
  SeloExemplo,
  ROTULO_STATUS_TAREFA,
  ROTULO_STATUS_EXECUCAO,
} from './Selos.tsx';
export {
  Campo,
  Segmentado,
  CabecalhoPagina,
  Aviso,
  Progresso,
  type PropsControle,
  type OpcaoSegmentado,
} from './formulario.tsx';
export { Menu, ItemMenu, type PropsBotaoMenu } from './Menu.tsx';
export { useMigalhas, useOnline, useAtrasado, guardado, ProvedorMigalhas, type Migalha } from './pagina.tsx';
export { Carregando, EstadoErro, EstadoOffline, EstadoVazio, SemPermissao } from './estados.tsx';
export { ProvedorSessao, useSessao, useSessaoOpcional, usePode, type Sessao } from './sessao.tsx';
export { ChatDeTeste, useUsuariosDoSistema, usuariosDoSistema } from './ChatDeTeste.tsx';
