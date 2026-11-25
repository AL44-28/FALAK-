/** Browser Python workspace; the heavy runtime is created only by an explicit Run. */
export const DEFAULT_PYTHON = `# Current selection: data, user, region, satellite, radio, selection
# Full selected-link history: history (all stored samples)
# Automatic regional service: network, region_users; dataset metadata: meta
# NumPy (np) and Matplotlib (plt) are ready to use.
t = np.asarray(history['time_s'], dtype=float)
snr = np.asarray([np.nan if value is None else value
                  for value in history['snr']], dtype=float)
results = {'time_s': t, 'snr_db': snr}

fig, ax = plt.subplots(figsize=(9, 4.5))
ax.plot(t, snr, color='#6cbfff', linewidth=1.7, label='Calculated SNR')
ax.axvline(data['time_s'], color='#ffcb7b', linestyle='--',
           label=f\"Selected time: {data['time_s']} s\")
ax.set(xlabel='Simulation time (s)', ylabel='SNR (dB)',
       title=f\"{region['name']} / {satellite['name']} / User {user['id']}\")
ax.grid(True)
ax.legend(loc='best')
fig.tight_layout()
plt.show()

valid = np.isfinite(snr)
print(f\"User {user['id']} · {region['name']} · {satellite['name']}\")
print('History samples:', len(t))
print('Selected sample (s):', data['time_s'])
if valid.any():
    print(f'Mean accessible SNR: {np.mean(snr[valid]):.3f} dB')
else:
    print('No geometric access for this selected link in the stored record.')
`;

const STORAGE_KEY = 'falak.python.workspace.v2';
const LOAD_TIMEOUT_MS = 180000;
const RUN_TIMEOUT_MS = 30000;

/** Worker lifecycle separated from DOM so cancellation/timeout can be verified. */
export class PythonRunner {
  constructor(onEvent = () => {}, options = {}) {
    this.onEvent = onEvent;
    this.makeWorker = options.makeWorker || (() => new Worker(new URL('./python-worker.js', import.meta.url), {type: 'module', name: 'falak-python'}));
    this.loadTimeout = options.loadTimeout ?? LOAD_TIMEOUT_MS;
    this.runTimeout = options.runTimeout ?? RUN_TIMEOUT_MS;
    this.worker = null; this.pending = null; this.ready = false; this.serial = 0;
  }
  run(code, context) {
    if (this.pending) return Promise.reject(Error('A Python run is already active.'));
    if (!code.trim()) return Promise.reject(Error('Write some Python code before running.'));
    if (code.length > 250000) return Promise.reject(Error('The editor limit is 250,000 characters.'));
    return new Promise((resolve, reject) => {
      const id = ++this.serial;
      this.pending = {id, resolve, reject};
      try {
        if (!this.worker) {
          this.worker = this.makeWorker();
          this.worker.onmessage = event => this.receive(event.data);
          this.worker.onerror = event => this.fail(Error(event.message || 'Python worker could not start.'));
          this.worker.onmessageerror = () => this.fail(Error('Could not read the Python worker response.'));
        }
        this.arm(this.ready ? this.runTimeout : this.loadTimeout, this.ready ? 'execution' : 'download');
        this.worker.postMessage({type: 'run', id, code, context});
      } catch (error) { this.fail(error); }
    });
  }
  arm(ms, phase) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.cancel(phase === 'download'
      ? 'Python download timed out. Check internet access to cdn.jsdelivr.net, then run again.'
      : 'Python exceeded the 30-second execution limit. The worker was stopped; shorten the calculation and run again.'), ms);
  }
  receive(message) {
    if (!this.pending || message.id !== this.pending.id) return;
    if (message.type === 'ready') this.ready = true;
    if (message.type === 'running') this.arm(this.runTimeout, 'execution');
    this.onEvent(message);
    if (message.type === 'complete') {
      clearTimeout(this.timer); const {resolve} = this.pending; this.pending = null; resolve(message);
    } else if (message.type === 'fatal') this.fail(Error(this.ready ? (message.error || 'Python failed.') :
      'Python could not load. Check internet access to cdn.jsdelivr.net, then run again.\n' + (message.error || 'Runtime initialization failed.')));
  }
  fail(error) {
    clearTimeout(this.timer);
    this.worker?.terminate(); this.worker = null; this.ready = false;
    const pending = this.pending; this.pending = null; pending?.reject(error);
  }
  cancel(reason = 'Run cancelled. The Python runtime was reset.') { this.fail(Error(reason)); }
  dispose() { this.cancel('Python workspace closed.'); }
}

