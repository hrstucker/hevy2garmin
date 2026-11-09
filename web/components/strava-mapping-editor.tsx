"use client";

import { useState } from "react";
import { withBasePath } from "@/lib/base-path";

type Props = {
  titles:string[];
  saved:Record<string,string>;
  suggestions:Record<string,string>;
  supported:readonly string[];
  caveats:Record<string,string>;
};

export function StravaMappingEditor({titles,saved,suggestions,supported,caveats}:Props) {
  const [choices,setChoices]=useState<Record<string,string>>(saved);
  const [saving,setSaving]=useState<string|null>(null);
  const [messages,setMessages]=useState<Record<string,string>>({});
  async function save(title:string) {
    setSaving(title);
    setMessages(prev=>({...prev,[title]:""}));
    try {
      const response=await fetch(withBasePath("/api/strava/mappings"),{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({title,stravaType:choices[title]??""}),
      });
      if(!response.ok) throw new Error("Não foi possível salvar o mapeamento");
      setMessages(prev=>({...prev,[title]:"Salvo"}));
    }catch {
      setMessages(prev=>({...prev,[title]:"Erro ao salvar"}));
    }finally{setSaving(null);}
  }
  return <div className="rounded-xl border border-border bg-surface-elevated divide-y divide-border">
    {titles.length===0 && <p className="p-4 text-text-secondary">Nenhum exercício disponível no Hevy.</p>}
    {titles.map(title=><div key={title} className="p-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
      <div>
        <div className="font-medium text-sm">{title}</div>
        {!saved[title] && suggestions[title] && <button type="button"
          className="text-xs text-teal underline text-left"
          onClick={()=>setChoices(prev=>({...prev,[title]:suggestions[title]}))}>
          Selecionar sugestão: {suggestions[title]} (ainda não salva)
        </button>}
        {caveats[title] && <div className="text-xs text-amber-400 mt-1">
          Atenção: {caveats[title]}
        </div>}
      </div>
      <label className="text-xs text-text-secondary">
        Exercício equivalente no Strava
        <select className="block w-full mt-1 p-2 rounded-md bg-base text-text border border-border"
          value={choices[title]??""}
          onChange={e=>setChoices(prev=>({...prev,[title]:e.target.value}))}>
          <option value="">Não mapeado (bloqueia exportação)</option>
          {supported.map(type=><option key={type} value={type}>{type}</option>)}
        </select>
      </label>
      <div className="flex items-center gap-2">
        <button type="button" disabled={saving!==null}
          className="rounded-md px-3 py-2 text-sm font-medium bg-surface-hover border border-border disabled:opacity-50"
          onClick={()=>void save(title)}>{saving===title?"Salvando…":"Salvar"}</button>
        {messages[title] && <span className="text-xs text-text-secondary">{messages[title]}</span>}
      </div>
    </div>)}
  </div>;
}
