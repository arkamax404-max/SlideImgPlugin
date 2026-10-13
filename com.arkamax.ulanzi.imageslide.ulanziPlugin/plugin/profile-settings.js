import {normalizeSettings,PLUGIN_UUID} from './slideshow.js';
export const PROFILE_SETTINGS_SCHEMA=`${PLUGIN_UUID}.profile-preferences/v1`;
const KEY=/^(profile|instance):[0-9a-f]{64}$/;
const clone=value=>JSON.parse(JSON.stringify(value));

// Keep the original flat settings at the top level for 0.9.0 rollback. New saves
// touch only their profile leaf; no per-action parameters or Setup receipts change.
export class ProfileSettingsStore {
  constructor(value,defaults){
    if(value!==undefined&&value!==null&&(typeof value!=='object'||Array.isArray(value)))throw new Error('Saved preferences are invalid; nothing was changed.');
    const raw=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
    if(raw.profileSettings!==undefined&&raw.profileSettingsSchema===undefined)throw new Error('Saved profile settings are missing their format marker; nothing was changed.');
    if(raw.profileSettingsSchema!==undefined&&raw.profileSettingsSchema!==PROFILE_SETTINGS_SCHEMA)throw new Error('Saved profile settings use an unsupported format; nothing was changed.');
    this.legacy=normalizeSettings(raw,defaults);this.base=clone(raw);this.profiles=new Map();this.revision=raw.profileSettingsRevision??0;
    if(!Number.isSafeInteger(this.revision)||this.revision<0)throw new Error('Saved profile revision is invalid; nothing was changed.');
    if(raw.profileSettingsSchema){
      if(!raw.profileSettings||typeof raw.profileSettings!=='object'||Array.isArray(raw.profileSettings)||Object.keys(raw.profileSettings).length>256)throw new Error('Saved profile settings are invalid; nothing was changed.');
      for(const [key,settings] of Object.entries(raw.profileSettings)){if(!KEY.test(key))throw new Error('Saved profile identity is invalid; nothing was changed.');this.profiles.set(key,normalizeSettings(settings,this.legacy));}
    }
  }
  get(key){if(!KEY.test(key))throw new Error('Invalid profile identity');return clone(this.profiles.get(key)||this.legacy);}
  has(key){return this.profiles.has(key);}
  save(key,value){
    if(!KEY.test(key))throw new Error('Invalid profile identity');
    if(!this.profiles.has(key)&&this.profiles.size>=256)throw new Error('Profile settings limit reached; existing preferences were preserved.');
    const previous=this.profiles.get(key);this.profiles.set(key,normalizeSettings(value,this.legacy));this.revision++;
    const snapshot=this.serialize();if(Buffer.byteLength(JSON.stringify(snapshot))>1024*1024){if(previous)this.profiles.set(key,previous);else this.profiles.delete(key);this.revision--;throw new Error('Profile preferences exceed their memory budget; existing preferences were preserved.');}return snapshot;
  }
  serialize(){return {...clone(this.base),...clone(this.legacy),profileSettingsSchema:PROFILE_SETTINGS_SCHEMA,profileSettingsRevision:this.revision,profileSettings:Object.fromEntries([...this.profiles].map(([key,value])=>[key,clone(value)]))};}
}
