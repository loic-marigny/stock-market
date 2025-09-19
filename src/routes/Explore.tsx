import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "chart.js/auto";
import provider from "../lib/prices";

const US_TICKERS = [
  "AAPL","MSFT","NVDA","AMZN","GOOGL","GOOG","META","AVGO","LLY","TSLA",
  "JPM","V","XOM","UNH","JNJ","WMT","MA","PG","ORCL","COST",
  "MRK","HD","KO","PEP","BAC","ADBE","CRM","NFLX","CSCO","AMD",
] as const;
const CN_TICKERS = [
  "600519.SS","601318.SS","601398.SS","601288.SS","601988.SS","601857.SS",
  "600028.SS","600036.SS","601166.SS","600900.SS","601888.SS","601012.SS",
  "600104.SS","600030.SS","600585.SS","600000.SS","601601.SS","601939.SS",
  "600019.SS","600276.SS","601766.SS","600309.SS","601633.SS","600887.SS",
  "601668.SS","601658.SS","601728.SS","601628.SS","688981.SS",
] as const;
const TICKERS = [...US_TICKERS, ...CN_TICKERS] as const;
type TF = "1M"|"6M"|"YTD"|"1Y"|"MAX";

export default function Explore(){
  const [symbol, setSymbol] = useState<(typeof TICKERS)[number]>("AAPL");
  const [tf, setTf] = useState<TF>("6M");
  const [data, setData] = useState<{date:string; close:number}[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

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
        <select value={symbol} onChange={e=>setSymbol(e.target.value as any)} className="select">
          <optgroup label="New York">
            {US_TICKERS.map(t=><option key={t} value={t}>{t}</option>)}
          </optgroup>
          <optgroup label="Shanghai">
            {CN_TICKERS.map(t=><option key={t} value={t}>{t}</option>)}
          </optgroup>
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
      <p className="hint">Source: JSON statiques (Finnhub via CI).</p>
    </div>
  );
}

function shiftDays(d: Date, delta: number){
  const x = new Date(d); x.setDate(x.getDate()+delta); return x;
}
