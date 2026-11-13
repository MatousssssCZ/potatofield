import '@fontsource/barlow-semi-condensed/400.css';
import '@fontsource/barlow-semi-condensed/600.css';
import '@fontsource/barlow-semi-condensed/700.css';
import { App } from './app';
import { installErrorReporting } from './errorReport';

installErrorReporting();

async function main() {
  const app = new App();
  await app.prepare();
  await app.init();
}

main().catch((e) => {
  console.error(e);
  const st = document.querySelector('#loading .status');
  if (st) st.textContent = `Chyba při načítání: ${(e as Error).message}`;
});
