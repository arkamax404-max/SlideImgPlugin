// Small shared display adapter; profile settings do not add animation/GIF support.
export class StaticImagePlayer {
  constructor({client,now=Date.now}={}){this.client=client;this.now=now;this.contexts=new Map();}
  display(context,media,_unused,force=false){const previous=this.contexts.get(context);if(!force&&previous?.signature===media.signature)return;this.client.setBaseDataIcon(context,media.dataUri,'');this.contexts.set(context,{media,signature:media.signature,start:this.now()});}
  preload(media){return Promise.resolve(media);}
  remove(context){this.contexts.delete(context);}
  close(){this.contexts.clear();}
}
