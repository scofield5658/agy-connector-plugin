import { createInterface } from 'node:readline';
const send = (x) => console.log(JSON.stringify(x));
createInterface({ input: process.stdin }).on('line', (line) => {
  const e = JSON.parse(line);
  if (e.id === 1) send({ id: 1, result: '中文' });
  if (e.id === 2) send({ id: 2, result: 'confirmed' });
});
