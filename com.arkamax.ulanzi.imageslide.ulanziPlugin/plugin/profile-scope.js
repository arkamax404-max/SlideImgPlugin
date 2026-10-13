import {createHash} from 'node:crypto';
import {lstat,readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {ACTION_UUID} from './slideshow.js';

export const profileKey=group=>`profile:${createHash('sha256').update(`imageslide-profile-v1\0${group}`).digest('hex')}`;
export const instanceKey=context=>`instance:${createHash('sha256').update(context).digest('hex')}`;
const safe=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)&&value!=='.'&&value!=='..';
export class ProfileScopeResolver {
  constructor({dataRoot=process.platform==='win32'?(process.env.APPDATA?join(process.env.APPDATA,'Ulanzi','UlanziDeck'):null):process.platform==='darwin'?join(homedir(),'Library','Application Support','Ulanzi','UlanziDeck'):null,fsApi={lstat,readdir,readFile}}={}){this.root=dataRoot;this.fs=fsApi;}
  async json(path,budget){const stat=await this.fs.lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw new Error('Unsupported profile metadata');if(budget){budget.files++;budget.bytes+=stat.size;if(budget.files>2048||budget.bytes>8*1024*1024||Date.now()>budget.until){budget.failed=true;throw new Error('Profile metadata budget exceeded');}}return JSON.parse((await this.fs.readFile(path,'utf8')).replace(/^\uFEFF/,''));}
  async directory(path,budget){if(budget&&Date.now()>budget.until){budget.failed=true;throw new Error('Profile metadata budget exceeded');}const stat=await this.fs.lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Unsupported profile store');return this.fs.readdir(path,{withFileTypes:true});}
  async resolve(context){
    const fallback={key:instanceKey(context),label:'this display',warning:'Profile could not be identified. Settings remain separate for this display; other pages may need separate configuration.'};
    const [uuid,key,actionid]=String(context).split('___');if(uuid!==ACTION_UUID||key!=='3_2'||!actionid)return fallback;
    if(!this.root)return fallback;
    const budget={files:0,bytes:0,until:Date.now()+5000};
    try{
      // Runtime contexts do not document a profile field. Resolve the exact
      // ActionID in read-only saved D200 profiles, including their other pages.
      // V2 wins over stale V1 copies, as it does in the original helper.
      for(const store of ['ProfilesV2','ProfilesV1']){
        let groups;try{groups=await this.directory(join(this.root,store),budget);}catch{if(budget.failed)return fallback;continue;}
        if(groups.length>256)return fallback;const matches=new Map();
        let selected;try{selected=await this.json(join(this.root,'Config','setting_source.json'),budget);}catch{if(budget.failed)return fallback;}
        for(const group of groups){
          if(!group.isDirectory()||group.isSymbolicLink()||!safe(group.name))continue;
          const base=join(this.root,store,group.name);let profile;try{profile=await this.json(join(base,'manifest.json'),budget);}catch{if(budget.failed)return fallback;continue;}
          if(profile?.Device?.Model!=='D200')continue;
          const pages=profile.Pages?.Pages;if(!Array.isArray(pages)||pages.length>512)continue;
          try{await this.directory(join(base,'Profiles'),budget);}catch{if(budget.failed)return fallback;continue;}
          for(const page of pages){
            if(!safe(page))continue;let document;try{await this.directory(join(base,'Profiles',page),budget);document=await this.json(join(base,'Profiles',page,'manifest.json'),budget);}catch{if(budget.failed)return fallback;continue;}
            const entries=(document.Controllers||[]).filter(c=>c?.Type==='Keypad').map(c=>c.Actions?.['3_2']);
            if(entries.some(entry=>entry?.Action===ACTION_UUID&&entry.ActionID===actionid))matches.set(group.name,{key:profileKey(group.name),label:typeof profile.Name==='string'?profile.Name.slice(0,200):'this profile',warning:'',deviceKey:typeof profile.Device.UUID==='string'?profileKey(`device\0${profile.Device.UUID.toLowerCase()}`):undefined,selected:Array.isArray(selected?.Devices)?selected.Devices.some(device=>device.CurrentDevice===profile.Device.UUID&&device.CurrentProfile===profile.Name)&&profile.Pages.Current===page:undefined});
          }
        }
        if(matches.size===1)return [...matches.values()][0];if(matches.size>1)return {...fallback,ambiguous:true};
      }
    }catch{}
    return fallback;
  }
}
