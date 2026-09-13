(() => {
  let connectionPollTimer=null;
  let connectionRequestRunning=false;

  function ensureStyle(){if(document.querySelector("link[data-robot-style]"))return;const link=document.createElement("link");link.rel="stylesheet";link.href="admin-robot.css";link.dataset.robotStyle="1";document.head.appendChild(link)}

  function ensureShell(){
    const nav=document.querySelector(".admin-tabs"),adminApp=document.querySelector("#adminApp");if(!nav||!adminApp)return null;
    let button=nav.querySelector('[data-tab="robot"]');
    if(!button){button=document.createElement("button");button.type="button";button.className="tab-button";button.dataset.tab="robot";button.textContent="WhatsApp";button.addEventListener("click",()=>{if(typeof switchTab==="function")switchTab("robot")});nav.appendChild(button)}
    let panel=document.querySelector("#tab-robot");
    if(!panel){panel=document.createElement("section");panel.className="tab-panel";panel.id="tab-robot";panel.innerHTML='<div class="panel-heading"><h2>WhatsApp</h2></div><div id="robotPanel"></div>';const note=adminApp.querySelector(".security-note");if(note)adminApp.insertBefore(panel,note);else adminApp.appendChild(panel)}
    return panel.querySelector("#robotPanel");
  }

  async function connectionApi(options={}){if(typeof api==="function")return api("/api/robot/connection",options);const headers={...(options.headers||{})},appToken=typeof getAdminAppToken==="function"?getAdminAppToken():"";if(appToken)headers["x-admin-app-token"]=appToken;const response=await fetch("/api/robot/connection",{...options,headers,cache:"no-store",credentials:"include"});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||"WhatsApp indisponível.");return data}
  function maskPhone(value){let digits=String(value||"").replace(/\D/g,"");if(digits.startsWith("55")&&digits.length>11)digits=digits.slice(2);digits=digits.slice(0,11);if(digits.length<=2)return digits;const ddd=digits.slice(0,2),body=digits.slice(2);if(body.length<=4)return`(${ddd}) ${body}`;if(body.length<=8)return`(${ddd}) ${body.slice(0,4)}-${body.slice(4)}`;return`(${ddd}) ${body.slice(0,5)}-${body.slice(5)}`}
  function formatPairingCode(code){const clean=String(code||"").replace(/\s+/g,"").trim();return clean?(clean.match(/.{1,4}/g)?.join(" ")||clean):""}
  function robotPhone(host){return document.querySelector("#robotWhatsappV3")?.value||host.querySelector("#robotPairPhone")?.value||""}

  function renderConnection(host,data={}){
    const badge=host.querySelector("#robotConnectionBadge"),message=host.querySelector("#robotConnectionMessage"),qrBox=host.querySelector("#robotQrBox"),qrImage=host.querySelector("#robotQrImage"),codeBox=host.querySelector("#robotPairResult"),codeValue=host.querySelector("#robotPairCode"),resetButton=host.querySelector("#robotConnectionReset");
    badge.className="robot-connection-badge";message.textContent="";qrBox.hidden=true;qrImage.removeAttribute("src");codeBox.hidden=true;codeValue.textContent="";resetButton.disabled=!data.configured;resetButton.textContent="Gerar QR Code";
    if(!data.configured){badge.classList.add("is-neutral");badge.textContent="Serviço não vinculado";return}
    if(data.connected){badge.classList.add("is-connected");badge.textContent="Conectado";resetButton.textContent="Trocar por QR Code";return}
    if(data.pairingCode){badge.classList.add("is-waiting");badge.textContent="Código pronto";codeValue.textContent=formatPairingCode(data.pairingCode);codeBox.hidden=false;return}
    if(["preparing-code","pairing-code"].includes(String(data.authState||"").toLowerCase())){badge.classList.add("is-preparing");badge.textContent="Gerando código";return}
    if(data.qrReady&&data.qrImage){badge.classList.add("is-waiting");badge.textContent="QR Code pronto";qrImage.src=data.qrImage;qrBox.hidden=false;resetButton.textContent="Novo QR Code";return}
    if(data.authState==="unreachable"||data.authState==="error"){badge.classList.add("is-error");badge.textContent="Indisponível";message.textContent=String(data.error||data.lastError||"")||"Serviço indisponível.";resetButton.textContent="Tentar QR Code";return}
    badge.classList.add("is-preparing");badge.textContent="Conectando";
  }

  async function loadConnection(host,quiet=false){if(!host||connectionRequestRunning)return;connectionRequestRunning=true;const button=host.querySelector("#robotConnectionRefresh"),status=host.querySelector("#robotConnectionActionStatus");if(!quiet)button.disabled=true;try{renderConnection(host,await connectionApi());if(status&&!status.dataset.locked){status.className="status";status.textContent=""}}catch(error){renderConnection(host,{configured:true,authState:"unreachable",error:error.message})}finally{connectionRequestRunning=false;button.disabled=false}}

  function renderPanel(){
    ensureStyle();const host=ensureShell();if(!host||host.dataset.robotReady==="1")return host;host.dataset.robotReady="1";
    host.innerHTML=`<section class="robot-admin-card robot-connection-card"><div class="robot-admin-header"><div><h2>Conexão do robô</h2></div><span class="robot-connection-badge is-preparing" id="robotConnectionBadge">Verificando</span></div><p class="robot-connection-message" id="robotConnectionMessage"></p><input id="robotPairPhone" type="hidden"><div class="robot-actions"><button type="button" class="admin-primary" id="robotGeneratePairCode">Gerar código temporário</button><button type="button" class="admin-secondary" id="robotConnectionRefresh">Atualizar</button><button type="button" class="admin-primary" id="robotConnectionReset">Gerar QR Code</button></div><div class="robot-pair-result" id="robotPairResult" hidden><small>CÓDIGO</small><strong id="robotPairCode"></strong></div><div class="robot-qr-box" id="robotQrBox" hidden><img id="robotQrImage" alt="QR Code do WhatsApp"></div><p class="status" id="robotConnectionActionStatus" aria-live="polite"></p></section>`;

    const pairPhone=host.querySelector("#robotPairPhone");
    setTimeout(()=>{const robot=document.querySelector("#robotWhatsappV3")?.value;if(robot)pairPhone.value=maskPhone(robot)},800);

    host.querySelector("#robotGeneratePairCode").addEventListener("click",async()=>{
      const button=host.querySelector("#robotGeneratePairCode"),status=host.querySelector("#robotConnectionActionStatus"),phoneNumber=robotPhone(host);
      if(String(phoneNumber).replace(/\D/g,"").length<10){status.className="status error";status.textContent="Cadastre o WhatsApp do robô.";return}
      pairPhone.value=maskPhone(phoneNumber);button.disabled=true;status.dataset.locked="1";status.className="status";status.textContent="Gerando...";
      try{const result=await connectionApi({method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"pair-code",phoneNumber})});status.className="status ok";status.textContent=result.message||"Código solicitado.";renderConnection(host,{configured:true,authState:"preparing-code"});setTimeout(()=>{delete status.dataset.locked;loadConnection(host)},2500)}catch(error){status.className="status error";status.textContent=error.message||"Não foi possível gerar o código.";delete status.dataset.locked}finally{button.disabled=false}
    });

    host.querySelector("#robotConnectionRefresh").addEventListener("click",()=>loadConnection(host));
    host.querySelector("#robotConnectionReset").addEventListener("click",async()=>{
      const connected=host.querySelector("#robotConnectionBadge")?.classList.contains("is-connected");if(connected&&!confirm("Trocar o WhatsApp conectado?"))return;
      const button=host.querySelector("#robotConnectionReset"),status=host.querySelector("#robotConnectionActionStatus");button.disabled=true;status.dataset.locked="1";status.className="status";status.textContent="Gerando QR Code...";
      try{const result=await connectionApi({method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"reset"})});status.className="status ok";status.textContent=result.message||"QR Code solicitado.";renderConnection(host,{configured:true,authState:"starting"});setTimeout(()=>{delete status.dataset.locked;loadConnection(host)},1800)}catch(error){status.className="status error";status.textContent=error.message||"Não foi possível gerar o QR Code.";delete status.dataset.locked}finally{button.disabled=false}
    });

    loadConnection(host);connectionPollTimer=setInterval(()=>{if(document.visibilityState!=="visible")return;const panel=document.querySelector("#tab-robot");if(panel?.classList.contains("active"))loadConnection(host,true)},3500);return host;
  }

  window.LanchoneteRobot={renderRobotPanel:renderPanel};if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",renderPanel);else renderPanel();
})();
