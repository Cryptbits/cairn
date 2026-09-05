/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CAIRN_CONTRACT_ADDRESS: string;
  readonly VITE_CUSDT_CONTRACT_ADDRESS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
