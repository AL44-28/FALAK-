import {PythonWorkspace} from './python-workspace.js';
const resolve=value=>typeof value==='string'?document.getElementById(value.replace(/^#/,'')):value;

/** Four independent research slots share one lazy browser Python runtime. */
export class Scenarios {
  constructor({tabs,content},simulation,callbacks={}){
    this.tabs=resolve(tabs);this.content=resolve(content);this.sim=simulation;this.callbacks=callbacks;
    this.state={time:0,region:0,sat:0,user:1,...callbacks.getState?.()};
    this.python=new PythonWorkspace(simulation,{getState:()=>({...this.state,...callbacks.getState?.()})});
  }
  async init(){
    this.tabs.replaceChildren();this.tabs.hidden=true;
    this.content.classList.add('scenario-workspace');this.python.mount(this.content);return this;
  }
  update(snapshot,network,state){this.state={...state};this.python.update(snapshot,state)}
  resize(){}
  dispose(){this.python.dispose()}
}
