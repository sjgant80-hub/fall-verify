// ═══════════════════════════════════════════════════════════════════
//  fall-verify-sdk · v1.0 · drop-in adversarial verification
//  prime 401 · sovereign · MIT · BYO Anthropic key
//
//  ESM wrapper around fall-verify-worker. Re-exports verify, batchVerify.
//
//  Usage:
//    import { verify, batchVerify } from 'https://sjgant80-hub.github.io/fall-verify/fall-verify-sdk.js';
//
//    const v = await verify({
//      claim: 'GPT-4 was trained on 13 trillion tokens',
//      panelSize: 3,
//      killThreshold: 2,
//      byoKey: 'sk-ant-...',
//    });
// ═══════════════════════════════════════════════════════════════════

const WORKER_URL = new URL('./fall-verify-worker.js', import.meta.url).href;

let _workerLoaded = null;

async function ensureWorker() {
  if (_workerLoaded) return _workerLoaded;
  if (typeof window === 'undefined') throw new Error('fall-verify: SDK requires a browser window');
  if (window.FallVerify) { _workerLoaded = window.FallVerify; return _workerLoaded; }
  _workerLoaded = new Promise(function(resolve, reject){
    const s = document.createElement('script');
    s.src = WORKER_URL;
    s.async = true;
    s.onload = function(){
      if (window.FallVerify) resolve(window.FallVerify);
      else reject(new Error('fall-verify: worker loaded but FallVerify not exposed'));
    };
    s.onerror = function(){ reject(new Error('fall-verify: failed to load worker from ' + WORKER_URL)); };
    document.head.appendChild(s);
  });
  return _workerLoaded;
}

export async function verify(opts) {
  const fv = await ensureWorker();
  return fv.verify(opts);
}

export async function batchVerify(claims, opts) {
  const fv = await ensureWorker();
  return fv.batchVerify(claims, opts);
}

export async function demoVerify(presetKey, opts) {
  const fv = await ensureWorker();
  return fv.demoVerify(presetKey, opts);
}

export const VERSION = '1.0';
export const PRIME = 401;

export default { verify, batchVerify, demoVerify, VERSION, PRIME };
