import type { CapacitorConfig } from '@capacitor/cli';

/**
 * CAP_DEV_URL=http://<laptop LAN IP>:5175 loads the mobile Vite dev server instead of the bundled
 * dist/ (live reload on a device). Leave it unset for real builds.
 */
const devUrl = process.env.CAP_DEV_URL;

const config: CapacitorConfig = {
  appId: 'com.boardedup.game',
  appName: 'Boarded Up',
  webDir: 'dist',
  backgroundColor: '#000000',
  server: devUrl ? { url: devUrl, cleartext: true } : undefined,
  ios: { contentInset: 'never' },
  android: { allowMixedContent: false },
};

export default config;
