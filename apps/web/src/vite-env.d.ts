/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Who is answerable for the personal data this installation holds — the
   * business running it, not the software. A privacy notice that names nobody
   * tells a person nothing about who to ask, so this is set per installation
   * at build time and the notice says plainly when it has not been.
   */
  readonly VITE_DATA_CONTROLLER_NAME?: string;
  /** Where a person sends a question or a request about their information. */
  readonly VITE_PRIVACY_CONTACT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
