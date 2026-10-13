import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProfileSettingsStore,PROFILE_SETTINGS_SCHEMA} from '../plugin/profile-settings.js';
import {ProfileScopeResolver,profileKey,instanceKey} from '../plugin/profile-scope.js';
import {PreferenceBackups} from '../plugin/preference-backups.js';
import {ACTION_UUID,normalizeSettings} from '../plugin/slideshow.js';

test('legacy shared preferences seed independent profiles and stay intact for rollback',()=>{
  const legacy=normalizeSettings({folderPath:'C:/shared',gifBackend:'frames',dateTimeOnly:true,weatherApiKey:' secret ',dateFormat:'dmy'}),store=new ProfileSettingsStore(legacy,normalizeSettings({}));
  const a=profileKey('a'),b=profileKey('b');assert.deepEqual(store.get(a),legacy);store.save(a,{...store.get(a),folderPath:'C:/A',intervalSeconds:17,showImages:true,showWeather:true,weatherLocation:'Town A'});
  assert.deepEqual(store.get(b),legacy);store.save(b,{...store.get(b),folderPath:'C:/B',dateFormat:'mdy',showSystemStats:true});
  const snapshot=store.serialize(),restored=new ProfileSettingsStore(JSON.parse(JSON.stringify(snapshot)),normalizeSettings({}));
  assert.equal(snapshot.folderPath,'C:/shared');assert.equal(snapshot.weatherApiKey,'secret');assert.equal(snapshot.profileSettingsSchema,PROFILE_SETTINGS_SCHEMA);
  assert.equal(restored.get(a).folderPath,'C:/A');assert.equal(restored.get(a).intervalSeconds,17);assert.equal(restored.get(b).folderPath,'C:/B');assert.equal(restored.get(b).dateFormat,'mdy');assert.equal(restored.get(a).showSystemStats,false);
  const copy=restored.get(a);copy.folderPath='wrong';assert.equal(restored.get(a).folderPath,'C:/A');
  assert.throws(()=>new ProfileSettingsStore({...snapshot,profileSettingsSchema:'unknown'},normalizeSettings({})),/unsupported/);
  assert.throws(()=>new ProfileSettingsStore([],normalizeSettings({})),/invalid/);assert.throws(()=>new ProfileSettingsStore({profileSettings:{}},normalizeSettings({})),/format marker/);
  assert.throws(()=>new ProfileSettingsStore({...snapshot,profileSettings:{__bad:{}}},normalizeSettings({})),/identity/);
});

async function scopeFixture(){
  const root=await mkdtemp(join(tmpdir(),'profile-scope-'));
  await mkdir(join(root,'Config'),{recursive:true});await writeFile(join(root,'Config','setting_source.json'),JSON.stringify({Devices:[{CurrentProfile:'Profile A',CurrentDevice:'device-a'},{CurrentProfile:'Profile B',CurrentDevice:'device-b'}]}));
  for(const [group,name,device,pages] of [['group-a','Profile A','device-a',['a1','a2']],['group-b','Profile B','device-b',['b1']]]){
    const base=join(root,'ProfilesV2',group);await mkdir(base,{recursive:true});await writeFile(join(base,'manifest.json'),JSON.stringify({Name:name,Device:{Model:'D200',UUID:device},Pages:{Current:pages[0],Pages:pages}}));
    for(const page of pages){await mkdir(join(base,'Profiles',page),{recursive:true});await writeFile(join(base,'Profiles',page,'manifest.json'),JSON.stringify({Controllers:[{Type:'Keypad',Actions:{'3_2':{Action:ACTION_UUID,ActionID:page,ActionParam:{SmallViewMode:2}}}}]}));}
  }
  return root;
}
test('read-only scope binding shares pages within a profile and separates different profiles; missing/ambiguous identity stays isolated',async()=>{
  const root=await scopeFixture();
  try{
    const resolver=new ProfileScopeResolver({dataRoot:root}),a1=`${ACTION_UUID}___3_2___a1`,a2=`${ACTION_UUID}___3_2___a2`,b=`${ACTION_UUID}___3_2___b1`;
    assert.equal((await resolver.resolve(a1)).key,profileKey('group-a'));assert.equal((await resolver.resolve(a2)).key,profileKey('group-a'));assert.equal((await resolver.resolve(b)).key,profileKey('group-b'));
    assert.equal((await resolver.resolve(a1)).deviceKey,(await resolver.resolve(a2)).deviceKey);assert.notEqual((await resolver.resolve(a1)).deviceKey,(await resolver.resolve(b)).deviceKey);
    assert.equal((await resolver.resolve(a1)).selected,true);assert.equal((await resolver.resolve(a2)).selected,false);
    assert.equal((await resolver.resolve(`${ACTION_UUID}___3_2___missing`)).key,instanceKey(`${ACTION_UUID}___3_2___missing`));
    const page=join(root,'ProfilesV2','group-b','Profiles','b1','manifest.json'),before=await readFile(page,'utf8'),doc=JSON.parse(before);doc.Controllers[0].Actions['3_2'].ActionID='a1';await writeFile(page,JSON.stringify(doc));
    const ambiguous=await resolver.resolve(a1);assert.equal(ambiguous.key,instanceKey(a1));assert.match(ambiguous.warning,/separate/);
    const same=await readFile(page,'utf8');await resolver.resolve(a1);assert.equal(await readFile(page,'utf8'),same);
  }finally{await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

test('preference backups preserve the initial snapshot, verify latest readback and reject tampering without leaking private values',async()=>{
  const root=await mkdtemp(join(tmpdir(),'prefs-backup-'));
  try{
    const backups=new PreferenceBackups({root:join(root,'private')}),initial={folderPath:'private-folder',weatherApiKey:'secret'},latest={...initial,profileSettings:{one:{folderPath:'different'}}};
    await backups.write(initial,latest);await backups.write({folderPath:'later'},latest);
    assert.deepEqual(await backups.read(join(root,'private','before-profile-preferences.json')),initial);assert.deepEqual(await backups.read(join(root,'private','latest-profile-preferences.json')),latest);
    await writeFile(join(root,'private','before-profile-preferences.json'),'{}');await assert.rejects(backups.write(initial,latest),error=>/backup/.test(error.message)&&!error.message.includes('secret')&&!error.message.includes(root));
  }finally{await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
