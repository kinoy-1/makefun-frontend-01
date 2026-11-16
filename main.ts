// Bountyline — makefun-frontend-01 entry program (Node 22, standard library only).
//
// The frontend lives in app/ beside this file: plain static files
// (index.html, one ES module, one stylesheet), no build step, reading
// make.fun's public API. This program hands the entry in: it copies app/
// and screenshots/ into the output directory and writes dossier.json with
// the kit's vendored library. The grader runs it twice and both runs must
// write identical bytes, so it does nothing time-dependent and no network:
// pure file copying plus the deterministic dossier builder.
// vendor/makefun-frontend.ts stays exactly as the kit shipped it — the
// scorer rebuilds the dossier with its own copy and compares the two
// byte for byte.
//
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-frontend.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'app'), join(out, 'app'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// Caps from the kit's gate reference: at most 3 screenshots of 256 KiB, app/
// at most 993 files and directories and 16 MiB, dossier text at most 160 KiB.
// The output layout is fixed: app/, screenshots/ and dossier.json at the top
// level, so the scorer can find each part without guessing.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 3, max_bytes: 262144 },
    app_max_files: 993,
    app_max_bytes: 16777216,
  }),
);
