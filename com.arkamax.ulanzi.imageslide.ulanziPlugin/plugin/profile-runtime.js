import {ACTION_UUID,PLUGIN_UUID,SlideshowService} from './slideshow.js';
import {StaticImagePlayer} from './static-image-player.js';
import {ProfileSettingsStore} from './profile-settings.js';
import {ProfileScopeResolver,instanceKey} from './profile-scope.js';
import {PreferenceBackups} from './preference-backups.js';
import {SharedGalleryClock,SharedGalleryBudget,SharedFolderWatchers,SharedWeatherRequests,SharedSystemSamples} from './profile-resources.js';
import {isActive} from './protocol-client.js';

const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
export class ProfileRuntime {
  constructor({client,configuration,timerApi=globalThis,now=Date.now,scopeResolver=new ProfileScopeResolver(),backups=new PreferenceBackups(),fetchImpl=globalThis.fetch,systemMonitor,watchFactory,serviceOptions={},displayPlayer,logger=console.log,confirmationMs=5000}={}){
    this.client=client;this.configuration=configuration;this.now=now;this.timers=timerApi;this.resolver=scopeResolver;this.backups=backups;this.options=serviceOptions;this.logger=logger;this.confirmationMs=confirmationMs;
    this.displayPlayer=displayPlayer||new StaticImagePlayer({client,timerApi});this.clock=new SharedGalleryClock(timerApi);this.budget=new SharedGalleryBudget();this.watchers=new SharedFolderWatchers(watchFactory);
    this.weather=new SharedWeatherRequests({fetchImpl,now});this.system=new SharedSystemSamples({monitor:systemMonitor,now});
    this.contexts=new Map();this.contextActivations=new Map();this.profiles=new Map();this.displayOwners=new Map();this.activationSequence=0;this.store=null;this.blocked=false;this.requested=false;this.generation=0;this.readyWaiters=new Set();this.saveQueue=Promise.resolve();this.confirmation=null;
  }
  bind(){
    const run=fn=>event=>{void Promise.resolve(fn(event)).catch(()=>this.error(event?.context,'Profile settings could not be loaded; please reopen the Inspector.'));};
    this.client.onAdd(run(event=>this.activate(event,true)));
    const active=run(event=>isActive(event.active)?this.activate(event):this.deactivate(event.context));this.client.onSetActive(active);this.client.onSetactive?.(active);
    this.client.onClear(contexts=>this.clear(contexts));this.client.onSendToPlugin(run(event=>this.fromInspector(event)));
    this.client.onDidReceiveGlobalSettings(run(event=>this.receiveSettings(event)));this.client.onClose(()=>this.close());this.client.onError(()=>this.logger('[imageslide] connection-error'));
  }
  accepted(event){try{return event?.uuid===ACTION_UUID&&this.client.decodeContext(event.context).key==='3_2';}catch{return false;}}
  error(context,message){if(context)try{this.client.sendToPropertyInspector({type:'state',settingsReady:!this.blocked,status:{level:'error',message,count:0}},context);}catch{}}
  waitReady(){
    if(this.store)return Promise.resolve();
    return new Promise((resolve,reject)=>{const waiter={resolve:()=>{this.timers.clearTimeout(waiter.timer);this.readyWaiters.delete(waiter);resolve();},reject:()=>{this.timers.clearTimeout(waiter.timer);this.readyWaiters.delete(waiter);reject(new Error('Saved settings are unavailable; nothing was changed.'));}};waiter.timer=this.timers.setTimeout(waiter.reject,this.confirmationMs);this.readyWaiters.add(waiter);});
  }
  async receiveSettings(event){
    if(event?.uuid&&String(event.uuid).split('.').slice(0,4).join('.')!==PLUGIN_UUID)return;
    let incoming;try{incoming=new ProfileSettingsStore(event?.settings,this.configuration.defaults);}catch(error){this.blocked=true;this.confirmation?.reject();for(const context of this.contexts.keys())this.error(context,error.message);for(const waiter of [...this.readyWaiters])waiter.reject();return;}
    if(this.confirmation&&incoming.revision===this.confirmation.revision&&canonical(incoming.serialize())===canonical(this.confirmation.snapshot)){this.confirmation.resolve();return;}
    if(this.store&&incoming.revision<this.store.revision)return;
    // A legacy/unsupported writer must not silently erase the profile registry.
    if(this.store?.profiles.size&&!incoming.base.profileSettingsSchema){this.blocked=true;for(const context of this.contexts.keys())this.error(context,'Shared settings replaced the profile registry. Restore the private preferences backup before saving.');return;}
    this.blocked=false;this.store=incoming;for(const waiter of [...this.readyWaiters])waiter.resolve();
    for(const controller of this.profiles.values())if(!controller.initializing){await controller.service.applySettings(this.store.get(controller.scope.key),true);if(!controller.service.activeContexts.size)controller.service.releaseMedia();}
  }
  persist(key,settings,context){
    const operation=async()=>{
      const entry=this.contexts.get(context),generation=this.generation;if(this.blocked)throw new Error('Saved profile settings are incompatible; nothing was changed.');if(!this.store||!entry||entry.cancelled)throw new Error('Display changed; settings were not saved.');
      const before=this.store.serialize(),candidate=this.store.save(key,settings);
      try{
        await this.backups.write(this.store.base.profileSettingsSchema?before:this.store.base,candidate);
        if(generation!==this.generation||entry.cancelled||!this.store)throw new Error('Display changed; settings were not saved.');
        await new Promise((resolve,reject)=>{
          const confirmation={snapshot:candidate,revision:candidate.profileSettingsRevision,resolve:()=>{this.timers.clearTimeout(confirmation.timer);if(this.confirmation===confirmation)this.confirmation=null;resolve();},reject:()=>{this.timers.clearTimeout(confirmation.timer);if(this.confirmation===confirmation)this.confirmation=null;reject(new Error('Could not verify saved profile settings; please refresh the Inspector.'));}};
          confirmation.timer=this.timers.setTimeout(confirmation.reject,this.confirmationMs);this.confirmation=confirmation;
          if(this.client.setGlobalSettings(candidate,context)===false||this.client.getGlobalSettings(context)===false)confirmation.reject();
        });
      }catch(error){if(this.store&&generation===this.generation&&this.store.revision===candidate.profileSettingsRevision)this.store=new ProfileSettingsStore(before,this.configuration.defaults);throw error;}
    };
    const result=this.saveQueue.then(operation);this.saveQueue=result.catch(()=>{});return result;
  }
  async ensure(event,active=false){
    if(!this.accepted(event))return null;
    let entry=this.contexts.get(event.context);if(entry){if(active)entry.active=true;return entry.promise;}
    entry={active,cancelled:false,controller:null};this.contexts.set(event.context,entry);const generation=this.generation;
    if(!this.requested){this.requested=true;this.client.getGlobalSettings(event.context);}
    try{this.client.sendToPropertyInspector({type:'state',status:{level:'ready',message:'Loading settings for this profile…',count:0}},event.context);}catch{}
    entry.promise=(async()=>{
      const [scope]=await Promise.all([this.resolver.resolve(event.context),this.waitReady()]);
      if(entry.cancelled||generation!==this.generation)return null;
      if(scope.ambiguous)throw new Error('The display identity matches several profiles. Independent settings were not saved; use a uniquely identified display action.');
      let controller=this.profiles.get(scope.key);
      if(!controller){
        const facade={decodeContext:context=>this.client.decodeContext(context),setBaseDataIcon:(...args)=>this.client.setBaseDataIcon(...args),getGlobalSettings:()=>true,setGlobalSettings:(settings,context)=>this.persist(scope.key,settings,context),sendToPropertyInspector:(payload,context)=>this.client.sendToPropertyInspector({...payload,profile:{label:scope.label,warning:scope.warning,independent:true}},context)};
        const service=new SlideshowService({client:facade,configuration:this.configuration,...this.options,timerApi:this.clock,now:this.now,fetchImpl:(...args)=>this.weather.request(...args),systemMonitor:this.system,watchFactory:(...args)=>this.watchers.watch(...args),displayPlayer:this.displayPlayer,galleryBudget:{select:slides=>this.budget.select(scope.key,slides),release:()=>this.budget.release(scope.key)},logger:this.logger});
        controller={scope,service,initializing:true};this.profiles.set(scope.key,controller);
        service.contexts.set(event.context,{active:false});service.inspectors.add(event.context);entry.controller=controller;
        controller.promise=(async()=>{
          // If read-only profile binding becomes available after fallback, retain
          // the exact same display's earlier preferences without overwriting a profile.
          const fallback=instanceKey(event.context);const seed=!this.store.has(scope.key)&&this.store.has(fallback)?this.store.get(fallback):this.store.get(scope.key);
          if(!this.store.has(scope.key))await this.persist(scope.key,seed,event.context);
          await service.applySettings(this.store.get(scope.key),false);
        })().catch(error=>{if(this.profiles.get(scope.key)===controller){service.close();this.profiles.delete(scope.key);}throw error;}).finally(()=>{controller.initializing=false;});
      }
      entry.controller=controller;await controller.promise;
      if(entry.cancelled||generation!==this.generation)return null;
      controller.service.contexts.set(event.context,{active:false});controller.service.inspectors.add(event.context);
      return controller;
    })().catch(error=>{this.error(event.context,error.message);if(this.contexts.get(event.context)===entry)this.contexts.delete(event.context);if(!this.store&&!this.readyWaiters.size)this.requested=false;throw error;});
    return entry.promise;
  }
  async activate(event,added=false){
    if(!this.accepted(event))return;
    if(added&&(event.active!==undefined||event.param?.active!==undefined)&&!isActive(event.active??event.param.active)){await this.ensure(event,false);return;}
    const sequence=++this.activationSequence;this.contextActivations.set(event.context,sequence);
    const previous=this.contexts.get(event?.context),generation=this.generation;
    if(previous&&!previous.active&&previous.controller){const scope=await this.resolver.resolve(event.context);if(generation!==this.generation||this.contextActivations.get(event.context)!==sequence)return;if(scope.key!==previous.controller.scope.key||scope.ambiguous){this.clear([event.context]);this.contextActivations.set(event.context,sequence);}else Object.assign(previous.controller.scope,scope);}
    const controller=await this.ensure(event,true),entry=this.contexts.get(event.context);if(!controller||!entry||entry.cancelled||!entry.active||this.contextActivations.get(event.context)!==sequence)return;
    // Contexts include ActionID, but every page/profile on the same D200 shares
    // physical slot 3_2. Only its current owner may run a gallery/frame pump.
    if(added&&controller.scope.selected===false){this.deactivate(event.context);return;}
    const target=controller.scope.deviceKey||'unresolved-d200:3_2',owner=this.displayOwners.get(target);
    if(owner?.sequence>sequence){this.deactivate(event.context);return;}
    for(const [otherTarget,otherOwner] of this.displayOwners)if(otherTarget!==target&&(target==='unresolved-d200:3_2'||otherTarget==='unresolved-d200:3_2')){
      if(otherOwner.sequence>sequence){this.deactivate(event.context);return;}
      this.deactivate(otherOwner.context);
    }
    if(owner&&owner.context!==event.context)this.deactivate(owner.context);
    this.displayOwners.set(target,{context:event.context,sequence});
    const service=controller.service,wasActive=service.activeContexts.has(event.context);
    if(!wasActive){service.add(event);await service.rescan(true);if(entry.active&&!entry.cancelled)service.nextSlideAt=this.now()+(service.settings.showImages?service.settings.intervalSeconds*1000:service.informationDurationMs());}
  }
  deactivate(context){const entry=this.contexts.get(context);if(!entry)return;entry.active=false;for(const [target,owner] of this.displayOwners)if(owner.context===context)this.displayOwners.delete(target);const service=entry.controller?.service;if(service)service.setActive({uuid:ACTION_UUID,context,active:false});}
  clear(contexts){for(const context of contexts||[]){this.contextActivations.delete(context);const entry=this.contexts.get(context);if(!entry)continue;this.deactivate(context);entry.cancelled=true;entry.controller?.service.clear([context]);this.contexts.delete(context);}}
  async fromInspector(event){
    if(!this.accepted(event))return;if(this.blocked){this.error(event.context,'Saved profile settings are incompatible; restore the private backup before saving.');if(event.payload?.type==='requestState')this.client.getGlobalSettings(event.context);return;}
    const controller=await this.ensure(event,false);if(!controller)return;
    if(event.payload?.type==='refreshWeather')this.weather.cache.clear();
    await controller.service.fromInspector(event);if(!controller.service.activeContexts.size)controller.service.releaseMedia();
  }
  close(){
    this.generation++;for(const entry of this.contexts.values())entry.cancelled=true;for(const waiter of [...this.readyWaiters])waiter.reject();this.confirmation?.reject();
    for(const controller of this.profiles.values())controller.service.close();this.displayPlayer.close();this.clock.close();this.watchers.close();this.contexts.clear();this.contextActivations.clear();this.profiles.clear();this.displayOwners.clear();this.store=null;this.blocked=false;this.requested=false;
  }
}