export const SCENARIO_COUNT = 4;
export const SCENARIO_STORAGE_KEY = 'falak.python.scenarios.v4';
const PREVIOUS_SCENARIO_STORAGE_KEY = 'falak.python.scenarios.v3';
const WORKSPACE_SCHEMA = 'falak.workspace.v1';
const MAX_SOURCE_LENGTH = 250000;
const MAX_BACKUP_LENGTH = 5000000;

function browserStorage() { try { return globalThis.localStorage; } catch { return undefined; } }
function sourceRecord(value, index, strict = false) {
  if (!value || typeof value !== 'object' || typeof value.title !== 'string' || typeof value.source !== 'string') {
    if (strict) throw Error(`Scenario ${index + 1} needs a name and Python source.`);
    return {title:`Scenario ${index + 1}`, source:DEFAULT_PYTHON};
  }
  if (strict && (value.title.length > 70 || value.source.length > MAX_SOURCE_LENGTH)) throw Error('Scenario names must be at most 70 characters and code at most 250,000 characters.');
  return {title:value.title.slice(0,70) || `Scenario ${index + 1}`, source:value.source};
}
function runtimeSlot(record, index) {
  return {id:index+1, ...record, output:'', error:'', plots:[], status:'Ready to run', lastRun:null, context:null, runSource:null, results:null};
}
function uniqueRecords(records) {
  const seen = new Set();
  return records.filter(record => {const key = JSON.stringify([record.title, record.source]); if (seen.has(key)) return false; seen.add(key); return true;});
}
export function parseWorkspaceBackup(text) {
  if (typeof text !== 'string' || text.length > MAX_BACKUP_LENGTH) throw Error('Choose a workspace JSON file smaller than 5 MB.');
  let value; try {value=JSON.parse(text);} catch {throw Error('This file is not valid JSON.');}
  if (value?.schema !== WORKSPACE_SCHEMA || !Array.isArray(value.scenarios) || value.scenarios.length !== SCENARIO_COUNT || (value.archived_scenarios != null && !Array.isArray(value.archived_scenarios))) throw Error('Choose a FALAK workspace backup with four scenarios.');
  const all = [...value.scenarios, ...(value.archived_scenarios || [])];
  const records = all.map((record,index) => sourceRecord(record,index,true));
  return {schema:WORKSPACE_SCHEMA,scenarios:records.slice(0,SCENARIO_COUNT),archived_scenarios:uniqueRecords(records.slice(SCENARIO_COUNT)),saved_at:typeof value.saved_at==='string'?value.saved_at:null};
}
export function readScenarioWorkspace(storage = browserStorage()) {
  let previous = [], legacy, error = '', current;
  try {
    if (!storage) throw Error('Browser storage is unavailable.');
    current=storage.getItem(SCENARIO_STORAGE_KEY);
    if (current) return {...parseWorkspaceBackup(current), persisted:true, error:''};
    const raw=storage.getItem(PREVIOUS_SCENARIO_STORAGE_KEY);
    if(raw) {const value=JSON.parse(raw);if(Array.isArray(value))previous=value;}
    legacy=storage.getItem(STORAGE_KEY);
  } catch (issue) {error=issue.message || 'Saved scenarios could not be read.';}
  const records=Array.from({length:SCENARIO_COUNT},(_,index)=>previous[index]
    ? sourceRecord(previous[index],index)
    : {title:`Scenario ${index+1}`,source:index===0&&typeof legacy==='string'?legacy:DEFAULT_PYTHON});
  return {schema:WORKSPACE_SCHEMA,scenarios:records,archived_scenarios:previous.slice(SCENARIO_COUNT).map((record,index)=>sourceRecord(record,index+SCENARIO_COUNT)),saved_at:null,persisted:false,error};
}
export function createScenarioSlots(storage = browserStorage()) {
  return readScenarioWorkspace(storage).scenarios.map(runtimeSlot);
}
export function workspaceBackup(slots, archived = [], savedAt = null) {
  return {schema:WORKSPACE_SCHEMA,scenarios:slots.map((slot,index)=>sourceRecord(slot,index,true)),archived_scenarios:uniqueRecords(archived.map((slot,index)=>sourceRecord(slot,index,true))),saved_at:savedAt};
}
export function persistScenarioWorkspace(slots, archived = [], storage = browserStorage()) {
  if (!storage) throw Error('Browser storage is unavailable. Export a workspace backup to keep your code.');
  const payload=workspaceBackup(slots,archived,new Date().toISOString());
  if(payload.scenarios.length!==SCENARIO_COUNT)throw Error('A workspace must contain four scenarios.');
  const serialized=JSON.stringify(payload);
  if(serialized.length>MAX_BACKUP_LENGTH)throw Error('The workspace is too large to save. Export a backup first.');
  try {
    const current=storage.getItem(SCENARIO_STORAGE_KEY);
    if(current){
      try {parseWorkspaceBackup(current);} catch {
        // Retain unreadable stored text before an explicit replacement; never erase it silently.
        storage.setItem(SCENARIO_STORAGE_KEY+'.unreadable-backup',current);
      }
    }
    storage.setItem(SCENARIO_STORAGE_KEY,serialized);
  } catch {throw Error('Could not save in this browser. Storage may be blocked or full. Export a workspace backup to keep your code.');}
  return payload;
}
function download(name, content, type='text/plain;charset=utf-8') {
  const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const clone = value => JSON.parse(JSON.stringify(value));
const csvCell = value => '"'+String(value==null?'':typeof value==='object'?JSON.stringify(value):value).replaceAll('"','""')+'"';
export function tableRows(value) {
  if(Array.isArray(value)) return value.map(row=>row&&typeof row==='object'&&!Array.isArray(row)?row:Array.isArray(row)?Object.fromEntries(row.map((v,i)=>[`column_${i+1}`,v])):{value:row});
  if(value&&typeof value==='object') {
    const entries=Object.entries(value),arrays=entries.filter(([,v])=>Array.isArray(v));
    if(arrays.length) {
      const n=arrays[0][1].length;
      if(arrays.some(([,v])=>v.length!==n))throw Error('CSV columns must have the same length.');
      return Array.from({length:n},(_,i)=>Object.fromEntries(entries.map(([k,v])=>[k,Array.isArray(v)?v[i]:v])));
    }
    return [value];
  }
  if(value==null)return [];
  return [{value}];
}
export function csvText(value) {
  const rows=tableRows(value);if(!rows.length)return '';
  const keys=[...new Set(rows.flatMap(row=>Object.keys(row)))];
  return [keys.map(csvCell).join(','),...rows.map(row=>keys.map(k=>csvCell(row[k])).join(','))].join('\r\n')+'\r\n';
}
export class PythonWorkspace {
  constructor(simulation, callbacks={}) {
    this.sim=simulation;this.callbacks=callbacks;this.storage=callbacks.storage ?? browserStorage();
    const saved=readScenarioWorkspace(this.storage);
    this.slots=saved.scenarios.map(runtimeSlot);this.archived=saved.archived_scenarios;this.activeIndex=0;
    this.savedAt=saved.saved_at;this.hasSavedCopy=saved.persisted;this.savedSignature=this.signature();
    this.saveError=saved.error;this.notice='';
    this.beforeUnload=event=>{if(this.dirty){event.preventDefault();event.returnValue='';}};
    this.busy=false;this.runningSlot=null;this.root=null;
    this.runner=new PythonRunner(message=>this.event(message),callbacks.runnerOptions);
  }
  get slot(){return this.slots[this.activeIndex]}
  mount(root) {
    this.root=root;
    root.innerHTML=`<div class="py-slots" role="tablist" aria-label="Four Python scenarios">${this.slots.map((slot,i)=>`<button type="button" role="tab" data-slot="${i}" aria-controls="pythonScenarioPanel"><span class="py-slot-number">0${i+1}</span><span class="py-slot-copy"><strong data-slot-title="${i}"></strong><small data-slot-state="${i}">Ready to run</small></span></button>`).join('')}</div>
    <section id="pythonScenarioPanel" role="tabpanel" class="sc-module py-workspace"><div class="sc-heading"><div><span class="sc-eyebrow">PYTHON WORKSPACE</span><label class="py-name-label">Scenario name<input data-py="name" type="text" maxlength="70" aria-label="Scenario name"></label></div><span class="py-runtime-badge">Python · NumPy · Matplotlib</span></div>
      <div class="sc-toolbar py-toolbar"><button data-py="saveChanges" class="sc-action py-save-changes">Save changes</button><button data-py="run" class="sc-action">Run Python</button><button data-py="cancel" class="sc-secondary" disabled>Cancel</button><button data-py="reset" class="sc-secondary">Reset runtime</button><button data-py="example" class="sc-secondary">Restore example</button><button data-py="save" class="sc-secondary">Download .py</button><label class="py-file-label sc-secondary">Load .py<input data-py="file" type="file" accept=".py,.txt,text/plain"></label></div>
      <div class="py-save-bar"><span data-py="saveStatus" role="status" aria-live="polite"></span><span class="py-save-hint">Saved on this browser and site. Export a backup to use another device.</span><button data-py="backup" class="sc-secondary">Export workspace</button><label class="py-file-label sc-secondary">Import workspace<input data-py="importWorkspace" type="file" accept=".json,application/json"></label></div><p data-py="saveError" class="py-save-error" role="alert" hidden></p><p data-py="archiveNote" class="py-archive-note" hidden></p>
      <div class="py-context"><span data-py="context"></span><span data-py="status" role="status" aria-live="polite"></span></div>
      <div class="py-panels"><div class="py-editor-panel"><div class="py-panel-title"><span data-py="filename"></span><small>Ctrl / ⌘ + S: Save · Ctrl / ⌘ + Enter: Run</small></div><textarea data-py="editor" class="py-editor" aria-label="Python code editor" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off"></textarea></div><div class="py-results-panel"><div class="py-panel-title"><span>Plots</span><span data-py="resultContext"></span></div><div data-py="plots" class="py-plots"></div></div></div>
      <div class="py-export-bar"><span>Export this scenario</span><button data-py="json" class="sc-secondary">Data JSON</button><button data-py="history" class="sc-secondary">Link history CSV</button><button data-py="users" class="sc-secondary">Region users CSV</button><button data-py="results" class="sc-secondary">Results CSV</button><small data-py="exportContext"></small></div>
      <div class="py-console"><div class="py-panel-title"><span>Output</span><button data-py="clear" type="button">Clear output</button></div><pre data-py="stdout" aria-label="Python standard output"></pre><pre data-py="error" class="py-error" aria-label="Python errors" hidden></pre></div>
      <details class="sc-model"><summary>Data and exports</summary><p><code>data</code>, <code>history</code> and <code>user</code> describe the selected satellite's link. <code>network</code> and <code>region_users</code> describe automatic regional service. Also available: <code>region</code>, <code>satellite</code>, <code>radio</code>, <code>selection</code>, <code>meta</code>, <code>np</code> and <code>plt</code>. Each Run captures the current selection and uses a fresh Python namespace. Set <code>results</code> to a list of rows or a dictionary of equal-length columns to enable Results CSV.</p><p>Each scenario keeps its own code, output, plots and last run. Exports use that run's captured data; before the first Run they use the current selection. JSON contains inputs, source, output and exportable results. CSV uses the same captured data. Use Save changes (or Ctrl / ⌘ + S) to keep code and scenario names on this browser and site, even after closing the page. This does not update other devices or the published site files. Export workspace and Import workspace transfer all four scenarios and preserved older scenarios. Output and plots last until reload. Download .py, PNG or Data JSON to keep results as files.</p><p>Python loads only on first Run from the pinned Pyodide 0.27.7 CDN and requires internet. No local Python installation is needed. One shared worker runs at a time; switching scenarios does not move the running result into another scenario. Cancel stops the running scenario. Runs have a 30-second limit and display up to six figures.</p></details></section>`;
    this.root.querySelectorAll('[data-slot]').forEach(button=>{button.onclick=()=>this.selectSlot(+button.dataset.slot)});
    this.$('editor').oninput=()=>{this.slot.source=this.$('editor').value;this.edited()};
    this.$('name').oninput=()=>{this.slot.title=this.$('name').value||`Scenario ${this.slot.id}`;this.edited();this.paintSlots()};
    this.$('editor').onkeydown=event=>{
      if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();this.run()}
      if(event.key==='Tab'){event.preventDefault();const el=this.$('editor');el.setRangeText('    ',el.selectionStart,el.selectionEnd,'end');this.slot.source=el.value;this.edited()}
    };
    this.$('run').onclick=()=>this.run();this.$('cancel').onclick=()=>this.runner.cancel();
    this.$('reset').onclick=()=>{this.runner.cancel('Runtime reset.');if(!this.busy){this.slot.status='Runtime reset';this.paint()}};
    this.$('example').onclick=()=>{this.slot.source=DEFAULT_PYTHON;this.$('editor').value=this.slot.source;this.edited()};
    this.root.onkeydown=event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();this.saveChanges()}};
    globalThis.addEventListener?.('beforeunload',this.beforeUnload);
    this.$('saveChanges').onclick=()=>this.saveChanges();
    this.$('backup').onclick=()=>{try{this.captureEditor();download('falak_workspace.json',JSON.stringify(workspaceBackup(this.slots,this.archived,this.savedAt),null,2),'application/json');this.notice='Workspace backup downloaded';this.paintSave()}catch(error){this.saveError=error.message;this.paintSave()}};
    this.$('importWorkspace').onchange=async event=>{
      const file=event.target.files?.[0];if(!file)return;
      try{if(file.size>MAX_BACKUP_LENGTH)throw Error('Choose a workspace JSON file smaller than 5 MB.');this.importWorkspace(await file.text());}
      catch(error){this.saveError=error.message;this.paintSave()}
      event.target.value='';
    };
    this.$('save').onclick=()=>download(this.filename('py'),this.$('editor').value);
    this.$('file').onchange=async event=>{
      const file=event.target.files?.[0],slot=this.slot;if(!file)return;
      try{if(file.size>250000)throw Error('Choose a Python file smaller than 250 KB.');slot.source=await file.text();if(slot===this.slot)this.$('editor').value=slot.source;this.edited()}
      catch(error){slot.error=error.message;if(slot===this.slot)this.paint()}
      event.target.value='';
    };
    this.$('clear').onclick=()=>{this.slot.output='';this.slot.error='';this.paint()};
    for(const kind of ['json','history','users','results'])this.$(kind).onclick=()=>{try{this.exportData(kind)}catch(error){this.slot.error=error.message;this.paint()}};
    this.$('editor').value=this.slot.source;
    this.selectSlot(this.activeIndex);return this;
  }
  $(name){return this.root?.querySelector(`[data-py="${name}"]`)}
  signature(){return JSON.stringify({scenarios:this.slots.map(({title,source})=>({title,source})),archived:this.archived});}
  get dirty(){return this.signature()!==this.savedSignature;}
  captureEditor(){
    if(this.$('editor'))this.slot.source=this.$('editor').value;
    if(this.$('name'))this.slot.title=this.$('name').value||`Scenario ${this.slot.id}`;
  }
  edited(){this.notice='';this.paintSave();}
  saveChanges(){
    this.captureEditor();
    try{
      const saved=persistScenarioWorkspace(this.slots,this.archived,this.storage);
      this.savedAt=saved.saved_at;this.hasSavedCopy=true;this.savedSignature=this.signature();this.saveError='';this.notice='';this.paintSave();return true;
    }catch(error){this.saveError=error.message;this.paintSave();return false;}
  }
  importWorkspace(text){
    if(this.busy)throw Error('Wait for the current Python run before importing a workspace.');
    const imported=parseWorkspaceBackup(text);
    this.captureEditor();
    // Imported code replaces the visible slots. Retain earlier local code in the backup archive.
    const importedKeys=new Set(imported.scenarios.map(record=>JSON.stringify([record.title,record.source])));
    const previous=this.slots.map(({title,source})=>({title,source})).filter(record=>!importedKeys.has(JSON.stringify([record.title,record.source])));
    this.archived=uniqueRecords([...this.archived,...imported.archived_scenarios,...previous]);
    this.slots=imported.scenarios.map(runtimeSlot);this.activeIndex=0;this.notice='Imported workspace. Save changes to keep it here.';this.saveError='';
    if(this.$('editor'))this.$('editor').value=this.slot.source;
    if(this.$('name'))this.$('name').value=this.slot.title;
    this.selectSlot(0);this.paintSave();
  }
  paintSave(){
    const status=this.$('saveStatus');if(!status)return;
    const dirty=this.dirty;
    status.textContent=this.notice||(dirty?'Unsaved changes':this.hasSavedCopy?`Saved${this.savedAt?' · '+new Date(this.savedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):''}`:'Not saved yet');
    status.dataset.state=this.saveError?'error':dirty?'unsaved':'saved';
    this.$('saveError').textContent=this.saveError;this.$('saveError').hidden=!this.saveError;
    this.$('archiveNote').textContent=this.archived.length?`${this.archived.length} earlier scenario${this.archived.length===1?'':'s'} preserved in workspace backups.`:'';
    this.$('archiveNote').hidden=!this.archived.length;
  }
  filename(extension,kind='analysis'){return `falak_scenario_${String(this.slot.id).padStart(2,'0')}_${kind}.${extension}`}
  selectSlot(index){
    if(!Number.isInteger(index)||index<0||index>=this.slots.length)throw Error('Choose one of the four scenarios.');
    if(this.$('editor'))this.slot.source=this.$('editor').value;
    this.activeIndex=index;
    if(this.$('editor')){this.$('editor').value=this.slot.source;this.$('name').value=this.slot.title;this.$('filename').textContent=this.filename('py')}
    this.update();this.paint();this.callbacks.onSlotChange?.(index);
  }
  current(){return this.callbacks.getState?.()||this.state||{time:0,region:0,sat:0,user:1}}
  update(snapshot,state){
    if(state)this.state=state;
    const selected=this.current(),meta=this.sim.meta;
    if(this.$('context'))this.$('context').textContent=`Current selection: ${meta.regions[selected.region].name} / ${meta.satellites[selected.sat].name} / User ${selected.user} · T+${selected.time} s`;
  }
  context(){
    const current=this.current(),selection={time:current.time,region:current.region,sat:current.sat,user:current.user};
    const data=this.sim.snapshot(selection.time,selection.region,selection.sat);
    const network=this.sim.regionSnapshot?.(selection.time,selection.region)||{users:data.users,counts:data.counts};
    return clone({data,network,region_users:network.users,history:this.sim.history(selection.region,selection.sat,selection.user),selection,
      user:data.users.find(user=>user.id===selection.user),region:this.sim.meta.regions[selection.region],satellite:this.sim.meta.satellites[selection.sat],radio:this.sim.meta.radio,
      meta:{epoch:this.sim.meta.epoch,region_counts:this.sim.meta.region_counts,source_hash:this.sim.meta.source_hash,user_hash:this.sim.meta.user_hash,service_policy:this.sim.meta.service_policy,allocation_policy:this.sim.meta.allocation_policy,provenance:this.sim.meta.provenance}});
  }
  exportBundle(){
    const slot=this.slot,context=slot.context||this.context();
    return {schema:'falak.scenario.v1',scenario:{id:slot.id,title:slot.title},data_basis:slot.context?'captured_run':'current_selection',context,
      source:slot.runSource??slot.source,editor_source:slot.source,output:slot.output,error:slot.error,results:slot.results,plot_count:slot.plots.length};
  }
  exportData(kind){
    const bundle=this.exportBundle();
    if(kind==='json')return download(this.filename('json','data'),JSON.stringify(bundle,null,2),'application/json');
    const rows=kind==='users'?bundle.context.region_users:kind==='history'?bundle.context.history:bundle.results;
    const text=csvText(rows);if(!text)throw Error(kind==='results'?'Set a Python results table and run this scenario before exporting.':'No rows are available for export.');
    download(this.filename('csv',kind),text,'text/csv;charset=utf-8');
  }
  async run(){
    if(this.busy)return;
    const slot=this.slot;
    try{
      slot.source=this.$('editor')?.value??slot.source;
      const context=this.context();slot.context=context;slot.lastRun=context.selection;slot.runSource=slot.source;
      slot.output='';slot.error='';slot.plots=[];slot.results=null;this.busy=true;this.runningSlot=slot;
      slot.status=this.runner.ready?'Running Python…':'Loading Python…';this.paint();
      const result=await this.runner.run(slot.source,context);
      slot.error=[slot.error,result.error,result.results_error].filter(Boolean).join('\n');slot.plots=result.plots||[];slot.results=result.results??null;
      slot.status=slot.error?'Completed with an error':`Completed in ${(result.duration_ms/1000).toFixed(2)} s`;
    }catch(error){slot.error=error.message||String(error);slot.status='Stopped'}
    finally{this.busy=false;this.runningSlot=null;this.paint()}
  }
  event(message){
    const slot=this.runningSlot;if(!slot)return;
    if(message.type==='stream'){
      if(message.channel==='stderr')slot.error=(slot.error+message.text).slice(0,120000);
      else slot.output=(slot.output+message.text).slice(0,120000);
    }
    if(message.type==='progress'||message.type==='running')slot.status=message.text;
    this.paintSlots();
    if(slot!==this.slot)return;
    if(this.$('status'))this.$('status').textContent=slot.status;
    if(this.$('stdout'))this.$('stdout').textContent=slot.output;
    if(this.$('error')){this.$('error').textContent=slot.error;this.$('error').hidden=!slot.error}
  }
  paintSlots(){
    this.root?.querySelectorAll('[data-slot]').forEach((button,index)=>{
      const slot=this.slots[index],selected=index===this.activeIndex;
      button.classList.toggle('active',selected);button.setAttribute('aria-selected',String(selected));button.setAttribute('aria-label',`Scenario ${index+1}: ${slot.title}`);
      button.querySelector('[data-slot-title]').textContent=slot.title;
      button.querySelector('[data-slot-state]').textContent=this.runningSlot===slot?'Running…':slot.lastRun?slot.status:'Ready to run';
    });
  }
  paint(){
    this.paintSlots();this.paintSave();if(!this.$('editor'))return;
    const slot=this.slot,running=this.runningSlot===slot;
    this.$('run').disabled=this.busy;this.$('run').textContent=running?'Running…':'Run Python';this.$('cancel').disabled=!this.busy;
    this.$('status').textContent=slot.status;this.$('stdout').textContent=slot.output||(running?'':'Output appears here.');
    this.$('error').textContent=slot.error;this.$('error').hidden=!slot.error;
    this.$('resultContext').textContent=slot.lastRun?`${this.sim.meta.satellites[slot.lastRun.sat].name} · User ${slot.lastRun.user} · T+${slot.lastRun.time} s`:'';
    this.$('exportContext').textContent=slot.lastRun?`Captured at T+${slot.lastRun.time} s`:'Uses current selection until first Run';
    this.$('results').disabled=slot.results==null||running;
    for(const kind of ['json','history','users'])this.$(kind).disabled=running;
    const panel=this.$('plots');panel.replaceChildren();
    if(slot.plots.length)slot.plots.forEach((base64,index)=>{
      const figure=document.createElement('figure'),img=document.createElement('img'),link=document.createElement('a');
      img.src='data:image/png;base64,'+base64;img.alt=`Scenario ${slot.id} Python-generated figure ${index+1}`;
      link.href=img.src;link.download=`falak_scenario_${String(slot.id).padStart(2,'0')}_figure_${index+1}.png`;link.textContent='Save PNG';
      figure.append(img,link);panel.append(figure);
    });else{const empty=document.createElement('p');empty.className='py-empty';empty.textContent=running?'Waiting for Python figures…':slot.lastRun?'No figure was generated in this run.':'Run this scenario to generate a figure.';panel.append(empty)}
  }
  detach(){this.captureEditor();globalThis.removeEventListener?.('beforeunload',this.beforeUnload);if(this.root)this.root.onkeydown=null;this.root=null}
  dispose(){this.detach();this.runner.dispose()}
}
