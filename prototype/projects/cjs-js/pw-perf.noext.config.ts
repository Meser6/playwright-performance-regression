import { tag } from './cfg/helpers';

interface ProtoPerfConfig {
  run: { repeat: number };
  marker: string;
  tag: string;
}

const config: ProtoPerfConfig = { run: { repeat: 3 }, marker: 'cjs-js/noext', tag };
export default config;
