import { Worker } from 'node:worker_threads';

function run(kind, input) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./generator-worker.mjs', import.meta.url), {
      workerData: { kind, input },
      resourceLimits: { maxOldGenerationSizeMb: 320, maxYoungGenerationSizeMb: 32 },
    });
    let settled = false;
    const timer = setTimeout(() => finish(new Error('本地生成超过 25 秒，请缩小输入。')), 25000);
    function finish(error, value) {
      if (settled) return;
      settled = true; clearTimeout(timer); void worker.terminate();
      error ? reject(error) : resolve(value);
    }
    worker.once('message', message => message.error ? finish(new Error(message.error)) : finish(null, message.result));
    worker.once('error', finish);
    worker.once('exit', code => { if (!settled) finish(new Error(`本地生成器意外退出 (${code})`)); });
  });
}

export const generateKrn = schema => run('krn', schema);
export const generateTheme = theme => run('theme', theme);
