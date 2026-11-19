// One PDF document for download, sharing and printing. US Letter, in points.
export function renderInvoicePdf(jsPDF,{profile={},client={},invoice={},totals,paid=0,balance=0,status='Pendiente',logo='',paymentTerms='',dateText=x=>String(x||'-'),lineNet}){
 const d=new jsPDF({unit:'pt',format:'letter',orientation:'portrait',compress:true});
 const W=d.internal.pageSize.getWidth(),H=d.internal.pageSize.getHeight(),M=36,R=W-M,C=R-M,limit=H-65;
 const navy=[21,42,66],ink=[27,38,51],muted=[82,94,108],rule=[210,218,227],shade=[244,247,250],white=[255,255,255];
 let y=M;
 const text=(s,x,y,{size=10,bold=false,color=ink,align='left'}={})=>{d.setFont('helvetica',bold?'bold':'normal');d.setFontSize(size);d.setTextColor(...color);d.text(String(s??''),x,y,{align});};
 const split=(s,w,size=10,bold=false)=>{d.setFont('helvetica',bold?'bold':'normal');d.setFontSize(size);return d.splitTextToSize(String(s??''),w);};
 const lines=(a,x,y,opts={},leading=13)=>{for(const l of a){text(l,x,y,opts);y+=leading;}return y;};
 const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n)||0);
 const horizontal=(y)=>{d.setDrawColor(...rule);d.setLineWidth(.6);d.line(M,y,R,y);};
 const fill=(x,y,w,h,color)=>{d.setFillColor(...color);d.rect(x,y,w,h,'F');};
 const number=String(invoice.number||'Vista previa'),isPreview=!invoice.id;
 d.setProperties({title:'Factura '+number,author:profile.businessName||'Nova Cloud',subject:'Factura de servicios'});
 function pageHeader(first=false){
  y=M;
  if(!first){text('FACTURA / CONTINUACIÓN',M,y+10,{size:11,bold:true,color:navy});text(number,R,y+10,{size:10,bold:true,align:'right'});horizontal(y+20);y+=34;return;}
  let logoSpace=0;
  if(logo){try{const props=d.getImageProperties(logo);const scale=Math.min(58/props.width,54/props.height);d.addImage(logo,props.fileType,M,y,props.width*scale,props.height*scale,undefined,'FAST');logoSpace=70;}catch{}}
  const bx=M+logoSpace,companyWidth=312-logoSpace;
  const company=split(profile.businessName||'Mi negocio',companyWidth,17,true);
  let left=lines(company,bx,y+15,{size:17,bold:true,color:navy},19);
  const contact=[profile.address,profile.phone,profile.email,profile.web||profile.website].filter(Boolean).flatMap(t=>split(t,210,9));
  const right=lines(contact,R,y+10,{size:9,color:muted,align:'right'},12);
  y=Math.max(left,right,M+54)+14;horizontal(y);y+=28;
  text(isPreview?'VISTA PREVIA':'FACTURA',M,y,{size:25,bold:true,color:navy});
  const statusLabel=String(status).toUpperCase();
  fill(R-105,y-19,105,26,shade);text(statusLabel,R-52.5,y-3,{size:10,bold:true,align:'center',color:status==='Pagada'?[28,100,65]:navy});
  y+=23;
  const dateRows=[['Núm. de factura',number],['Fecha',dateText(invoice.date)],['Vence',invoice.dueDate?dateText(invoice.dueDate):'-']];
  for(const [label,value] of dateRows){text(label,M,y,{size:9,bold:true,color:muted});const ls=split(value,390,10,true);y=lines(ls,M+103,y,{size:10,bold:true},13)+2;}
  y+=7;horizontal(y);y+=20;
  text('FACTURAR A',M,y,{size:9,bold:true,color:navy});y+=15;
  const customer=split(invoice.clientName||client.name||'Cliente',C,12,true);
  y=lines(customer,M,y,{size:12,bold:true},15);
  const addr=[client.address||invoice.address||client.city,client.phone||invoice.clientPhone,client.email||invoice.clientEmail].filter(Boolean).flatMap(t=>split(t,C,10));
  y=lines(addr,M,y,{size:10,color:muted},13)+10;
 }
 function newPage(){d.addPage('letter','portrait');pageHeader(false);}
 function ensure(h){if(y+h>limit)newPage();}
 const cols=[M,M+292,M+350,M+445,R];
 function tableHead(){fill(M,y,C,25,navy);text('DESCRIPCIÓN',M+9,y+16,{size:9,bold:true,color:white});text('CANT.',(cols[1]+cols[2])/2,y+16,{size:9,bold:true,color:white,align:'center'});text('PRECIO UNIT.',cols[3]-9,y+16,{size:9,bold:true,color:white,align:'right'});text('IMPORTE',R-9,y+16,{size:9,bold:true,color:white,align:'right'});y+=25;}
 pageHeader(true);ensure(56);tableHead();
 const items=invoice.items?.length?invoice.items:[{description:invoice.serviceTitle||invoice.invoiceType||'Servicio',qty:1,price:totals.subtotal,discount:totals.discount||0}];
 for(const item of items){
  const desc=split(item.description||'Servicio',cols[1]-M-20,10);
  const discount=Number(item.discount)||0,price=Number(item.price)||0;
  if(discount>0&&price>0)desc.push(...split('Descuento de partida: '+money(discount),cols[1]-M-20,9));
  let first=true;
  // Split very long descriptions rather than truncating or overflowing a page.
  while(desc.length){
   if(y+30>limit){newPage();tableHead();}
   const count=Math.max(1,Math.floor((limit-y-16)/13));const part=desc.splice(0,count),h=Math.max(32,part.length*13+16);
   fill(M,y,C,h,white);lines(part,M+9,y+17,{size:10},13);
   if(first){text(String(item.qty??1),(cols[1]+cols[2])/2,y+17,{size:10,align:'center'});text(money(price),cols[3]-9,y+17,{size:10,align:'right'});text(money(lineNet(item)),R-9,y+17,{size:10,bold:true,align:'right'});}
   d.setDrawColor(...rule);d.setLineWidth(.5);d.line(M,y+h,R,y+h);y+=h;first=false;
   if(desc.length){newPage();tableHead();}
  }
 }
 y+=18;
 const totalRows=[['Subtotal',totals.subtotal],...(totals.discount?[['Descuentos',-totals.discount]]:[]),['IVU ('+totals.taxPercent+'%)',totals.ivu],['Total',totals.total],['Pagado',paid],['Balance',balance]];
 const tx=R-235,rowH=24,block=totalRows.length*rowH;
 ensure(block+12);
 for(const [label,value] of totalRows){
  const strong=label==='Total'||label==='Balance',dark=label==='Balance';if(strong)fill(tx,y,235,rowH,dark?navy:shade);
  text(label,tx+10,y+16,{size:10,bold:strong,color:dark?white:ink});text(money(value),R-10,y+16,{size:strong?12:10,bold:strong,color:dark?white:ink,align:'right'});y+=rowH;
 }
 y+=18;
 for(const [label,value] of [['NOTAS',invoice.notes],['CONDICIONES / MÉTODO DE PAGO',paymentTerms]]){
  if(!value)continue;
  const content=split(value,C,10);
  ensure(33);text(label,M,y,{size:9,bold:true,color:navy});y+=15;
  while(content.length){ensure(15);text(content.shift(),M,y,{size:10});y+=13;}
  y+=10;
 }
 const pages=d.internal.getNumberOfPages();
 for(let k=1;k<=pages;k++){d.setPage(k);horizontal(H-48);text('Gracias por su preferencia.',M,H-30,{size:9,color:muted});text('Página '+k+' de '+pages,R,H-30,{size:9,color:muted,align:'right'});}
 return d;
}
