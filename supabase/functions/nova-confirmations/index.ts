const origin="https://eliezelapolinaris2017-lab.github.io";
const cors={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"content-type,authorization,apikey","Content-Type":"application/json","Cache-Control":"no-store"};
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
 let owner:string;
 const authorization=req.headers.get("authorization");
 if(authorization){
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!key)return out({error:"Servicio no configurado"},503);
  const response=await fetch(Deno.env.get("SUPABASE_URL")+"/auth/v1/user",{headers:{apikey:key,Authorization:authorization}});
  if(!response.ok)return out({error:"Inicia sesión nuevamente"},401);
  const user=await response.json();
  if(!uuid(user.id)||!user.email_confirmed_at)return out({error:"Verifica tu correo"},401);
  const ownFilter="owner_id=eq."+user.id+"&active=eq.true";
  let owned=await rest(owners,ownFilter+"&select=key_hash");
  if(b.action==="provision"&&b.legacyKey){
    if(!hex(b.legacyKey))return out({error:"Conexión anterior inválida"},400);
    const legacy=await hash(b.legacyKey);
    if(owned.length&&owned[0].key_hash!==legacy)return out({error:"Esta cuenta ya tiene otra conexión de confirmaciones. No se cambiaron enlaces."},409);
    if(!owned.length){
      const claimed=await rest(owners,"key_hash=eq."+legacy+"&owner_id=is.null&active=eq.true","PATCH",{owner_id:user.id});
      if(!claimed.length)return out({error:"No se pudo asociar la conexión anterior. No se cambiaron enlaces."},409);
      owned=claimed;
    }
  }
  if(!owned.length){
    const newHash=await hash("nova-account:"+user.id);
    try{await rest(owners,"","POST",{key_hash:newHash,owner_id:user.id,active:true});}catch{}
    owned=await rest(owners,ownFilter+"&select=key_hash");
  }
  if(!owned.length)return out({error:"No se pudo activar la cuenta"},503);
  owner=owned[0].key_hash;
  if(b.action==="provision")return out({ok:true});
 }else{
  if(!hex(b.ownerKey))return out({error:"Conexión no autorizada"},401);
  owner=await hash(b.ownerKey);
  const auth=await rest(owners,"key_hash=eq."+owner+"&active=eq.true&owner_id=is.null&select=key_hash");
  if(!auth.length)return out({error:"Inicia sesión en NOVA para gestionar tus citas"},401);
 }
 const scope="owner_hash=eq."+owner;
 if(b.action==="ping")return out({ok:true});
 if(b.action==="create"){if(!uuid(b.id)||!hex(b.token)||typeof b.expires!=="string")return out({error:"Solicitud inválida"},400);const expiration=Date.parse(b.expires);if(!Number.isFinite(expiration)||expiration<=Date.now()||expiration>Date.now()+366*86400000)return out({error:"Fecha de cita no disponible"},400);await rest(table,"","POST",{id:b.id,owner_hash:owner,token_hash:await hash(b.token),expires_at:new Date(expiration).toISOString()});return out({ok:true});}
 if(b.action==="revoke"){if(!uuid(b.id))return out({error:"Solicitud inválida"},400);await rest(table,scope+"&id=eq."+b.id,"PATCH",{revoked:true});return out({ok:true});}
 if(b.action==="status"){if(!Array.isArray(b.ids)||b.ids.length>50||!b.ids.every(uuid))return out({error:"Solicitud inválida"},400);if(!b.ids.length)return out({items:[]});const rows=await rest(table,scope+"&id=in.("+b.ids.join(",")+")&select=id,expires_at,confirmed_at,revoked");return out({items:rows.map((r:any)=>({id:r.id,state:r.revoked?"revoked":r.confirmed_at?"confirmed":Date.parse(r.expires_at)<=Date.now()?"expired":"pending",confirmedAt:r.confirmed_at}))});}
 return out({error:"Acción inválida"},400);
 }catch{return out({error:"No se pudo procesar la solicitud"},500);}
});