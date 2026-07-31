import { copyFile, readFile, writeFile } from "node:fs/promises";

const bundlePath = "public/assets/index-anSa7LUY.js";
let source = await readFile(bundlePath, "utf8");

function replaceOnceOrVerify(needle, replacement, label) {
  const needleMatches = source.split(needle).length - 1;
  const replacementMatches = source.split(replacement).length - 1;
  if (needleMatches === 1) {
    source = source.replace(needle, replacement);
    return;
  }
  if (needleMatches === 0 && replacementMatches === 1) return;
  throw new Error(`${label}: eine eindeutige Fundstelle erwartet (alt=${needleMatches}, neu=${replacementMatches})`);
}

replaceOnceOrVerify(
  'async function ve(o,c={}){const a=await fetch(o,{credentials:"same-origin",headers:{"Content-Type":"application/json",...c.headers||{}},...c}),d=await a.json().catch(()=>({}));if(!a.ok)throw new Error(d.message||"Die Anfrage konnte nicht verarbeitet werden.");return d}',
  'async function ve(o,c={}){const a=await fetch(o,{credentials:"same-origin",headers:{"Content-Type":"application/json",...c.headers||{}},...c}),d=await a.text();let h={};try{h=d?JSON.parse(d):{}}catch{}if(!a.ok)throw new Error(h.message||d||"Die Anfrage konnte nicht verarbeitet werden ("+a.status+").");return h}',
  "API-Fehlerbehandlung"
);

replaceOnceOrVerify(
  'date:un(),start:"07:00"',
  'date:Tt(new Date),start:"07:00"',
  "Standarddatum im Dienstplan"
);

replaceOnceOrVerify(
  'catch{C({tone:"error",text:"Der Dienstplan konnte nicht als PDF erstellt werden."})}finally{E("")}}function fe',
  'catch(R){C({tone:"error",text:"Der Dienstplan konnte nicht als PDF erstellt werden."+((R instanceof Error&&R.message)?" "+R.message:"")})}finally{E("")}}function fe',
  "PDF-Fehlerausgabe"
);

const helper = 'async function habunSavePdfFile(o,c){const a=o.output("blob"),d=typeof navigator<"u"?navigator:{},h=/iPad|iPhone|iPod/.test(d.userAgent||"")||d.platform==="MacIntel"&&d.maxTouchPoints>1,g=typeof window<"u"&&(window.matchMedia?.("(display-mode: standalone)")?.matches||d.standalone===!0);if(h&&g&&typeof File==="function"&&typeof d.share==="function"&&typeof d.canShare==="function")try{const w=new File([a],c,{type:"application/pdf"});if(d.canShare({files:[w]})){await d.share({files:[w],title:c});return}}catch(w){if(w?.name==="AbortError")return}const N=URL.createObjectURL(a),y=document.createElement("a");y.href=N,y.download=c,y.rel="noopener",y.style.display="none",document.body.appendChild(y),y.click(),y.remove(),window.setTimeout(()=>URL.revokeObjectURL(N),6e4)}';
if (!source.includes('async function habunSavePdfFile(')) {
  const marker = 'async function sp(';
  if (!source.includes(marker)) throw new Error('PDF-Helfer: Einfügepunkt fehlt');
  source = source.replace(marker, `${helper}${marker}`);
}

replaceOnceOrVerify(
  'y.save(`Habun-Stundenzettel-Alle-${c}.pdf`)',
  'await habunSavePdfFile(y,`Habun-Stundenzettel-Alle-${c}.pdf`)',
  "Gesamt-PDF Download"
);
replaceOnceOrVerify(
  'S.save(`Stundenzettel-${id(c.fullName)}-${a}.pdf`)',
  'await habunSavePdfFile(S,`Stundenzettel-${id(c.fullName)}-${a}.pdf`)',
  "Einzel-PDF Download"
);
replaceOnceOrVerify(
  'S.save(`Dienstplan-${a}-bis-${D}.pdf`)',
  'await habunSavePdfFile(S,`Dienstplan-${a}-bis-${D}.pdf`)',
  "Dienstplan-PDF Download"
);

await writeFile(bundlePath, source);
await copyFile(bundlePath, "public/assets/index-habun-main-20260731-2.js");
