import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "chart.js/auto";
import provider from "../lib/prices";
import { fetchCompaniesIndex, type Company, marketLabel } from "../lib/companies";
type TF = "1M"|"6M"|"YTD"|"1Y"|"MAX";

export default function Explore(){
  const [symbol, setSymbol] = useState<string>("AAPL");
  const [tf, setTf] = useState<TF>("6M");
  const [data, setData] = useState<{date:string; close:number}[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

  // load companies index for dynamic selector
  useEffect(()=>{ (async()=>{
    try{
      const idx = await fetchCompaniesIndex();
      setCompanies(idx);
      if (!idx.find(c=>c.symbol===symbol)){
        const firstUS = idx.find(c=> (c.market||"").toUpperCase()==="US");
        setSymbol(firstUS?.symbol || idx[0]?.symbol || symbol);
      }
    }catch{}
  })() },[]);

  useEffect(()=>{ (async()=>{
    const hist = await provider.getDailyHistory(symbol);
    setData(hist);
  })() }, [symbol]);

  // filtre timeframe
  const filtered = useMemo(()=>{
    if(!data.length) return [];
    const last = new Date(data[data.length-1].date);
    let from = new Date(data[0].date);
    const yStart = new Date(`${new Date().getFullYear()}-01-01`);
    if(tf==="1M"){ from = shiftDays(last,-30); }
    else if(tf==="6M"){ from = shiftDays(last,-182); }
    else if(tf==="1Y"){ from = shiftDays(last,-365); }
    else if(tf==="YTD"){ from = yStart; }
    // MAX => from = data[0]
    return data.filter(d => new Date(d.date) >= from);
  },[data, tf]);

  // chart.js
  useEffect(()=>{
    if(!canvasRef.current) return;
    chartRef.current?.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels: filtered.map(d=>d.date),
        datasets: [{ label: symbol, data: filtered.map(d=>d.close) }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        elements: { line: { tension: 0.25 }, point: { radius: 0 } },
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { maxTicksLimit: 6 } } }
      }
    });
    return ()=> chartRef.current?.destroy();
  }, [filtered, symbol]);

  const lastClose = filtered.at(-1)?.close ?? data.at(-1)?.close ?? 0;

  return (
    <div className="container">
      <div className="toolbar">
        <select value={symbol} onChange={e=>setSymbol(e.target.value)} className="select">
          {Object.entries(groupByMarket(companies)).map(([mkt, arr])=> (
            <optgroup key={mkt} label={marketLabel(mkt)}>
              {arr.map(c=> <option key={c.symbol} value={c.symbol}>{c.symbol} - {c.name || c.symbol}</option>)}
            </optgroup>
          ))}
        </select>
        <div className="tf">
          {(["1M","6M","YTD","1Y","MAX"] as TF[]).map(x=>(
            <button key={x}
              className={`pill ${tf===x?'active':''}`} onClick={()=>setTf(x)}>{x}</button>
          ))}
        </div>
        <div className="price">Dernier : <strong>{lastClose.toFixed(2)}</strong></div>
      </div>
      <div className="chart-card">
        <canvas ref={canvasRef} />
      </div>
      <p className="hint">Source: JSON statiques (Finnhub/Akshare/Yahoo via CI).</p>
    </div>
  );
}

function shiftDays(d: Date, delta: number){
  const x = new Date(d); x.setDate(x.getDate()+delta); return x;
}

function groupByMarket(list: Company[]): Record<string, Company[]>{
  const map: Record<string, Company[]> = {};
  for(const c of list){
    const key = (c.market || "OTHER").toUpperCase();
    (map[key] ||= []).push(c);
  }
  for(const k of Object.keys(map)){
    map[k].sort((a,b)=> (a.symbol).localeCompare(b.symbol));
  }
  // ensure stable order: main regions first, then others alpha
  const ordered: Record<string, Company[]> = {};
  for(const pref of ["US","CN","EU","JP","SA","COM","CRYPTO","FX"]) if(map[pref]) ordered[pref]=map[pref];
  for(const k of Object.keys(map).sort()) if(!(k in ordered)) ordered[k]=map[k];
  return ordered;
}
