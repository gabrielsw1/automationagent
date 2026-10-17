// Aprender fluxo (C4): /aprender lista os fluxos gravados; /aprender/:fluxoId abre o assistente
// Gravar → Revisar passos → Mapear campos → Testar → Publicar.
// /aprender?tarefa=<id> abre "Começar gravação" já com a tarefa escolhida.
import { useParams } from 'react-router-dom';
import Assistente from './Assistente.tsx';
import ListaFluxos from './ListaFluxos.tsx';
import './aprender.css';

export default function Aprender() {
  const { fluxoId } = useParams();
  return fluxoId ? <Assistente key={fluxoId} fluxoId={fluxoId} /> : <ListaFluxos />;
}
