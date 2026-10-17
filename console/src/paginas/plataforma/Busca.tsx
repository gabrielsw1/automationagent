// "Buscar empresa": filtra a lista de Empresas. O texto fica no endereço (?busca=); digitado em
// outra página, leva para Empresas já filtrando.
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Icone } from '../../componentes/icones.tsx';

export function BuscaEmpresa({ id, classe }: { id: string; classe?: string }) {
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();
  const naLista = pathname === '/plataforma' || pathname === '/plataforma/';
  const valor = naLista ? (params.get('busca') ?? '') : '';
  return (
    <div className={`search ${classe ?? ''}`}>
      <Icone nome="busca" />
      <label className="sr-only" htmlFor={id}>
        Buscar empresa
      </label>
      <input
        id={id}
        className="input"
        type="search"
        placeholder="Buscar empresa, CNPJ ou responsável"
        value={valor}
        onChange={(e) => {
          const v = e.target.value;
          if (!naLista) {
            navegar(`/plataforma?busca=${encodeURIComponent(v)}`);
            return;
          }
          setParams(
            (p) => {
              const n = new URLSearchParams(p);
              if (v) n.set('busca', v);
              else n.delete('busca');
              return n;
            },
            { replace: true },
          );
        }}
      />
    </div>
  );
}

