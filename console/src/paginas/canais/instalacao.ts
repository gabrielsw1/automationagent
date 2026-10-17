// Trecho de instalação do widget e exemplos de assinatura, os mesmos em Canais e widget e no guia.
// Empresas ligadas só pelas telas (`tela`) mandam também nome, e-mail e perfis de quem está logado,
// assinados junto com o ID; ligadas por API, só o ID (o resto vem da API do sistema).
import { textoAssinado, type ConectorSistema } from '@copiloto/shared';

export function trechoInstalacao(urlScript: string, chave: string, conector: ConectorSistema): string {
  const linhas = [`<script src="${urlScript}"`, `  data-chave="${chave}"`, '  data-usuario="ID_DO_USUARIO_LOGADO"'];
  if (conector === 'tela') {
    linhas.push('  data-nome="NOME_DO_USUARIO"', '  data-email="EMAIL_DO_USUARIO"', '  data-perfis="PERFIS_SEPARADOS_POR_VIRGULA"');
  }
  linhas.push(`  data-assinatura="${conector === 'tela' ? 'HMAC_DOS_DADOS_DO_USUARIO' : 'HMAC_DO_ID_DO_USUARIO'}"`, '  async></script>');
  return linhas.join('\n');
}

/** Exemplo do texto assinado (calculado por `textoAssinado`, o mesmo que o servidor confere). */
export const EXEMPLO_ASSINADO = textoAssinado('101', {
  nome: 'Ana Ribeiro',
  email: 'ana@suaempresa.com.br',
  perfis: ['Atendimento', 'Comercial'],
});

/** Como calcular o data-assinatura no servidor do sistema, em Node.js, PHP e Python. */
export function exemplosAssinatura(conector: ConectorSistema): { linguagem: string; codigo: string }[] {
  if (conector === 'tela') {
    return [
      {
        linguagem: 'Node.js',
        codigo: `const crypto = require('node:crypto');
// ID, nome, e-mail e perfis (separados só por vírgula), um por linha, iguais aos do trecho.
const texto = [usuario.id, usuario.nome, usuario.email, usuario.perfis.join(',')].join('\\n');
const assinatura = crypto
  .createHmac('sha256', process.env.WIDGET_SEGREDO)
  .update(texto)
  .digest('hex');`,
      },
      {
        linguagem: 'PHP',
        codigo: `$texto = implode("\\n", [(string) $usuario->id, $usuario->nome, $usuario->email, implode(',', $usuario->perfis)]);
$assinatura = hash_hmac('sha256', $texto, getenv('WIDGET_SEGREDO'));`,
      },
      {
        linguagem: 'Python',
        codigo: `import hmac, hashlib, os
texto = "\\n".join([str(usuario.id), usuario.nome, usuario.email, ",".join(usuario.perfis)])
assinatura = hmac.new(os.environ["WIDGET_SEGREDO"].encode(),
                      texto.encode(), hashlib.sha256).hexdigest()`,
      },
    ];
  }
  return [
    {
      linguagem: 'Node.js',
      codigo: `const crypto = require('node:crypto');
const assinatura = crypto
  .createHmac('sha256', process.env.WIDGET_SEGREDO)
  .update(String(usuario.id))
  .digest('hex');`,
    },
    { linguagem: 'PHP', codigo: `$assinatura = hash_hmac('sha256', (string) $usuario->id, getenv('WIDGET_SEGREDO'));` },
    {
      linguagem: 'Python',
      codigo: `import hmac, hashlib, os
assinatura = hmac.new(os.environ["WIDGET_SEGREDO"].encode(),
                      str(usuario.id).encode(), hashlib.sha256).hexdigest()`,
    },
  ];
}

/**
 * Endereço de sessão (modo "Com a sessão de quem pede"): o copiloto manda POST {urlSessao} com
 * {"usuario": "<id>", "ts": <unix ms>} e o cabeçalho X-Copiloto-Assinatura (HMAC-SHA256 em hex de
 * "<usuario>.<ts>" com o segredo do widget). O sistema confere e devolve os cookies da sessão
 * dessa pessoa ou um link de entrada única.
 */
export function exemplosSessao(): { linguagem: string; codigo: string }[] {
  return [
    {
      linguagem: 'Node.js (Express)',
      codigo: `app.post('/copiloto/sessao', express.json(), (req, res) => {
  const { usuario, ts } = req.body;
  const esperado = crypto.createHmac('sha256', process.env.WIDGET_SEGREDO)
    .update(\`\${usuario}.\${ts}\`).digest('hex');
  const recebido = req.get('X-Copiloto-Assinatura') ?? '';
  const confere = recebido.length === esperado.length &&
    crypto.timingSafeEqual(Buffer.from(recebido), Buffer.from(esperado));
  if (!confere || Math.abs(Date.now() - ts) > 5 * 60_000) return res.status(401).end();
  const token = criarSessaoPara(usuario); // a sessão do seu sistema para essa pessoa
  res.json({ cookies: [{ name: 'sessao', value: token }] });
});`,
    },
    {
      linguagem: 'PHP',
      codigo: `$corpo = json_decode(file_get_contents('php://input'), true);
$esperado = hash_hmac('sha256', $corpo['usuario'] . '.' . $corpo['ts'], getenv('WIDGET_SEGREDO'));
$recebido = $_SERVER['HTTP_X_COPILOTO_ASSINATURA'] ?? '';
if (!hash_equals($esperado, $recebido) || abs(microtime(true) * 1000 - $corpo['ts']) > 300000) {
  http_response_code(401);
  exit;
}
header('Content-Type: application/json');
echo json_encode(['cookies' => [['name' => 'sessao', 'value' => criar_sessao_para($corpo['usuario'])]]]);`,
    },
    {
      linguagem: 'Python (Flask)',
      codigo: `@app.post("/copiloto/sessao")
def sessao_do_copiloto():
    corpo = request.get_json()
    esperado = hmac.new(os.environ["WIDGET_SEGREDO"].encode(),
                        f"{corpo['usuario']}.{corpo['ts']}".encode(), hashlib.sha256).hexdigest()
    recebido = request.headers.get("X-Copiloto-Assinatura", "")
    if not hmac.compare_digest(esperado, recebido) or abs(time.time() * 1000 - corpo["ts"]) > 300_000:
        abort(401)
    return {"cookies": [{"name": "sessao", "value": criar_sessao_para(corpo["usuario"])}]}`,
    },
  ];
}
