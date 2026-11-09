import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const mapsDir = join(dirname(fileURLToPath(import.meta.url)), '../maps');
const ID = /^[a-z0-9-]{1,40}$/;

/**
 * Dev server only: `PUT /__repo/maps/<id>` writes the body to maps/<id>.json, so a map designed here
 * can be committed (the server seeds from those files, and they win over uploads). The editor
 * validates before it sends, and the server validates again when it next starts.
 */
function repoMaps(): Plugin {
  return {
    name: 'repo-maps',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__repo/maps/', (req, res) => {
        const id = (req.url ?? '').replace(/^\//, '').replace(/\.json$/, '');
        if (req.method !== 'PUT' || !ID.test(id)) {
          res.statusCode = 400;
          res.end('PUT /__repo/maps/<id> only');
          return;
        }
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => (body += chunk));
        req.on('end', () => {
          try {
            if (JSON.parse(body).id !== id) throw new Error('URL id and document id differ');
            writeFileSync(join(mapsDir, `${id}.json`), body.endsWith('\n') ? body : `${body}\n`);
            res.end(`maps/${id}.json`);
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [repoMaps()],
  server: {
    port: 5174,
    open: false,
    // The editor reuses the game's map types and drawing from ../client/src (and ../shared/defs).
    fs: { allow: ['..'] },
    // A local bootRun by default; API_TARGET=http://localhost:8551 uses the compose stack instead.
    proxy: { '/api': process.env.API_TARGET ?? 'http://localhost:8080' },
  },
});
