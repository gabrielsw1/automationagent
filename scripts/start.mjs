// `npm start` (e o Docker): Horizonte e copiloto compilados, sem recarga. O servidor do copiloto
// entrega o console em http://localhost:3000 e o copiloto.js; o Horizonte fica em http://localhost:4000.
import { ambiente, avisoChave, carregarEnv, garantirChromium, garantirDependencias, rodarJuntos, titulo } from './comum.mjs';

carregarEnv();
garantirDependencias();
await garantirChromium();

const portaCopiloto = process.env.PORT || '3000';
const portaHorizonte = process.env.HORIZONTE_PORT || '4000';
titulo('Copiloto');
avisoChave();
console.log(`
  Sistema de exemplo (Horizonte), com o widget:  http://localhost:${portaHorizonte}   (entre como Ana Ribeiro)
  Console do copiloto:                           http://localhost:${portaCopiloto}   (rafael.lima@seusistema.com.br / copiloto123)
`);

const env = ambiente({ CONSOLE_URL: process.env.CONSOLE_URL || `http://localhost:${portaCopiloto}` });
await rodarJuntos([
  { name: 'horizonte', command: 'npm run start -w sample-system', prefixColor: 'cyan', env: { ...env, HORIZONTE_PORT: portaHorizonte } },
  { name: 'copiloto', command: 'npm run start -w server', prefixColor: 'magenta', env: { ...env, PORT: portaCopiloto } },
]);
