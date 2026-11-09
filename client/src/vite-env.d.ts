/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The game server's base URL (e.g. https://topdownsurvival.example.com); unset means same origin. */
  readonly VITE_SERVER_URL?: string;
}
