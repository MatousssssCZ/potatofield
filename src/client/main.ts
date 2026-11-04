import { App } from './app';

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
