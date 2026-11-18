import { tag } from './cfg/helpers.ts';

interface ProtoPerfConfig {
  run: { repeat: number };
  marker: string;
  tag: string;
}

const config: ProtoPerfConfig = { run: { repeat: 3 }, marker: 'cjs-js/plain', tag };
export default config;
