import {diffDocuments,applyOperations} from './collab-model.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const id=()=>globalThis.crypto?.randomUUID?.()||'mutation-'+Date.now()+'-'+Math.random().toString(36).slice(2);

// Shared-state edits are acknowledged independently from the HTTP response:
// an SSE acknowledgement may arrive first, while another edit is still queued.
export class CollaborationState{
  constructor(snapshot){this.pending=[];this.undoStack=[];this.redoStack=[];this.conflicts=[];this.draft=null;this.base=null;this.retiredEpochs=new Set();if(snapshot)this.reset(snapshot);}
  reset(snapshot){this.base={document:clone(snapshot.document),revision:snapshot.revision,epoch:snapshot.epoch,seq:Number(snapshot.seq)||0};this.retiredEpochs.clear();this.pending=[];this.undoStack=[];this.redoStack=[];this.conflicts=[];this.draft=null;return this.view();}
  view(){
    if(this.conflicts.length&&this.draft)return clone(this.draft);
    let document=clone(this.base.document);
    for(const action of this.pending){const result=applyOperations(document,action.ops);if(result.conflicts.length){this.conflicts=result.conflicts;this.draft=this.draft||document;return clone(this.draft);}document=result.document;}
    return document;
  }
  changed(before,after,reason='edit'){
    const ops=diffDocuments(before,after);if(!ops.length)return null;
    const action={mutationId:id(),ops,reason,inverse:diffDocuments(after,before)};
    this.pending.push(action);this.undoStack.push(action);this.redoStack=[];this.draft=clone(after);this.view();return action;
  }
  queue(ops,reason){const action={mutationId:id(),ops:clone(ops),reason};this.pending.push(action);return action;}
  acknowledge(snapshot,mutationId,{acceptEpoch=false}={}){
    const epoch=snapshot.epoch??this.base?.epoch,epochChanged=Boolean(this.base&&epoch!==this.base.epoch);
    // Only an explicit resynchronization may adopt a new server lifetime.
    // Delayed HTTP responses or old SSE streams must never switch it back.
    if(epochChanged&&(!acceptEpoch||this.retiredEpochs.has(epoch)))return this.view();
    if(epochChanged&&this.base.epoch!==undefined)this.retiredEpochs.add(this.base.epoch);
    const ids=new Set([mutationId,...(Array.isArray(snapshot.acknowledgedMutationIds)?snapshot.acknowledgedMutationIds:[])]);
    const acknowledged=this.pending.some(action=>ids.has(action.mutationId)),draft=this.draft;
    this.pending=this.pending.filter(action=>!ids.has(action.mutationId));
    if(!this.base||epochChanged||Number(snapshot.seq)>=this.base.seq)this.base={document:clone(snapshot.document),revision:snapshot.revision,epoch,seq:Number(snapshot.seq)||0};
    // A reconnect can first expose a conflict against a snapshot containing
    // our accepted edit plus a later peer edit. A delayed acknowledgement then
    // proves our pending action is already complete: rebase only what remains.
    if(acknowledged||epochChanged){this.conflicts=[];this.draft=null;const view=this.view();if(this.conflicts.length)this.draft=clone(draft||view);else this.draft=this.pending.length?clone(view):null;return this.view();}
    if(!this.conflicts.length){const view=this.view();this.draft=this.pending.length?clone(view):null;}
    return this.view();
  }
  snapshot(snapshot){
    return this.acknowledge(snapshot,undefined,{acceptEpoch:true});
  }
  event(event){
    if(event.epoch!==undefined&&event.epoch!==this.base.epoch)return this.retiredEpochs.has(event.epoch)?{document:this.view()}:{needsResync:true};
    if(event.seq<=this.base.seq){return {document:event.mutationId?this.acknowledge(this.base,event.mutationId):this.view()};}
    if(event.baseRevision!==this.base.revision)return {needsResync:true};
    const result=applyOperations(this.base.document,event.ops);
    if(result.conflicts.length)return {needsResync:true};
    return {document:this.acknowledge({document:result.document,revision:event.revision,epoch:event.epoch,seq:event.seq},event.mutationId)};
  }
  reject(error,draft){
    if(error.current?.epoch!==undefined&&error.current.epoch!==this.base.epoch)return this.view();
    if(error.current&&Number(error.current.seq)>=this.base.seq)this.base={document:clone(error.current.document),revision:error.current.revision,epoch:error.current.epoch??this.base.epoch,seq:Number(error.current.seq)||0};
    this.conflicts=error.conflicts?.length?clone(error.conflicts):[{reason:'concurrent-edit'}];this.draft=clone(draft||this.draft||this.view());
  }
}
