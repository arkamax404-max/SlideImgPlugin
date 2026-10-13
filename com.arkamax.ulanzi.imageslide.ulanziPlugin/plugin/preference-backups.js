import {createHash,randomUUID} from 'node:crypto';
import {mkdir,lstat,writeFile,readFile,rename,rm} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';
import {homedir} from 'node:os';
import {PLUGIN_UUID} from './slideshow.js';
const SCHEMA=`${PLUGIN_UUID}.preference-backup/v1`;
const digest=text=>createHash('sha256').update(text).digest('hex');
export class PreferenceBackups {
  constructor({root=process.platform==='win32'?(process.env.LOCALAPPDATA?join(process.env.LOCALAPPDATA,'Ulanzi','PluginPreferences','com.arkamax.ulanzi.imageslide','profile-v1'):null):process.platform==='darwin'?join(homedir(),'Library','Application Support','Ulanzi','PluginPreferences','com.arkamax.ulanzi.imageslide','profile-v1'):null}={}){this.root=root;}
  async write(before,after){
    if(!this.root)throw new Error('Profile preference backup location is unavailable; settings were not saved.');
    try{
      await mkdir(this.root,{recursive:true,mode:0o700});const directory=await lstat(this.root);if(!directory.isDirectory()||directory.isSymbolicLink())throw new Error('Unsafe preference backup directory');
      const initial=join(this.root,'before-profile-preferences.json');
      try{await this.read(initial);}catch(error){if(error.code!=='ENOENT')throw error;await writeFile(initial,this.encode(before),{encoding:'utf8',flag:'wx',mode:0o600});await this.read(initial);}
      const latest=join(this.root,'latest-profile-preferences.json');try{const stat=await lstat(latest);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Unsafe preference backup file');}catch(error){if(error.code!=='ENOENT')throw error;}
      const temp=join(this.root,`.preferences-${randomUUID()}.tmp`);if(relative(resolve(this.root),resolve(temp)).startsWith('..'))throw new Error('Unsafe preference backup path');
      try{await writeFile(temp,this.encode(after),{encoding:'utf8',flag:'wx',mode:0o600});await this.read(temp);await rename(temp,latest);await this.read(latest);}finally{await rm(temp,{force:true});}
    }catch{throw new Error('Could not verify the private profile preference backup; settings were not saved.');}
  }
  encode(settings){const payload=JSON.stringify(settings);return JSON.stringify({schema:SCHEMA,sha256:digest(payload),payload})+'\n';}
  async read(path){const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2*1024*1024)throw new Error('Invalid preference backup');const value=JSON.parse(await readFile(path,'utf8'));if(value.schema!==SCHEMA||typeof value.payload!=='string'||digest(value.payload)!==value.sha256)throw new Error('Invalid preference backup');return JSON.parse(value.payload);}
}
