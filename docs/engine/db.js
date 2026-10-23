export const DB='pair-lite-market-v1';
let opening;export function database(){return opening??=new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
export async function get(key){const db=await database();return new Promise((resolve,reject)=>{const r=db.transaction('kv').objectStore('kv').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
export async function put(key,value){const db=await database();return new Promise((resolve,reject)=>{const t=db.transaction('kv','readwrite');t.objectStore('kv').put(value,key);t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error)})}
