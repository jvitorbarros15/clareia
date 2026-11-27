import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {chromium} from 'playwright';
import {apiDocsInner,loadSpec} from '../src/api-docs.ts';

const REPO=path.join(import.meta.dirname,'..'),SITE='https://clareia.org';
const sha=crypto.createHash("sha256").update((await fs.readFile(path.join(REPO,"api","openapi.yaml"),"utf8")).replace(/\r\n/g,"\n")).digest("hex").slice(0,16);
const spec=await loadSpec(REPO),version=spec.info.version;
const logo=(await fs.readFile(path.join(REPO,'real','app.js'),'utf8')).match(/const logo = '(<svg class="logo-mark"[\s\S]*?<\/svg>)'/)![1];
// The header template cannot reach the page's CSS, so the logo travels as a standalone image with its colors inline.
const headerLogo='data:image/svg+xml;base64,'+Buffer.from(logo.replace('<svg class="logo-mark"','<svg xmlns="http://www.w3.org/2000/svg" fill="#0b0e18"').replace('class="brand-rays"','fill="none" stroke="#e8ac43" stroke-width="3.3" stroke-linecap="round"')).toString('base64');
const font=async(f:string)=>`url(data:font/woff2;base64,${(await fs.readFile(path.join(REPO,'real','fonts',f))).toString('base64')}) format("woff2")`;
const date=new Date().toLocaleDateString('pt-BR',{day:'numeric',month:'long',year:'numeric',timeZone:'America/Sao_Paulo'});
const body=apiDocsInner(spec).replace(/<div class="doc-callout">[\s\S]*?<\/div>/,'');

const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Clareia API openapi.yaml sha256:${sha}</title><style>
@font-face{font-family:Newsreader;src:${await font('newsreader-latin.woff2')};font-weight:200 800}
@font-face{font-family:"Public Sans";src:${await font('public-sans-latin.woff2')};font-weight:100 900}
:root{--ink:#0b0e18;--muted:#656977;--line:#dbdcd9;--accent:#1551ff;--soft:#f2f1ee}
@page{size:A4;margin:22mm 18mm 20mm}
@page:first{margin:0}
*{box-sizing:border-box}
body{margin:0;color:var(--ink);font:10.5pt/1.5 "Public Sans",Arial,sans-serif}
h3,h4{font-family:Newsreader,Georgia,serif;font-weight:500;letter-spacing:-.01em}
h3{font-size:20pt;margin:28pt 0 8pt;break-after:avoid}
h4{font-size:13pt;margin:22pt 0 6pt;break-after:avoid}
h3,h4,.api-h{break-after:avoid}
p,li{orphans:3;widows:3}
a{color:var(--accent);text-decoration:none}
h4 code{font-size:12pt}
code{font:9pt ui-monospace,Consolas,monospace;overflow-wrap:anywhere}
.doc-table{width:100%;border-collapse:collapse;font-size:9pt;margin:8pt 0 14pt}
.doc-table th,.doc-table td{text-align:left;vertical-align:top;padding:6pt 10pt 6pt 0;border-bottom:1px solid var(--line)}
.doc-table th{font-size:7.5pt;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.doc-table tr{break-inside:avoid}
.doc-table thead{display:table-header-group}
.cover{height:297mm;padding:30mm 24mm;display:flex;flex-direction:column;break-after:page;background:#faf9f6}
.cover .logo-mark{align-self:flex-start;height:34pt;width:auto;fill:var(--ink);overflow:visible}
.cover .brand-rays{fill:none;stroke:#e8ac43;stroke-width:3.3;stroke-linecap:round}
.cover h1{font:500 44pt/1.05 Newsreader,Georgia,serif;letter-spacing:-.03em;margin:auto 0 10pt}
.cover .sub{font-size:15pt;color:var(--muted);margin:0 0 28pt}
.cover dl{margin:0 0 28pt;display:grid;grid-template-columns:auto 1fr;gap:6pt 18pt;font-size:10.5pt}
.cover dt{color:var(--muted)}.cover dd{margin:0}
.cover .notice{border-left:3pt solid var(--accent);padding:2pt 0 2pt 12pt;margin:0 0 auto;max-width:130mm}
.cover .hash{font-size:8pt;color:var(--muted);margin:0}
.rule{width:48pt;height:3pt;background:#e8ac43;margin:0 0 18pt}
</style></head><body>
<section class="cover">${logo}<h1>Contrato da API</h1><div class="rule"></div><p class="sub">API somente leitura do Clareia</p>
<dl><dt>Versão do contrato</dt><dd>${version}</dd><dt>Gerado em</dt><dd>${date}</dd></dl>
<div class="notice"><strong>A API ainda não é pública.</strong> Este documento descreve o contrato: endpoints, parâmetros e respostas. Os mesmos dados já estão disponíveis em ${SITE}/dados-abertos.</div>
<p class="hash">Gerado de openapi.yaml sha256:${sha}</p></section>
<main>${body}</main></body></html>`;

const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
try{
  const page=await browser.newPage();
  await page.setContent(html,{waitUntil:'load'});
  await page.evaluate(()=>document.fonts.ready);
  const tpl=(inner:string)=>`<div style="width:100%;height:100%;overflow:hidden;padding:0 18mm;font:8pt 'Helvetica Neue',Arial,sans-serif;color:#656977;display:flex;justify-content:space-between;align-items:center;-webkit-print-color-adjust:exact">${inner}</div>`;
  const out=path.join(REPO,'real','clareia-api.pdf');
  await page.pdf({path:out,format:'A4',printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,
    headerTemplate:tpl(`<img src="${headerLogo}" alt="Clareia" style="height:12pt;width:auto"><span>Contrato da API · v${version}</span>`),
    footerTemplate:tpl(`<span>${SITE}</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>`)});
  console.log('wrote',out);
}finally{await browser.close();}
