(function(root){
 'use strict';
 const enc=new TextEncoder(),dec=new TextDecoder();
 const b64=bytes=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)};
 const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
 async function key(password,salt){const material=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:600000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
 async function seal(data,password){const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(password,salt),enc.encode(JSON.stringify(data)));return {v:1,kdf:'PBKDF2-SHA256',iterations:600000,cipher:'AES-256-GCM',salt:b64(salt),iv:b64(iv),ciphertext:b64(new Uint8Array(ciphertext))};}
 async function open(envelope,password){if(!envelope||typeof envelope!=='object'||envelope.v!==1||envelope.iterations!==600000||envelope.kdf!=='PBKDF2-SHA256'||envelope.cipher!=='AES-256-GCM')throw Error('Unsupported encrypted Pair Lite data');for(const k of ['salt','iv','ciphertext'])if(typeof envelope[k]!=='string'||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(envelope[k]))throw Error('Malformed encrypted data');if(bytes(envelope.salt).length!==16||bytes(envelope.iv).length!==12||bytes(envelope.ciphertext).length<16||envelope.ciphertext.length>40000000)throw Error('Invalid encrypted data size');return JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(envelope.iv)},await key(password,bytes(envelope.salt)),bytes(envelope.ciphertext))));}
 root.PairLiteCrypto={seal,open};
})(globalThis);
