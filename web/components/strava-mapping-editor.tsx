"use client";

import { useMemo, useState } from "react";
import { withBasePath } from "@/lib/base-path";

type Props = {
  titles:string[];
  saved:Record<string,string>;
  suggestions:Record<string,string>;
  supported:readonly string[];
  caveats:Record<string,string>;
};

const collator=new Intl.Collator("pt-BR",{sensitivity:"base",numeric:true});
function normalized(value:string):string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");
}
export function StravaMappingEditor({titles,saved,suggestions,supported,caveats}:Props) {
  const [persisted,setPersisted]=useState<Record<string,string>>(saved);
  const [choices,setChoices]=useState<Record<string,string>>(saved);
  const [saving,setSaving]=useState<string|null>(null);
  const [messages,setMessages]=useState<Record<string,string>>({});
  const [filter,setFilter]=useState("");
  const [scope,setScope]=useState<"all"|"pending"|"edited">("all");

  const sortedTitles=useMemo(()=>[...titles].sort(collator.compare),[titles]);
  const sortedOptions=useMemo(()=>[...supported].sort(collator.compare),[supported]);
  const visible=sortedTitles.filter(title=>{
    if(filter && !normalized(title).includes(normalized(filter)))return false;
    const current=choices[title]??"";
    const committed=persisted[title]??"";
    if(scope==="pending" && committed!=="")return false;
    if(scope==="edited" && current===committed)return false;
    return true;
  });
  const confirmed=sortedTitles.filter(title=>Boolean(persisted[title])).length;
  const edited=sortedTitles.filter(title=>(choices[title]??"")!==(persisted[title]??"")).length;

  function choose(title:string,value:string){
    setChoices(prev=>({...prev,[title]:value}));
    setMessages(prev=>({...prev,[title]:""}));
  }
  async function save(title:string) {
    if(saving!==null)return;
    const selected=choices[title]??"";
    setSaving(title);
    setMessages(prev=>({...prev,[title]:""}));
    try {
      const response=await fetch(withBasePath("/api/strava/mappings"),{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({title,stravaType:selected}),
      });
      let data:{error?:string;saved?:boolean;stravaType?:string|null}={};
      try{data=await response.json();}catch{}
      if(!response.ok || data.saved!==true || (data.stravaType??"")!==selected)
        throw new Error(data.error??`Erro HTTP ${response.status}`);
      setPersisted(prev=>{
        const next={...prev};
        if(selected)next[title]=selected;else delete next[title];
        return next;
      });
      setMessages(prev=>({...prev,[title]:"Salvo e confirmado no banco"}));
    }catch(e) {
      setMessages(prev=>({...prev,[title]:e instanceof Error?e.message:"Erro ao salvar"}));
    }finally{setSaving(null);}
  }

  return <div className="space-y-4">
    <div className="rounded-xl border border-border bg-surface-elevated p-4 space-y-3">
      <div className="flex flex-wrap gap-3 text-sm text-text-secondary">
        <span>{sortedTitles.length} exercícios</span>
        <span className="text-teal">{confirmed} confirmados no banco</span>
        <span>{sortedTitles.length-confirmed} não mapeados</span>
        {edited>0 && <span className="text-amber-400">{edited} alterações não salvas</span>}
      </div>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-sm text-text-secondary flex-1 min-w-[190px]">
          Buscar exercício
          <input value={filter} onChange={e=>setFilter(e.target.value)}
            placeholder="Nome do exercício (aceita acentos)"
            className="block mt-1 w-full rounded-md border border-border bg-base text-text p-2"/>
        </label>
        <label className="text-sm text-text-secondary">
          Mostrar
          <select value={scope} onChange={e=>setScope(e.target.value as typeof scope)}
            className="block mt-1 rounded-md border border-border bg-base text-text p-2">
            <option value="all">Todos em ordem alfabética</option>
            <option value="pending">Ainda não mapeados</option>
            <option value="edited">Alterados, não salvos</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-text-secondary">Ordenação alfabética em português para os exercícios e para as opções do Strava. Escolher uma opção não a salva automaticamente.</p>
    </div>
    <div className="rounded-xl border border-border bg-surface-elevated divide-y divide-border">
      {visible.length===0 && <p className="p-4 text-text-secondary">Nenhum exercício encontrado para este filtro.</p>}
      {visible.map(title=>{
        const selected=choices[title]??"";
        const committed=persisted[title]??"";
        const dirty=selected!==committed;
        return <div key={title} className="p-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
          <div>
            <div className="font-medium text-sm">{title}</div>
            {suggestions[title] && selected!==suggestions[title] && <button type="button"
              className="text-xs text-teal underline text-left"
              onClick={()=>choose(title,suggestions[title])}>
              Selecionar sugestão: {suggestions[title]} (não salva)
            </button>}
            {caveats[title] && <div className="text-xs text-amber-400 mt-1">Atenção: {caveats[title]}</div>}
            <div className={dirty?"text-xs text-amber-400 mt-1":"text-xs text-text-secondary mt-1"}>
              {dirty?"Alteração não salva":committed?"Confirmado no banco":"Não mapeado"}
            </div>
          </div>
          <label className="text-xs text-text-secondary">
            Exercício equivalente no Strava
            <select className="block w-full mt-1 p-2 rounded-md bg-base text-text border border-border"
              value={selected} onChange={e=>choose(title,e.target.value)}>
              <option value="">Não mapeado (bloqueia exportação)</option>
              {sortedOptions.map(type=><option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button type="button" disabled={saving!==null || (!dirty && committed!=="")}
              className="rounded-md px-3 py-2 text-sm font-medium bg-surface-hover border border-border disabled:opacity-50"
              onClick={()=>void save(title)}>{saving===title?"Salvando…":"Salvar"}</button>
            {messages[title] && <span role="status" className="text-xs text-text-secondary max-w-[190px]">{messages[title]}</span>}
          </div>
        </div>;
      })}
    </div>
  </div>;
}
