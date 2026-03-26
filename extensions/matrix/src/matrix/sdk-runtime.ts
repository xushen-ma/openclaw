import { createRequire } from "node:module";

type MatrixSdkRuntime = typeof import("@vector-im/matrix-bot-sdk");
type MatrixJsSdkRuntime = typeof import("matrix-js-sdk");

let cachedMatrixSdkRuntime: MatrixSdkRuntime | null = null;
let cachedMatrixJsSdkRuntime: MatrixJsSdkRuntime | null = null;

export function loadMatrixSdk(): MatrixSdkRuntime {
  if (cachedMatrixSdkRuntime) {
    return cachedMatrixSdkRuntime;
  }
  const req = createRequire(import.meta.url);
  cachedMatrixSdkRuntime = req("@vector-im/matrix-bot-sdk") as MatrixSdkRuntime;
  return cachedMatrixSdkRuntime;
}

export function loadMatrixJsSdk(): MatrixJsSdkRuntime {
  if (cachedMatrixJsSdkRuntime) {
    return cachedMatrixJsSdkRuntime;
  }
  const req = createRequire(import.meta.url);
  cachedMatrixJsSdkRuntime = req("matrix-js-sdk") as MatrixJsSdkRuntime;
  return cachedMatrixJsSdkRuntime;
}

export function getMatrixLogService() {
  return loadMatrixSdk().LogService;
}
