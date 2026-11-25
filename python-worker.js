/* Dedicated WebAssembly worker. No runtime fetch occurs before the first Run. */
const INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
let python = null;
let currentId = null;
let outputLength = 0;
let outputTruncated = false;
const OUTPUT_LIMIT = 120000;
const send = (type, values = {}) => self.postMessage({type, id: currentId, ...values});

function stream(channel, value) {
  if (channel === 'stderr' && String(value).trim() === 'Matplotlib is building the font cache; this may take a moment.') {
    send('progress', {text: 'Preparing Matplotlib fonts…'});
    return;
  }
  if (outputLength >= OUTPUT_LIMIT) {
    if (!outputTruncated) {
      outputTruncated = true;
      send('stream', {channel: 'stderr', text: '\n[Output truncated at 120,000 characters.]\n'});
    }
    return;
  }
  const text = (String(value) + '\n').slice(0, OUTPUT_LIMIT - outputLength);
  outputLength += text.length;
  send('stream', {channel, text});
}

async function runtime() {
  if (python) return python;
  send('progress', {text: 'Downloading Python runtime… First use requires internet.'});
  const {loadPyodide} = await import(INDEX_URL + 'pyodide.mjs');
  python = await loadPyodide({indexURL: INDEX_URL});
  send('progress', {text: 'Loading NumPy and Matplotlib…'});
  await python.loadPackage(['numpy', 'matplotlib'], {
    messageCallback: text => send('progress', {text}),
    errorCallback: text => stream('stderr', text),
  });
  python.setStdout({batched: value => stream('stdout', value)});
  python.setStderr({batched: value => stream('stderr', value)});
  python.setStdin({error: true});
  await python.runPythonAsync(`
import matplotlib
matplotlib.use('Agg', force=True)
import matplotlib.pyplot as plt
plt.show = lambda *args, **kwargs: None
`);
  send('ready', {version: python.version});
  return python;
}

const PREPARE = `
import json
import numpy as np
import matplotlib.pyplot as plt
plt.close('all')
plt.rcdefaults()
plt.style.use('dark_background')
plt.rcParams.update({
    'figure.facecolor': '#12233b', 'axes.facecolor': '#12233b',
    'savefig.facecolor': '#12233b', 'axes.edgecolor': '#6d88a6',
    'text.color': '#e4f2ff', 'axes.labelcolor': '#c5d8ec',
    'xtick.color': '#adc3de', 'ytick.color': '#adc3de',
    'grid.color': '#7b98ba', 'grid.alpha': 0.2,
    'font.size': 10, 'figure.dpi': 100,
})
_payload = json.loads(_context_json)
data = _payload['data']
history = _payload['history']
selection = _payload['selection']
user = _payload['user']
region = _payload['region']
satellite = _payload['satellite']
radio = _payload['radio']
network = _payload.get('network', {})
region_users = _payload.get('region_users', network.get('users', []))
meta = _payload.get('meta', {})
del _payload, _context_json
`;

const CAPTURE_RESULTS = `
import json as _falak_result_json
import math as _falak_result_math
import numpy as _falak_result_np
def _falak_normalize_result(value, depth=0):
    if depth > 30:
        raise ValueError('results contains too many nested levels')
    if isinstance(value, _falak_result_np.ndarray):
        return _falak_normalize_result(value.tolist(), depth + 1)
    if isinstance(value, _falak_result_np.generic):
        return _falak_normalize_result(value.item(), depth + 1)
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if _falak_result_math.isfinite(value) else None
    if isinstance(value, dict):
        return {str(k): _falak_normalize_result(v, depth + 1) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_falak_normalize_result(v, depth + 1) for v in value]
    raise TypeError('results supports JSON values and NumPy arrays/scalars; got ' + type(value).__name__)
_falak_result_text = _falak_result_json.dumps(_falak_normalize_result(globals().get('results')), allow_nan=False)
if len(_falak_result_text) > 8000000:
    raise ValueError('results exceeds the 8 MB JSON export limit; select fewer rows or columns')
_falak_result_text
`;

const CAPTURE = `
import io as _falak_io
import json as _falak_json
import base64 as _falak_base64
import matplotlib.pyplot as _falak_plt
_falak_plots = []
for _falak_number in _falak_plt.get_fignums()[:6]:
    _falak_figure = _falak_plt.figure(_falak_number)
    _falak_size = _falak_figure.get_size_inches()
    _falak_figure.set_size_inches(min(float(_falak_size[0]), 14), min(float(_falak_size[1]), 10))
    _falak_buffer = _falak_io.BytesIO()
    _falak_figure.savefig(_falak_buffer, format='png', dpi=140)
    _falak_plots.append(_falak_base64.b64encode(_falak_buffer.getvalue()).decode('ascii'))
_falak_plt.close('all')
_falak_json.dumps(_falak_plots)
`;

self.onmessage = async ({data: message}) => {
  if (message?.type !== 'run') return;
  if (currentId !== null) {
    self.postMessage({type: 'fatal', id: message.id, error: 'Python is already running.'});
    return;
  }
  currentId = message.id;
  outputLength = 0;
  outputTruncated = false;
  let globals;
  try {
    const py = await runtime();
    send('running', {text: 'Running Python…'});
    globals = py.toPy({_context_json: JSON.stringify(message.context), __name__: '__main__'});
    await py.runPythonAsync(PREPARE, {globals});
    let executionError = null;
    const started = performance.now();
    try {
      const value = await py.runPythonAsync(message.code, {globals, filename: 'falak_workspace.py'});
      value?.destroy?.();
    } catch (error) {
      executionError = String(error.message || error).slice(0, 50000);
    }
    // Flush print(..., end='') and send figures even if a later line raised an error.
    py.runPython('import sys; sys.stdout.flush(); sys.stderr.flush()');
    let plots = [];
    let results = null, resultsError = null;
    try {
      results = JSON.parse(await py.runPythonAsync(CAPTURE_RESULTS, {globals}));
    } catch (error) {
      resultsError = 'Results export: ' + String(error.message || error).slice(0, 10000);
    }
    try {
      plots = JSON.parse(await py.runPythonAsync(CAPTURE));
    } catch (error) {
      executionError = [executionError, 'Plot export: ' + (error.message || error)].filter(Boolean).join('\n');
    }
    send('complete', {error: executionError, plots, results, results_error: resultsError, duration_ms: performance.now() - started});
  } catch (error) {
    send('fatal', {error: String(error.message || error).slice(0, 50000)});
  } finally {
    globals?.destroy?.();
    currentId = null;
  }
};
