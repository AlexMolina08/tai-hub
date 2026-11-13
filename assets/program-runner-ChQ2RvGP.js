import{_ as x}from"./index-BPrhHDtx.js";const j=`(() => {
  let worker, token, initialized = false, lines = 0, bytes = 0;
  const send = data => parent.postMessage({ ...data, token }, '*');
  const stop = () => { worker?.terminate(); worker = undefined; };
  addEventListener('message', event => {
    if (event.source !== parent || !event.data || typeof event.data.token !== 'string') return;
    const data = event.data;
    if (data.kind === 'init' && !initialized) {
      initialized = true; token = data.token;
      const url = 'data:text/javascript;base64,' + btoa(unescape(encodeURIComponent(data.code)));
      worker = new Worker(url, { type: 'module' });
      worker.onmessage = event => {
        const value = event.data;
        if (!value || typeof value !== 'object') return;
        if (value.kind === 'output') {
          if (typeof value.text !== 'string' || ++lines > 100 || (bytes += value.text.length) > 16000) {
            stop(); send({ kind: 'output-limit' });
          } else send({ kind: 'output', text: value.text });
        } else if (['running', 'done', 'error', 'output-limit'].includes(value.kind)) {
          send({ kind: value.kind, message: typeof value.message === 'string' ? value.message.slice(0, 1800) : undefined });
          if (value.kind !== 'running') stop();
        }
      };
      worker.onerror = event => { stop(); send({ kind: 'error', message: String(event.message).slice(0, 1800) }); };
      worker.postMessage({ source: data.source, input: data.input, wasm: data.wasm, stdlib: data.stdlib, lock: data.lock });
    } else if (data.token === token && data.kind === 'cancel') stop();
  });
  parent.postMessage({ kind: 'sandbox-ready' }, '*');
})();`,L="sha256-EXTAzm93W1BBhN7VnoE1QY/IWlWu11oFI0kpe0ifhZs=";function P(r,s){return`const send = postMessage.bind(globalThis);
let lines = 0, bytes = 0;
function output(...values) {
  const text = values.map(v => typeof v === 'string' ? v : String(JSON.stringify(v))).join(' ');
  if (++lines > 100 || (bytes += text.length) > 16000) { send({kind:'output-limit'}); throw Error('Salida limitada.'); }
  send({kind:'output', text});
}
globalThis.console = {log:output, error:output, warn:output};
const input = ${JSON.stringify(s)};
send({kind:'running'});
try { await (async () => {
${r}
})(); send({kind:'done'}); }
catch(error) { send({kind:'error', message:String(error?.message ?? error).slice(0,1800)}); }`}async function S(r,s,d,t){const u=r==="python"?x(()=>import("./python-assets-BZsvm9Pc.js"),[]).then(c=>c.pythonAssets()):Promise.resolve({code:P(s,d)});return t?new Promise((c,p)=>{const l=()=>p(new Error("Ejecución cancelada. El código está guardado."));t.addEventListener("abort",l,{once:!0}),u.then(c,p).finally(()=>t.removeEventListener("abort",l)),t.aborted&&l()}):u}async function _(r,s,d,t,u){if(s.length>5e4||JSON.stringify(d).length>16e3)throw new Error("El código o la entrada superan el límite.");t?.throwIfAborted(),u?.(r==="python"?"Preparando Python…":"Preparando JavaScript…");const c=await S(r,s,d,t);return t?.throwIfAborted(),new Promise((p,l)=>{const m=crypto.randomUUID(),n=document.createElement("iframe");n.hidden=!0,n.title="Motor de código aislado",n.setAttribute("sandbox","allow-scripts");const h=`default-src 'none'; script-src '${L}' 'wasm-unsafe-eval'; worker-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;n.srcdoc=`<!doctype html><meta http-equiv="Content-Security-Policy" content="${h}"><script>${j}<\/script>`;const a=[];let k=!1,f=!1,g=!1,E=0;const o=(i,e)=>{k||(k=!0,clearTimeout(v),window.removeEventListener("message",y),t?.removeEventListener("abort",w),n.contentWindow?.postMessage({kind:"cancel",token:m},"*"),setTimeout(()=>n.remove(),100),e?l(e):p(i))},w=()=>o(void 0,new Error("Ejecución cancelada. El código está guardado."));let v=setTimeout(()=>o(void 0,new Error("El motor no pudo arrancar a tiempo. Vuelve a intentarlo.")),2e4);const y=i=>{if(i.source!==n.contentWindow||!i.data||typeof i.data!="object")return;const e=i.data;if(e.kind==="sandbox-ready"&&!g){g=!0,n.contentWindow.postMessage({kind:"init",token:m,...c,source:s,input:d},"*");return}if(e.token===m){if(e.kind==="running"&&!f)f=!0,clearTimeout(v),u?.("Ejecutando código…"),v=setTimeout(()=>o({status:"timeout",output:a,error:"Límite de ejecución: 2 segundos. El motor se ha detenido."}),2e3);else if(e.kind==="output")typeof e.text!="string"||a.length>=100||(E+=e.text.length)>16e3?o({status:"output-limit",output:a,error:"La salida supera 100 líneas o 16 KB."}):a.push(e.text);else if(e.kind==="output-limit")o({status:"output-limit",output:a,error:"La salida supera 100 líneas o 16 KB."});else if(e.kind==="done")o({status:"done",output:a});else if(e.kind==="error"){const b=typeof e.message=="string"?e.message.slice(0,1800):"Error de ejecución.";f||r==="javascript"?o({status:"error",output:a,error:b}):o(void 0,new Error(b))}}};window.addEventListener("message",y),t?.addEventListener("abort",w,{once:!0}),document.body.append(n)})}export{P as javascriptProgram,_ as runProgram};
