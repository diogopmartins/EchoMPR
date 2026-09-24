/**
 * Lazy ONNX Runtime Web loader. The runtime (~14 MB of WebAssembly) is only
 * fetched the first time a model is loaded, and inference stays in the
 * browser like the rest of the app.
 */
let ortPromise = null;

function loadOrt() {
  if (!ortPromise) {
    ortPromise = import('onnxruntime-web/wasm').then((ort) => {
      // Threads need cross-origin isolation, which GitHub Pages does not provide.
      ort.env.wasm.numThreads = window.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      return ort;
    });
  }
  return ortPromise;
}

/** Create an inference session from the bytes of an .onnx file. */
export async function createSession(bytes) {
  const ort = await loadOrt();
  const session = await ort.InferenceSession.create(new Uint8Array(bytes), {
    executionProviders: ['wasm'],
  });
  const meta = session.inputMetadata?.[0];
  return {
    ort,
    session,
    inputName: session.inputNames[0],
    outputName: session.outputNames[0],
    inputShape: meta?.isTensor ? meta.shape : undefined,
  };
}

/** Run a [1, 1, n, n, n] cube; returns the flattened scores and class count. */
export async function runCube({ ort, session, inputName, outputName }, cube, n) {
  const input = new ort.Tensor('float32', cube, [1, 1, n, n, n]);
  const result = await session.run({ [inputName]: input });
  const out = result[outputName];
  if (!out || out.dims.length !== 5 || out.dims[2] !== n || out.dims[3] !== n || out.dims[4] !== n) {
    throw new Error(`Expected output [1, C, ${n}, ${n}, ${n}], got [${out?.dims?.join(', ')}]`);
  }
  return { scores: out.data, classes: out.dims[1] };
}
