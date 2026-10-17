// `npm run dev`: sobe tudo em modo de desenvolvimento, com recarga ao salvar.
//   Horizonte (sistema de exemplo com o widget)  http://localhost:4000
//   Console do copiloto                           http://localhost:5173
//   API do copiloto e copiloto.js                 http://localhost:3000
import { ambiente, avisoChave, carregarEnv, garantirChromium, garantirDependencias, rodarJuntos, titulo } from './comum.mjs';

carregarEnv();
garantirDependencias();
await garantirChromium();

titulo('Copiloto em modo de desenvolvimento');
avisoChave();
console.log(`
  Sistema de exemplo (Horizonte), com o widget:  http://localhost:4000   (entre como Ana Ribeiro)
  Console do copiloto:                           http://localhost:5173   (rafael.lima@seusistema.com.br / copiloto123)
  Para parar: Ctrl+C
`);

const env = ambiente();
await rodarJuntos([
  { name: 'horizonte', command: 'npm run dev -w sample-system', prefixColor: 'cyan', env: { ...env, HORIZONTE_PORT: '4000' } },
  { name: 'copiloto', command: 'npm run dev -w server', prefixColor: 'magenta', env: { ...env, PORT: '3000' } },
  { name: 'widget', command: 'npm run dev -w widget', prefixColor: 'yellow', env },
  { name: 'console', command: 'npm run dev -w console', prefixColor: 'green', env },
]);
