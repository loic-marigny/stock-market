import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import type { User } from "firebase/auth";
import { auth } from "./firebase";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import Explore from "./routes/Explore";
import Portfolio from "./routes/Portfolio";
import Trade from "./routes/Trade";
import SignIn from "./SignIn";
import { usePortfolioSnapshot } from "./lib/usePortfolioSnapshot";

export default function App(){
  const [user, setUser] = useState<User|null>(null);
  const [ready, setReady] = useState(false);
  useEffect(()=> onAuthStateChanged(auth, u => { setUser(u); setReady(true); }), []);

  const uid = user?.uid ?? null;
  const { totalValue, loadingInitial, loadingPrices } = usePortfolioSnapshot(uid);
  const currencyFmt = useMemo(() => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }), []);
  const totalDisplay = loadingInitial || loadingPrices ? "Calculating..." : currencyFmt.format(totalValue);

  if(!ready) return <p style={{color:"#fff",textAlign:"center",marginTop:40}}>Loading...</p>;
  if(!user) return <SignIn/>;

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand-mini">Stock&nbsp;Market</Link>
        <nav className="nav">
          <NavLink to="/" end className={({isActive})=> isActive?"active":""}>Explore</NavLink>
          <NavLink to="/portfolio" className={({isActive})=> isActive?"active":""}>Portfolio</NavLink>
          <NavLink to="/trade" className={({isActive})=> isActive?"active":""}>Trade</NavLink>
        </nav>
        <div style={{marginLeft:"auto", display:"flex", alignItems:"center", gap:"1rem"}}>
          <div style={{color:"var(--text-muted)", fontSize:"0.9rem"}}>Total value: {totalDisplay}</div>
          <button className="btn" onClick={()=>signOut(auth)}>Sign out</button>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<Explore/>} />
        <Route path="/portfolio" element={<Portfolio/>} />
        <Route path="/trade" element={<Trade/>} />
      </Routes>
    </div>
  );
}

