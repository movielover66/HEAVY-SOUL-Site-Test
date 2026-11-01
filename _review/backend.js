/* HEAVY SOUL — unified commerce workflow for the new UI. */
(function(){
  const C = window.SITE_CONFIG;
  const CART_KEY = 'heavySoulCart';
  const LEGACY_CART_KEY = 'cart';
  const SHIPPING_INFO_KEY = 'shippingInfo';

  function readCart(){
    let raw = localStorage.getItem(CART_KEY);
    if (!raw) {
      const old = JSON.parse(localStorage.getItem(LEGACY_CART_KEY) || '[]');
      const migrated = old.map(i => ({id:i.id,name:i.name,price:Number(i.price)||0,image:i.image,size:i.size||'-',color:i.color||'',orderType:i.orderType||'collection',quantity:Number(i.qty||i.quantity)||1}));
      localStorage.setItem(CART_KEY, JSON.stringify(migrated));
      return migrated;
    }
    return JSON.parse(raw || '[]');
  }
  function saveCart(c){ localStorage.setItem(CART_KEY, JSON.stringify(c)); window.dispatchEvent(new Event('hs:cartUpdated')); }
  function cartTotal(c){ return c.reduce((n,i)=>n+(Number(i.price)||0)*(Number(i.quantity||i.qty)||1),0); }
  function cartQty(c){ return c.reduce((n,i)=>n+(Number(i.quantity||i.qty)||1),0); }
  function money(n){ return '₹'+Math.round(Number(n)||0); }
  function orderId(){ const d=new Date(); const z=n=>String(n).padStart(2,'0'); return `HS-${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}-${Math.floor(100+Math.random()*900)}`; }
  function postSheet(payload){
    if(!C.APPS_SCRIPT_URL) return Promise.resolve();
    return fetch(C.APPS_SCRIPT_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)}).catch(()=>{});
  }
  function codAdvance(c){
    return c.reduce((n,i)=>n + (i.orderType==='custom' ? Number(i.price||0)*Number(C.CUSTOM_ADVANCE_PERCENT||.5) : Number(C.COD_FLAT_ADVANCE||150)) * Number(i.quantity||1),0);
  }
  function checkoutAmounts(c, shipping){
    const subtotal=cartTotal(c), handling=Number(C.COD_HANDLING_PER_ITEM||0)*cartQty(c);
    const method=document.querySelector('input[name="payment"]:checked')?.value || 'cod';
    const ship=shipping || 0;
    const grandTotal=subtotal+ship+(method==='cod'?handling:0);
    const paid=method==='prepaid'?grandTotal:Math.min(grandTotal, codAdvance(c)+handling);
    return {subtotal,shipping:ship,handling,grandTotal,paid,balance:Math.max(0,grandTotal-paid),method};
  }
  function collectCheckout(){
    const inputs=[...document.querySelectorAll('.checkout-form input')];
    const val=placeholder=>{const el=inputs.find(x=>x.placeholder===placeholder);return el?el.value.trim():''};
    const payment=document.querySelector('input[name="payment"]:checked')?.value || 'cod';
    const shipping=document.querySelector('input[name="shipping"]:checked')?.value || 'standard';
    return {emailOrPhone:val('Email / Phone Number'),name:val('Full Name'),address:val('Address'),city:val('Town / City'),state:val('State'),pin:val('PIN Code'),phone:val('Phone Number'),shippingMethod:shipping,paymentMethod:payment};
  }
  function validate(info,c){
    if(!c.length){alert('Your cart is empty.'); location.href='shop.html'; return false;}
    for(const k of ['name','address','city','state','pin','phone']) if(!info[k]){alert('Please fill all required shipping details.');return false;}
    if(!/^[0-9]{6}$/.test(info.pin)){alert('Please enter a valid 6-digit PIN code.');return false;}
    if(!/^[6-9][0-9]{9}$/.test(info.phone.replace(/\D/g,''))){alert('Please enter a valid 10-digit mobile number.');return false;}
    return true;
  }
  function buildPayload(id, info, c, amounts, paymentRef){
    return {orderId:id,customerName:info.name,phone:info.phone,email:info.emailOrPhone,address:info.address,city:info.city,state:info.state,pincode:info.pin,shippingMethod:info.shippingMethod,amount:amounts.paid,codAmount:amounts.balance,grandTotal:amounts.grandTotal,subtotal:amounts.subtotal,shipping:amounts.shipping,handling:amounts.handling,paymentType:amounts.method==='cod'?'cod':'prepaid',paymentRef:paymentRef||'',weight:cartQty(c)*(C.WEIGHT_PER_ITEM_G||300),items:c.map(i=>({id:i.id,name:i.name,size:i.size||'-',color:i.color||'',qty:Number(i.quantity||1),price:Number(i.price||0),image:i.image||'',orderType:i.orderType||'collection'})),status:'Confirmed',createdAt:new Date().toISOString()};
  }
  async function saveFirestore(payload){
    if(!window.firebase || !firebase.apps?.length || typeof firebase.firestore!=='function') return;
    const user=await new Promise(r=>{const u=firebase.auth(); const un=u.onAuthStateChanged(x=>{un();r(x)});});
    if(!user)return;
    await firebase.firestore().collection('orders').doc(payload.orderId).set({uid:user.uid,...payload,createdAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
    await firebase.firestore().collection('users').doc(user.uid).set({name:payload.customerName,phone:payload.phone,email:user.email||payload.email,address:payload.address,city:payload.city,state:payload.state,pin:payload.pincode,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
  }
  function whatsapp(payload){
    const lines=payload.items.map(i=>`• ${i.name} | Size: ${i.size} | Qty: ${i.qty} | ₹${i.price*i.qty}`).join('\n');
    const msg=`🛍️ *NEW ORDER — HEAVY SOUL*\n\nOrder ID: ${payload.orderId}\n\nName: ${payload.customerName}\nPhone: ${payload.phone}\nEmail: ${payload.email||'-'}\n\nAddress:\n${payload.address}, ${payload.city}, ${payload.state} - ${payload.pincode}\n\n${lines}\n\nSubtotal: ₹${payload.subtotal}\nShipping: ₹${payload.shipping}\nCOD Handling: ₹${payload.handling}\nGrand Total: ₹${payload.grandTotal}\nPayment: ${payload.paymentType}\nPaid Now: ₹${payload.amount}\nBalance: ₹${payload.codAmount}\nPayment Ref: ${payload.paymentRef||'-'}`;
    window.open(`https://wa.me/${C.WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`,'_blank');
  }
  // For prepaid orders, the Apps Script backend writes the final order only
  // after Razorpay's signed webhook is received. This prevents a browser from
  // creating a paid order record before payment has been confirmed.
  async function finalize(payload, options){
    const persistRemote=!options || options.persistRemote!==false;
    if(persistRemote) await postSheet(payload); try{await saveFirestore(payload)}catch(e){console.warn(e)}
    localStorage.setItem('hs_last_order',JSON.stringify(payload));
    localStorage.removeItem(CART_KEY); localStorage.removeItem(LEGACY_CART_KEY); localStorage.removeItem(SHIPPING_INFO_KEY);
    whatsapp(payload); location.href=`order-confirmation.html?order=${encodeURIComponent(payload.orderId)}`;
  }
  async function pay(info,c,amounts){
    const id=orderId(); const payload=buildPayload(id,info,c,amounts,'');
    const r=await fetch('/api/create-order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount:amounts.paid,...payload})});
    const data=await r.json(); if(!data.success) throw new Error(data.error||'Payment creation failed');
    if(typeof Razorpay==='undefined') throw new Error('Razorpay checkout is unavailable.');
    const rz=new Razorpay({key:C.RAZORPAY_KEY_ID,amount:amounts.paid*100,currency:'INR',name:'HEAVY SOUL',description:`Order ${id}`,order_id:data.order_id,prefill:{name:info.name,contact:info.phone,email:info.emailOrPhone||''},theme:{color:'#000000'},handler:async res=>{payload.paymentRef=res.razorpay_payment_id; await finalize(payload,{persistRemote:false})}});
    rz.on('payment.failed',()=>alert('Payment failed. Please try again.')); rz.open();
  }
  window.HSBackend={readCart,saveCart,cartTotal,cartQty,checkoutAmounts,collectCheckout,validate,buildPayload,finalize,pay,money};

  function initCheckout(){
    const form=document.querySelector('.checkout-form'); if(!form)return;
    const c=readCart();
    const btn=document.getElementById('placeOrderBtn');
    form.addEventListener('submit',async e=>{e.preventDefault(); if(btn.disabled)return; const info=collectCheckout(); if(!validate(info,c))return; const shipping=document.querySelector('input[name="shipping"]:checked')?.value==='express'?99:0; const a=checkoutAmounts(c,shipping); btn.disabled=true; document.body.classList.add('is-placing-order'); try{ if(a.method==='prepaid') await pay(info,c,a); else { const p=buildPayload(orderId(),info,c,a,'COD_ADVANCE'); await finalize(p); } }catch(err){console.error(err);alert(err.message||'Something went wrong. Please try again.');btn.disabled=false;document.body.classList.remove('is-placing-order')}});
    document.querySelectorAll('input[name="payment"]').forEach(r=>r.addEventListener('change',()=>{r.value=r.checked && /online/i.test(r.parentElement.textContent)?'prepaid':'cod'}));
    const radios=[...document.querySelectorAll('input[name="payment"]')]; if(radios[0])radios[0].value='cod'; if(radios[1])radios[1].value='prepaid';
  }
  function initConfirmation(){
    if(!location.pathname.endsWith('order-confirmation.html')) return;
    let p=null; try { p=JSON.parse(localStorage.getItem('hs_last_order')||'null'); } catch(e) {}
    const id=new URLSearchParams(location.search).get('order');
    const oid=id || (p && p.orderId) || '—';
    const el=document.querySelector('.order-id');
    if(el) el.textContent='Order ID: '+oid;
    if(!p) return;
    const first=p.items && p.items[0];
    const row=document.querySelector('.item-row');
    if(row && first){
      const img=row.querySelector('img'); if(img) img.src=first.image || img.src;
      const title=row.querySelector('.item-title'); if(title) title.textContent=first.name || 'Order';
      const variant=row.querySelector('.item-variant'); if(variant) variant.textContent=(first.color||'')+' / '+(first.size||'-');
      const qty=row.querySelector('.item-qty'); if(qty) qty.textContent='Qty: '+(first.qty||1);
      const price=row.querySelector('.item-price'); if(price) price.textContent=money((first.price||0)*(first.qty||1));
    }
    const vals=document.querySelectorAll('.price-row span:last-child');
    if(vals[0]) vals[0].textContent=money(p.subtotal);
    if(vals[1]) vals[1].textContent=money(p.shipping);
    if(vals[2]) vals[2].textContent=money(p.grandTotal);
  }
  function initTracking(){
    if(!location.pathname.endsWith('order-tracking.html')) return;
    const form=document.querySelector('.tracking-form');
    const input=form && form.querySelector('input');
    const render=data=>{
      const steps=['Confirmed','Processing','Shipped','Out for Delivery','Delivered'];
      const status=String(data.status||'Confirmed');
      let idx=steps.findIndex(s=>s.toLowerCase()===status.toLowerCase());
      if(idx<0) idx=0;
      document.querySelectorAll('.timeline-step').forEach((el,i)=>{
        el.classList.toggle('completed',i<=idx);
        el.classList.toggle('pending',i>idx);
        const d=el.querySelector('.step-date');
        const key=['confirmedAt','processingAt','shippedAt','outForDeliveryAt','deliveredAt'][i];
        if(d) d.textContent=data[key] ? new Date(data[key]).toLocaleString() : (i===idx && data.updatedAt ? new Date(data.updatedAt).toLocaleString() : '--');
      });
    };
    async function lookup(id){
      if(!id) return;
      try{
        const r=await fetch(`${C.APPS_SCRIPT_URL}?type=track&order=${encodeURIComponent(id)}`);
        const d=await r.json();
        if(d.success && d.order){ render(d.order); return; }
      }catch(e){}
      let local=null; try{local=JSON.parse(localStorage.getItem('hs_last_order')||'null')}catch(e){}
      if(local && local.orderId===id) render(local); else alert('Order not found. Please check your Order ID.');
    }
    if(form) form.addEventListener('submit',e=>{e.preventDefault();lookup(input && input.value.trim())});
    const q=new URLSearchParams(location.search).get('order');
    if(q && input){ input.value=q; lookup(q); }
  }
  document.addEventListener('DOMContentLoaded',()=>{initCheckout();initConfirmation();initTracking()});
})();
