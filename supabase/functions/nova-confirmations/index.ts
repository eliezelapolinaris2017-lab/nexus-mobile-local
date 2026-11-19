const origin="https://eliezelapolinaris2017-lab.github.io";
const cors={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"content-type","Content-Type":"application/json","Cache-Control":"no-store"};
const out=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:cors});
const hex=(v:unknown)=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const uuid=(v:unknown)=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
async function hash(s:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,"0")).join("");}
async function rest(table:string,query:string,method="GET",body?:unknown){const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!key)throw Error("Backend not configured");const r=await fetch(Deno.env.get("SUPABASE_URL")+"/rest/v1/"+table+"?"+query,{method,headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",Prefer:"return=representation"},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw Error("Database operation failed");return await r.json();}
const table="nova_confirmation_invites",owners="nova_confirmation_owners";
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{headers:cors});if(req.method!=="POST")return out({error:"Método inválido"},405);
 if(req.headers.get("origin")!==origin)return out({error:"Origen no autorizado"},403);
 try{const raw=await req.text();if(raw.length>16000)return out({error:"Solicitud demasiado grande"},413);const b=JSON.parse(raw);const now=new Date().toISOString();
 if(b.action==="confirm"){if(!hex(b.token))return out({error:"Enlace inválido"},400);const token=await hash(b.token);const filter="token_hash=eq."+token+"&revoked=eq.false&expires_at=gt."+encodeURIComponent(now);const updated=await rest(table,filter+"&confirmed_at=is.null","PATCH",{confirmed_at:now});if(updated.length)return out({state:"confirmed"});const existing=await rest(table,filter+"&select=confirmed_at");if(existing[0]?.confirmed_at)return out({state:"confirmed"});return out({error:"Enlace vencido, cancelado o inválido. Comunícate con tu proveedor."},410);}
 if(!hex(b.ownerKey))return out({error:"Conexión no autorizada"},401);const owner=await hash(b.ownerKey),auth=await rest(owners,"key_hash=eq."+owner+"&active=eq.true&select=key_hash");if(!auth.length)return out({error:"Conexión no autorizada"},401);
 const scope="owner_hash=eq."+owner;
 if(b.action==="ping")return out({ok:true});
 if(b.action==="create"){if(!uuid(b.id)||!hex(b.token)||typeof b.expires!=="string")return out({error:"Solicitud inválida"},400);const expiration=Date.parse(b.expires);if(!Number.isFinite(expiration)||expiration<=Date.now()||expiration>Date.now()+366*86400000)return out({error:"Fecha de cita no disponible"},400);await rest(table,"","POST",{id:b.id,owner_hash:owner,token_hash:await hash(b.token),expires_at:new Date(expiration).toISOString()});return out({ok:true});}
 if(b.action==="revoke"){if(!uuid(b.id))return out({error:"Solicitud inválida"},400);await rest(table,scope+"&id=eq."+b.id,"PATCH",{revoked:true});return out({ok:true});}
 if(b.action==="status"){if(!Array.isArray(b.ids)||b.ids.length>50||!b.ids.every(uuid))return out({error:"Solicitud inválida"},400);if(!b.ids.length)return out({items:[]});const rows=await rest(table,scope+"&id=in.("+b.ids.join(",")+")&select=id,expires_at,confirmed_at,revoked");return out({items:rows.map((r:any)=>({id:r.id,state:r.revoked?"revoked":r.confirmed_at?"confirmed":Date.parse(r.expires_at)<=Date.now()?"expired":"pending",confirmedAt:r.confirmed_at}))});}
 return out({error:"Acción inválida"},400);
 }catch{return out({error:"No se pudo procesar la solicitud"},500);}
});